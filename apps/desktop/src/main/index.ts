import * as path from 'path'
import { app, webContents } from 'electron'
import { createContainer } from './container'
import { initGitHome } from './git/git-config'
import { registerHandlers } from './ipc/index'
import { ipcMainRegistry, electronPlatformHost, registerDesktopOnlyHandlers } from './ipc/desktop-only.handlers'
import { createElectronHostContext } from './host/electron-host'
import { electronPrintRenderer } from './host/electron-print'
import { UpdateService } from './services/update.service'
import { TerminalService } from './services/terminal.service'
import { closeAll } from './git/process-registry'
import { closeAskpassServer } from './git/askpass'
import { INVITE_SCHEME, inviteFromArgv, parseInviteLink, setPendingInvite, type InviteLink } from './host/invite-link'
import { BRAND } from '../shared/brand'
import { initAppZoom } from './host/app-zoom'
import { createAppWindow, lastFocusedAppWindow, prepareForcedQuit, releaseStartupInviteWindow, restoreOrCreateWindows } from './host/app-windows'

// Aligne le dossier userData (auth.json, workspace.json…) entre `pnpm dev` et le build
// packagé — sans ça, Electron retombe sur le "name" du package.json en dev (`@polenta/desktop`)
// au lieu du `productName` de la marque (`Polenta`), donnant deux profils isolés. GH49 : un
// dossier userData par marque — Polenta garde « Polenta », donc ses données existantes.
app.setName(BRAND.productName)
// GH45 S2b — tests d'interface : profil isolé (auth.json, préférences…). Non défini en usage normal.
if (process.env['POLENTA_USER_DATA_DIR']) app.setPath('userData', process.env['POLENTA_USER_DATA_DIR'])

// GH45 S2b — lien d'invitation polenta:// (spec §3ter) : instance unique, le lien est traité par
// la fenêtre déjà ouverte.
function receiveInvite(link: InviteLink | null): void {
  if (!link) return
  setPendingInvite(link)
  if (!app.isReady()) return            // la fenêtre créée au démarrage prendra l'invitation
  releaseStartupInviteWindow()          // GH342 — en cours de session : la dernière fenêtre active
  // GH342 — plusieurs fenêtres possibles : la dernière active traite l'invitation.
  const win = lastFocusedAppWindow()
  if (!win) {
    // macOS, toutes fenêtres fermées : nouvelle fenêtre, qui prend l'invitation en attente.
    createAppWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.focus()
  win.webContents.send('app:invite', link)
}
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  // Seconde instance : son lien a été transmis à la première (second-instance). app.quit() avant
  // « ready » n'arrête pas toujours le processus (constaté en test) : sortie immédiate.
  app.exit(0)
} else {
  app.on('second-instance', (_event, argv) => {
    const link = inviteFromArgv(argv)
    if (link) return receiveInvite(link)
    // GH342 — exécutable relancé sans lien : la fenêtre existante passe au premier plan.
    const win = lastFocusedAppWindow()
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  app.on('open-url', (event, url) => {     // macOS
    event.preventDefault()
    receiveInvite(parseInviteLink(url))
  })
  // Seule l'application installée s'enregistre comme gestionnaire de polenta:// — jamais `pnpm dev`
  // ni les tests, qui remplaceraient l'enregistrement de l'application installée.
  if (app.isPackaged) app.setAsDefaultProtocolClient(INVITE_SCHEME)
  receiveInvite(inviteFromArgv(process.argv))
}

app.whenReady().then(() => {
  if (!primaryInstance) return   // seconde instance : le lien a été transmis à la première
  const host = createElectronHostContext()
  const container = createContainer(host, electronPrintRenderer)
  // GH337 P3 — config git de Polenta dans userData, identité du compte connecté (terminal, auteur git).
  void initGitHome(path.join(app.getPath('userData'), 'git'), () => container.auth.currentAccount())
  registerHandlers(ipcMainRegistry, container, electronPlatformHost)
  // GH26 — mise à jour automatique : propre au desktop, hors du noyau de services partagé.
  // GH52 — flux du serveur du client (configuration machine) : sans clé, la source reste GitHub.
  const update = new UpdateService(container.appSettings, host.machineConfig.updateFeedUrl)
  update.onBeforeInstall(prepareForcedQuit)
  // GH238 — terminal de la vue Version ; ses shells ne survivent pas à l'application.
  // GH337 — identifiants askpass de la session terminal : ceux du compte connecté (§6).
  const terminal = new TerminalService((owner, channel, ...args) => {
    const target = webContents.fromId(owner)
    if (target && !target.isDestroyed()) target.send(channel, ...args)
  }, { auth: container.auth })
  app.on('will-quit', () => terminal.killAll())
  // GH337 — aucun processus git (ni son réseau : git-remote-https, ssh) ne survit à l'application.
  app.on('will-quit', () => { void closeAll(); void closeAskpassServer() })
  // GH361 — au mieux : un processus arrêté rend de toute façon ses verrous caducs (PID mort).
  app.on('will-quit', () => { void container.treeEditLocks.releaseAll().catch(() => {}) })
  registerDesktopOnlyHandlers(container, update, terminal)
  initAppZoom(container.appSettings)
  restoreOrCreateWindows()
  update.scheduleStartupCheck()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
