import { app, BrowserWindow, Menu, screen, type WebContents } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { BRAND } from '../../shared/brand'
import { attachContextMenu } from './context-menu'
import { attachAppZoom, currentZoomFactor } from './app-zoom'
import {
  fitToDisplays, isRestorableRoute, isValidAppRoute, offsetPlacement, parseSavedWindows,
  type SavedWindow, type WindowPlacement,
} from './window-placement'

/**
 * GH342 — fenêtres de l'application (pas les fenêtres cachées d'export PDF / d'instantané
 * draw.io, qui ne passent pas par ici). Plusieurs fenêtres peuvent afficher le même projet : le
 * container de services est commun, chaque fenêtre a son renderer (onglets, historique, panneau).
 *
 * Ce module tient le registre des fenêtres ouvertes (route de l'onglet actif, état « non
 * sauvegardé » remonté par le renderer, ordre d'activation) et la disposition mémorisée
 * (`userData/windows-state.json`), rouverte au lancement suivant.
 */

interface WindowEntry {
  /** Page de l'onglet actif (`pathname?search`), remontée par le renderer (`app:window-state`). */
  route?: string
  /** Un onglet au moins a des modifications non sauvegardées. */
  dirty: boolean
  /** Fermeture confirmée par le renderer : plus de garde. */
  forceClose: boolean
}

const DEFAULT_SIZE = { width: 1280, height: 800 }
const STATE_FILE = 'windows-state.json'

const registry = new Map<BrowserWindow, WindowEntry>()
/** Ordre d'activation : la dernière fenêtre active en fin de liste. */
let focusOrder: BrowserWindow[] = []
/** `before-quit` reçu : la disposition est déjà enregistrée, plus aucune écriture. */
let quitting = false

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

app.on('before-quit', () => {
  // Cmd+Q, installation d'une mise à jour, `app.quit()` : toutes les fenêtres encore ouvertes. Sous
  // Windows, fermer la dernière fenêtre passe par `close` (ci-dessous) avant d'arriver ici, sans
  // fenêtre : `saveState` n'écrit rien dans ce cas.
  if (!quitting) saveState()
  quitting = true
})

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

  registry.set(win, { route, dirty: false, forceClose: false })
  focusOrder.push(win)
  win.on('focus', () => {
    focusOrder = [...focusOrder.filter(w => w !== win), win]
  })
  win.on('close', () => {
    // Dernière fenêtre fermée (chemin de sortie habituel sous Windows) : sa disposition est
    // mémorisée. Une fenêtre fermée alors que d'autres restent ne l'est pas (D3).
    if (!quitting && liveWindows().length === 1) saveState()
  })
  win.on('closed', () => {
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
    createAppWindow({ route: w.route, placement: fitToDisplays(w, displays, primary) })
  }
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
  dirty?: boolean
}

/** Remontée du renderer : page de l'onglet actif, onglets non sauvegardés. */
export function setWindowState(sender: WebContents, patch: WindowStatePatch): void {
  const win = BrowserWindow.fromWebContents(sender)
  const entry = win ? registry.get(win) : undefined
  if (!entry) return
  if (patch.route !== undefined && isValidAppRoute(patch.route)) entry.route = patch.route
  if (typeof patch.dirty === 'boolean') entry.dirty = patch.dirty
}
