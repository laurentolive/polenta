import { app, BrowserWindow, Menu } from 'electron'
import * as path from 'path'
import { createContainer } from './container'
import { registerHandlers } from './ipc/index'
import { ipcMainRegistry, electronPlatformHost, registerDesktopOnlyHandlers } from './ipc/desktop-only.handlers'
import { createElectronHostContext } from './host/electron-host'
import { electronPrintRenderer } from './host/electron-print'
import { UpdateService } from './services/update.service'
import { INVITE_SCHEME, inviteFromArgv, parseInviteLink, setPendingInvite, type InviteLink } from './host/invite-link'
import { BRAND } from '../shared/brand'
import { attachContextMenu } from './host/context-menu'

// Aligne le dossier userData (auth.json, workspace.json…) entre `pnpm dev` et le build
// packagé — sans ça, Electron retombe sur le "name" du package.json en dev (`@polenta/desktop`)
// au lieu du `productName` de la marque (`Polenta`), donnant deux profils isolés. GH49 : un
// dossier userData par marque — Polenta garde « Polenta », donc ses données existantes.
app.setName(BRAND.productName)
// GH45 S2b — tests d'interface : profil isolé (auth.json, préférences…). Non défini en usage normal.
if (process.env['POLENTA_USER_DATA_DIR']) app.setPath('userData', process.env['POLENTA_USER_DATA_DIR'])

// GH45 S2b — lien d'invitation polenta:// (spec §3ter) : instance unique, le lien est traité par
// la fenêtre déjà ouverte.
let mainWindow: BrowserWindow | null = null
function receiveInvite(link: InviteLink | null): void {
  if (!link) return
  setPendingInvite(link)
  if (!app.isReady()) return            // la fenêtre créée au démarrage prendra l'invitation
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0]
  if (!win) {
    // macOS, toutes fenêtres fermées : nouvelle fenêtre, qui prend l'invitation en attente.
    mainWindow = createAppWindow()
    mainWindow.on('closed', () => { mainWindow = null })
    return
  }
  if (win.isMinimized()) win.restore()
  win.focus()
  electronPlatformHost.broadcast('app:invite', link)
}
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  // Seconde instance : son lien a été transmis à la première (second-instance). app.quit() avant
  // « ready » n'arrête pas toujours le processus (constaté en test) : sortie immédiate.
  app.exit(0)
} else {
  app.on('second-instance', (_event, argv) => receiveInvite(inviteFromArgv(argv)))
  app.on('open-url', (event, url) => {     // macOS
    event.preventDefault()
    receiveInvite(parseInviteLink(url))
  })
  // Seule l'application installée s'enregistre comme gestionnaire de polenta:// — jamais `pnpm dev`
  // ni les tests, qui remplaceraient l'enregistrement de l'application installée.
  if (app.isPackaged) app.setAsDefaultProtocolClient(INVITE_SCHEME)
  receiveInvite(inviteFromArgv(process.argv))
}

export function createAppWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // affichée seulement au premier paint (ready-to-show) — pas de flash de fenêtre blanche vide
    // GH49 — icône de la marque (dossier brands/<id>/ en dev ; en build packagé l'exécutable porte
    // déjà l'icône de la marque, ce chemin n'existe pas et Electron s'en passe).
    icon: path.join(__dirname, `../../brands/${BRAND.id}/icon.${process.platform === 'win32' ? 'ico' : 'png'}`),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  win.once('ready-to-show', () => win.show())
  attachContextMenu(win)

  Menu.setApplicationMenu(null)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools()
    }
  })

  return win
}

app.whenReady().then(() => {
  if (!primaryInstance) return   // seconde instance : le lien a été transmis à la première
  const container = createContainer(createElectronHostContext(), electronPrintRenderer)
  registerHandlers(ipcMainRegistry, container, electronPlatformHost)
  // GH26 — mise à jour automatique : propre au desktop, hors du noyau de services partagé.
  const update = new UpdateService(container.appSettings)
  registerDesktopOnlyHandlers(container, update)
  mainWindow = createAppWindow()
  mainWindow.on('closed', () => { mainWindow = null })
  update.scheduleStartupCheck()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
