import { app, BrowserWindow, Menu, screen, type WebContents } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { BRAND } from '../../shared/brand'
import { attachContextMenu } from './context-menu'
import { attachAppZoom, currentZoomFactor } from './app-zoom'
import { routeProjectId } from '../../shared/app-route'
import {
  fitToDisplays, isRestorableRoute, isValidAppRoute, offsetPlacement, parseSavedWindows,
  type SavedWindow, type WindowPlacement,
} from './window-placement'

/**
 * GH342 — fenêtres de l'application (pas les fenêtres cachées d'export PDF / d'instantané
 * draw.io, qui ne passent pas par ici). Plusieurs fenêtres peuvent afficher le même projet : le
 * container de services est commun, chaque fenêtre a son renderer (onglets, historique, panneau).
 *
 * Ce module tient le registre des fenêtres ouvertes (route de l'onglet actif remontée par le
 * renderer, garde de fermeture, ordre d'activation) et la disposition mémorisée
 * (`userData/windows-state.json`), rouverte au lancement suivant.
 */

interface WindowEntry {
  /** Page de l'onglet actif (`pathname?search`), remontée par le renderer (`app:window-state`). */
  route?: string
  /** Fermeture confirmée par le renderer (ou renderer hors d'état de répondre) : plus de garde. */
  forceClose: boolean
  /** Fermeture demandée au renderer, en attente de sa réponse. */
  closePending: boolean
  /** Délai d'accusé de réception du renderer (renderer bloqué → fermeture forcée). */
  closeTimer?: ReturnType<typeof setTimeout>
  /** Sortie de l'application : saisies en attente enregistrées par le renderer. */
  flushed?: () => void
}

const DEFAULT_SIZE = { width: 1280, height: 800 }
const STATE_FILE = 'windows-state.json'
/** Délai d'accusé de réception d'une demande de fermeture par le renderer. */
const CLOSE_ACK_TIMEOUT_MS = 3000
/** Sortie de l'application : délai max d'enregistrement des saisies en attente de toutes les fenêtres. */
const QUIT_FLUSH_TIMEOUT_MS = 2500

const registry = new Map<BrowserWindow, WindowEntry>()
/** Ordre d'activation : la dernière fenêtre active en fin de liste. */
let focusOrder: BrowserWindow[] = []
/** `before-quit` reçu : la disposition est déjà enregistrée, plus aucune écriture. */
let quitting = false
/** Sortie déjà retardée une fois pour enregistrer les saisies en attente. */
let flushedForQuit = false
/** Fenêtre qui prend une invitation reçue au lancement (dernière rouverte, au premier plan). */
let startupInviteWindow: BrowserWindow | undefined

function stateFile(): string {
  return path.join(app.getPath('userData'), STATE_FILE)
}

function liveWindows(): BrowserWindow[] {
  return [...registry.keys()].filter(w => !w.isDestroyed())
}

function placementOf(win: BrowserWindow): WindowPlacement {
  // Taille hors maximisation / plein écran : celle qu'on retrouve en quittant ces états.
  const b = win.getNormalBounds()
  return {
    x: b.x, y: b.y, width: b.width, height: b.height,
    ...(win.isMaximized() ? { maximized: true } : {}),
    ...(win.isFullScreen() ? { fullScreen: true } : {}),
  }
}

/** Enregistre la disposition de toutes les fenêtres ouvertes (écriture synchrone : appelée à la fermeture). */
function saveState(): void {
  const windows: SavedWindow[] = liveWindows().map(win => {
    const route = registry.get(win)?.route
    return { ...placementOf(win), ...(isRestorableRoute(route) ? { route } : {}) }
  })
  if (windows.length === 0) return
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ version: 1, windows }, null, 2), 'utf8')
  } catch (err) {
    // Fichier verrouillé (antivirus, synchronisation) : la disposition n'est simplement pas mémorisée.
    console.error('[GH342] disposition des fenêtres non enregistrée :', err)
  }
}

function readState(): SavedWindow[] {
  try {
    return parseSavedWindows(JSON.parse(fs.readFileSync(stateFile(), 'utf8')))
  } catch {
    return []
  }
}

app.on('before-quit', event => {
  if (quitting) return
  // Cmd+Q, installation d'une mise à jour, `app.quit()` avec des fenêtres ouvertes : les fenêtres
  // seront détruites sans démonter les vues. Sortie retardée une fois, le temps que chaque renderer
  // enregistre ses saisies en attente (pas de confirmation : la mise à jour a la sienne).
  if (!flushedForQuit && liveWindows().length > 0) {
    event.preventDefault()
    flushedForQuit = true
    void flushAllWindows().then(() => app.quit())
    return
  }
  // Disposition de toutes les fenêtres encore ouvertes. Sous Windows, fermer la dernière fenêtre
  // passe par `close` (ci-dessous) avant d'arriver ici, sans fenêtre : `saveState` n'écrit rien.
  // `quitting` n'est jamais remis à faux : plus rien n'annule la sortie à ce stade (la garde de
  // fermeture ne s'applique pas pendant `quitting`).
  saveState()
  quitting = true
})

function flushAllWindows(): Promise<void> {
  const done = liveWindows().map(win => new Promise<void>(resolve => {
    const entry = registry.get(win)
    if (!entry) return resolve()
    entry.flushed = resolve
    win.webContents.send('app:flush-requested')
  }))
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    Promise.all(done).then(() => undefined),
    new Promise<void>(resolve => { timer = setTimeout(resolve, QUIT_FLUSH_TIMEOUT_MS) }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * Sous Windows avec mise à l'échelle (125 %…), la taille demandée et celle relue par
 * `getNormalBounds()` diffèrent de quelques pixels (arrondis DIP ↔ pixels du cadre) : sans
 * correction, la fenêtre grandissait à chaque relance. Écart relu puis compensé une fois.
 */
function applyBounds(win: BrowserWindow, target: WindowPlacement): void {
  const want = { x: target.x, y: target.y, width: target.width, height: target.height }
  win.setBounds(want)
  const got = win.getNormalBounds()
  const dw = got.width - want.width
  const dh = got.height - want.height
  if ((dw || dh) && Math.abs(dw) <= 16 && Math.abs(dh) <= 16) {
    win.setBounds({ ...want, width: want.width - dw, height: want.height - dh })
  }
}

export interface CreateWindowOptions {
  /** Page à ouvrir (`pathname?search`) ; absente = démarrage habituel (accueil / dernier projet). */
  route?: string
  placement?: WindowPlacement
}

export function createAppWindow(opts: CreateWindowOptions = {}): BrowserWindow {
  const { route, placement } = opts
  const win = new BrowserWindow({
    ...(placement
      ? { x: placement.x, y: placement.y, width: placement.width, height: placement.height }
      : DEFAULT_SIZE),
    show: false, // affichée seulement au premier paint (ready-to-show) — pas de flash de fenêtre blanche vide
    // GH49 — icône de la marque (dossier brands/<id>/ en dev ; en build packagé l'exécutable porte
    // déjà l'icône de la marque, ce chemin n'existe pas et Electron s'en passe).
    icon: path.join(__dirname, `../../brands/${BRAND.id}/icon.${process.platform === 'win32' ? 'ico' : 'png'}`),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      zoomFactor: currentZoomFactor(), // GH237 — niveau mémorisé dès le premier paint
    },
  })

  if (placement) applyBounds(win, placement)

  const entry: WindowEntry = { route, forceClose: false, closePending: false }
  registry.set(win, entry)
  focusOrder.push(win)
  win.on('focus', () => {
    focusOrder = [...focusOrder.filter(w => w !== win), win]
  })
  win.on('close', event => {
    // GH342 — garde de fermeture : la fenêtre est détruite sans démonter les vues. Le renderer vide
    // d'abord les saisies en attente, puis ferme, ou demande confirmation s'il reste des onglets non
    // sauvegardés. Pas de garde pendant une sortie de l'application (`quitting` : Cmd+Q,
    // installation d'une mise à jour, qui a sa propre confirmation).
    if (!quitting && !entry.forceClose) {
      event.preventDefault()
      if (!entry.closePending) {
        entry.closePending = true
        win.webContents.send('app:close-requested')
        entry.closeTimer = setTimeout(() => forceClose(win), CLOSE_ACK_TIMEOUT_MS)
      }
      return
    }
    // Dernière fenêtre fermée (chemin de sortie habituel sous Windows) : sa disposition est
    // mémorisée. Une fenêtre fermée alors que d'autres restent ne l'est pas (D3).
    if (!quitting && liveWindows().length === 1) saveState()
  })
  // Renderer planté ou bloqué : il ne répondra pas à la demande de fermeture.
  win.webContents.on('render-process-gone', () => { entry.forceClose = true })
  win.on('unresponsive', () => { entry.forceClose = true })
  win.on('responsive', () => { if (!entry.closePending) entry.forceClose = false })
  // Renderer rechargé après un plantage : il répond de nouveau, la garde revient.
  win.webContents.on('did-finish-load', () => { if (!entry.closePending) entry.forceClose = false })
  win.on('closed', () => {
    clearTimeout(entry.closeTimer)
    registry.delete(win)
    focusOrder = focusOrder.filter(w => w !== win)
  })

  win.once('ready-to-show', () => {
    if (placement?.maximized) win.maximize()
    win.show()
    if (placement?.fullScreen) win.setFullScreen(true)
  })
  attachContextMenu(win)
  attachAppZoom(win)

  Menu.setApplicationMenu(null)

  // GH342 — page d'ouverture passée au renderer comme `__print` (T43) : `index.html` est le seul
  // point d'entrée en `file://`.
  const search = route && isValidAppRoute(route) ? `__open=${encodeURIComponent(route)}` : ''
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(search ? `${process.env['ELECTRON_RENDERER_URL']}?${search}` : process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), search ? { search } : undefined)
  }

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools()
    }
  })

  // GH228 — Précédent / Suivant système : boutons latéraux de la souris et touches multimédia
  // (Windows), balayage du trackpad (macOS). Le renderer tient l'historique de chaque onglet.
  win.on('app-command', (_event, command) => {
    if (command === 'browser-backward') win.webContents.send('nav:history', 'back')
    else if (command === 'browser-forward') win.webContents.send('nav:history', 'forward')
  })
  win.on('swipe', (_event, direction) => {
    if (direction === 'left') win.webContents.send('nav:history', 'back')
    else if (direction === 'right') win.webContents.send('nav:history', 'forward')
  })

  return win
}

/** Au lancement : la disposition mémorisée, ou une fenêtre par défaut. */
export function restoreOrCreateWindows(): void {
  const saved = readState()
  if (saved.length === 0) {
    createAppWindow()
    return
  }
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  for (const w of saved) {
    startupInviteWindow = createAppWindow({ route: w.route, placement: fitToDisplays(w, displays, primary) })
  }
}

/** Fenêtre qui prend une invitation reçue avant que l'interface ne soit prête : fixée au lancement
 *  (la dernière rouverte, au premier plan) — l'ordre d'activation change pendant l'affichage des
 *  fenêtres rouvertes ; ensuite, la dernière fenêtre active. */
export function pendingInviteWindow(): BrowserWindow | undefined {
  if (startupInviteWindow && !startupInviteWindow.isDestroyed()) return startupInviteWindow
  return lastFocusedAppWindow()
}

/** Nouvelle fenêtre ouverte depuis une fenêtre existante (Ctrl+Shift+N, menu d'onglet). */
export function openWindowFrom(sender: WebContents, route: string): void {
  if (!isValidAppRoute(route)) throw new Error('Page à ouvrir invalide')
  const from = BrowserWindow.fromWebContents(sender)
  const placement = from && !from.isDestroyed()
    ? offsetPlacement(from.getNormalBounds(), screen.getAllDisplays())
    : undefined
  createAppWindow({ route, placement })
}

/** Dernière fenêtre de l'application active (liens d'invitation). */
export function lastFocusedAppWindow(): BrowserWindow | undefined {
  return [...focusOrder].reverse().find(w => !w.isDestroyed()) ?? liveWindows()[0]
}

export interface WindowStatePatch {
  route?: string
  /** Onglets non sauvegardés : utilisé par le web (`beforeunload`) ; sur le desktop, la garde de
   *  fermeture est décidée par le renderer (WindowCloseGuard). */
  dirty?: boolean
}

/** Remontée du renderer : page de l'onglet actif. */
export function setWindowState(sender: WebContents, patch: WindowStatePatch): void {
  const win = BrowserWindow.fromWebContents(sender)
  const entry = win ? registry.get(win) : undefined
  if (!entry) return
  if (patch.route !== undefined && isValidAppRoute(patch.route)) entry.route = patch.route
}

function forceClose(win: BrowserWindow): void {
  const entry = registry.get(win)
  if (!entry || win.isDestroyed()) return
  clearTimeout(entry.closeTimer)
  entry.forceClose = true
  win.close()
}

export type CloseWindowAction = 'ack' | 'close' | 'cancel' | 'flushed'

/**
 * Réponse du renderer à 'app:close-requested' : `ack` (demande reçue, vidage des saisies en cours —
 * plus de fermeture forcée), `close` (fermer), `cancel` (l'utilisateur garde la fenêtre) ; à
 * 'app:flush-requested' (sortie de l'application) : `flushed`.
 */
export function respondToClose(sender: WebContents, action: CloseWindowAction): void {
  const win = BrowserWindow.fromWebContents(sender)
  const entry = win ? registry.get(win) : undefined
  if (!win || !entry) return
  if (action === 'ack') {
    clearTimeout(entry.closeTimer)
  } else if (action === 'close') {
    forceClose(win)
  } else if (action === 'cancel') {
    clearTimeout(entry.closeTimer)
    entry.closePending = false
  } else if (action === 'flushed') {
    entry.flushed?.()
    entry.flushed = undefined
  }
}

/**
 * GH342 — pull automatique une seule fois par projet : chaque fenêtre garde sa minuterie, mais seule
 * la plus ancienne fenêtre ouverte sur ce projet le fait (les autres passent leur tour). Fenêtre
 * fermée → la suivante prend le relais à son prochain tick. Aucun résultat mis en cache : chaque pull
 * fait ses effets (rangement des modifications, nouvel essai de push).
 */
export function isAutoPullOwner(sender: WebContents): boolean {
  const win = BrowserWindow.fromWebContents(sender)
  const route = win ? registry.get(win)?.route : undefined
  const project = route ? routeProjectId(route) : null
  if (!win || !project) return true
  for (const [w, e] of registry) {   // ordre d'insertion = ordre de création
    if (w.isDestroyed() || !e.route) continue
    if (routeProjectId(e.route) === project) return w === win
  }
  return true
}
