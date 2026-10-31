import { app, ipcMain, dialog, shell, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { takePendingInvite } from '../host/invite-link'
import { applyZoom } from '../host/app-zoom'
import * as fsP from 'fs/promises'
import * as path from 'path'
import { isAcceptedLinkUrl, isHttpLinkUrl } from '@polenta/types'
import type { ExportKind, ExportFormat, ExportResult, ExecutionSheetLocale, ExecutionImportPreview, TerminalKind, ZoomAction } from '@polenta/types'
import type { Container } from './index'
import type { HandlerRegistry, Handler } from './registry'
import type { DESKTOP_ONLY_CHANNELS } from './channels'
import type { PlatformHost } from '../host/platform-host'
import type { UpdateService } from '../services/update.service'
import type { TerminalService } from '../services/terminal.service'
import { IMAGE_MIME_BY_EXT, importFileIntoRepo, saveExport, saveExecutionSheet } from './file-ops'
import { BRAND } from '../../shared/brand'
import { appVersion } from '../app-version'

/**
 * GH44 — channels propres au poste local : dialogues natifs, `shell`, fenêtres, mise à jour
 * automatique, Device Flow GitHub. Jamais enregistrés par le serveur web (qui les remplace côté
 * navigateur, cf. specs/GH44-design.md §4.4) — c'est ce qui garantit qu'ils n'y sont pas exposés.
 */

export const ipcMainRegistry: HandlerRegistry = {
  handle: (channel, fn) => ipcMain.handle(channel, fn),
}

/** Fenêtres Electron : diffusion à toutes les fenêtres ouvertes. */
export const electronPlatformHost: PlatformHost = {
  kind: 'desktop',
  // `BrowserWindow.getAllWindows()` rather than threading a window reference through the DI
  // container: handlers are registered (main/index.ts) before createAppWindow().
  broadcast: (channel, ...args) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, ...args)
  },
  // Gabarits d'exemple : `extraResources` en build packagé (electron-builder.yml), sources du repo
  // en développement.
  exportTemplateExamplesDir: () => app.isPackaged
    ? path.join(process.resourcesPath, 'export-templates')
    : path.join(app.getAppPath(), 'resources', 'export-templates'),
}

const IMAGE_DIALOG_FILTERS = [{ name: 'Images', extensions: Object.keys(IMAGE_MIME_BY_EXT) }]

const EXPORT_DIALOG_FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  xlsx: { name: 'Excel', extensions: ['xlsx'] },
  docx: { name: 'Word', extensions: ['docx'] },
  pdf: { name: 'PDF', extensions: ['pdf'] },
}

export function registerDesktopOnlyHandlers(c: Container, update: UpdateService, terminal: TerminalService): void {
  // Typé sur `DESKTOP_ONLY_CHANNELS` : un channel ajouté ici sans y figurer ne compile pas, et le
  // serveur web s'appuie sur cette liste (channels.ts).
  const handle = (channel: typeof DESKTOP_ONLY_CHANNELS[number], fn: Handler) => ipcMain.handle(channel, fn)

  // ── Auth : Device Flow GitHub (ouvre le navigateur du poste) ──────────────────
  handle('auth:device-flow-start', (_e, remote: string) => c.auth.startDeviceFlow(remote))
  handle('auth:device-flow-poll', (_e, remote: string, deviceCode: string) =>
    c.auth.pollDeviceFlow(remote, deviceCode))
  // GH45 — déconnexion du compte courant (le web a sa propre déconnexion de session).
  handle('auth:logout', () => c.auth.logout())
  handle('auth:open-password-change', () => c.auth.openPasswordChange())
  // GH45 S2b — lien d'invitation reçu avant que l'interface ne soit prête (spec §3ter).
  handle('app:take-pending-invite', () => takePendingInvite())

  // ── App ───────────────────────────────────────────────────────────────────────
  handle('app:set-title', (_event, title: string) => {
    BrowserWindow.getFocusedWindow()?.setTitle(title)
  })
  // GH158 — version déduite du tag git au build (scripts/app-version.ts) : la même que le nom de
  // l'installeur et que latest.yml.
  handle('app:get-version', () => appVersion())
  // GH26 — restreint aux pages de release : seul usage (lien « Voir les nouveautés »), pas un
  // ouvreur d'URL générique exposé au renderer. GH49 : celles de la marque (`releasesUrl`, ou une
  // page sous celle-ci) ; marque sans `releasesUrl` → rien n'est ouvert.
  handle('app:open-release-page', (_e, url: string) => {
    const base = BRAND.releasesUrl?.replace(/\/+$/, '')
    if (base && (url === base || url.startsWith(`${base}/`))) return shell.openExternal(url)
  })
  // GH195 — lien d'un champ `link`. Le schéma est revalidé ici (le renderer n'est pas cru sur
  // parole) ; hors http(s), l'utilisateur confirme. Chemin UNC : `openPath` (application du poste).
  handle('app:open-link', async (_e, raw: string): Promise<boolean> => {
    const url = typeof raw === 'string' ? raw.trim() : ''
    if (!isAcceptedLinkUrl(url)) return false
    if (!isHttpLinkUrl(url)) {
      const win = BrowserWindow.getFocusedWindow()
      const options = {
        type: 'question' as const,
        buttons: ['Ouvrir', 'Annuler'],
        defaultId: 0,
        cancelId: 1,
        message: 'Ouvrir ce lien avec l’application du poste ?',
        detail: url,
      }
      const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
      if (response !== 0) return false
    }
    try {
      if (url.startsWith('\\\\')) {
        const error = await shell.openPath(url)
        if (error) throw new Error(error)
      } else {
        await shell.openExternal(url)
      }
      return true
    } catch (err) {
      dialog.showErrorBox('Lien inaccessible', `${url}\n\n${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  })
  // GH237 — raccourcis clavier de zoom (Ctrl+molette arrive par `zoom-changed`, host/app-zoom.ts).
  handle('app:zoom', (_e, action: ZoomAction) => applyZoom(action))

  // ── Update (GH26) ─────────────────────────────────────────────────────────────
  // État poussé aux fenêtres par 'update:state-changed' ; get-state couvre une fenêtre
  // montée après l'événement.
  handle('update:get-state', () => update.getState())
  handle('update:install', () => update.install())

  // ── Campagnes : classeur Excel d'exécution (GH36) ──────────────────────────────
  // Dialogue d'enregistrement ici (comme `export:save`), contenu construit côté main à partir de
  // la campagne.
  handle('campaigns:execution-sheet-export', async (
    _e,
    repoPath: string,
    campaignId: string,
    locale: ExecutionSheetLocale,
  ): Promise<ExportResult> => {
    const today = new Date().toISOString().slice(0, 10)
    const saveResult = await dialog.showSaveDialog({
      title: 'Exporter le classeur d’exécution',
      defaultPath: `${campaignId}_execution_${today}.xlsx`,
      filters: [EXPORT_DIALOG_FILTERS.xlsx],
    })
    if (saveResult.canceled || !saveResult.filePath) return { status: 'canceled' }
    return saveExecutionSheet(c, saveResult.filePath, repoPath, campaignId, locale)
  })
  // GH36 sprint 2 — import : choix du fichier puis aperçu (aucune écriture) ; l'application relit
  // le fichier et revalide contre l'état courant de la campagne.
  handle('campaigns:execution-sheet-preview', async (
    _e,
    repoPath: string,
    campaignId: string,
  ): Promise<ExecutionImportPreview | { canceled: true }> => {
    const result = await dialog.showOpenDialog({
      title: 'Importer des résultats d’exécution',
      filters: [EXPORT_DIALOG_FILTERS.xlsx],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    return c.campaignExecution.preview(repoPath, campaignId, result.filePaths[0])
  })

  // ── Dialog ───────────────────────────────────────────────────────────────────
  handle('dialog:pick-folder', async (_event, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title ?? 'Sélectionner un dossier',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  handle('dialog:pick-image-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Insérer une image',
      properties: ['openFile'],
      filters: IMAGE_DIALOG_FILTERS,
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    const ext = path.extname(filePath).toLowerCase().replace('.', '')
    const mimeType = IMAGE_MIME_BY_EXT[ext] ?? 'image/png'
    const data = await fsP.readFile(filePath, { encoding: 'base64' })
    return { mimeType, base64: data }
  })

  handle('dialog:pick-drawio-file', async (_e, repoPath: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Sélectionner un diagramme draw.io',
      properties: ['openFile'],
      filters: [{ name: 'draw.io', extensions: ['drawio'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { status: 'canceled' as const }
    return importFileIntoRepo(repoPath, result.filePaths[0], 'diagrams')
  })

  // ── Draw.io (T47) ────────────────────────────────────────────────────────────
  handle('drawio:open-external', async (_e, repoPath: string, relativePath: string) => {
    await shell.openPath(path.join(repoPath, relativePath))
  })

  // ── Image (T76) ──────────────────────────────────────────────────────────────
  handle('image:pick-file', async (_e, repoPath: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Insérer une image',
      properties: ['openFile'],
      filters: IMAGE_DIALOG_FILTERS,
    })
    if (result.canceled || !result.filePaths[0]) return { status: 'canceled' as const }
    return importFileIntoRepo(repoPath, result.filePaths[0], 'images')
  })

  // ── Export (T43) ─────────────────────────────────────────────────────────────
  handle('export:save', async (
    _e,
    repoPath: string,
    kind: ExportKind,
    format: ExportFormat,
    payload: unknown,
    printParams: Record<string, string> | undefined,
    suggestedName: string,
    templateRelPath?: string,
  ) => {
    const filter = EXPORT_DIALOG_FILTERS[format]
    if (!filter) return { status: 'error' as const, message: `Format d'export inconnu : "${format}"` }

    const saveResult = await dialog.showSaveDialog({
      title: 'Exporter',
      defaultPath: suggestedName,
      filters: [filter],
    })
    if (saveResult.canceled || !saveResult.filePath) return { status: 'canceled' as const }
    return saveExport(c, saveResult.filePath, repoPath, kind, format, payload, printParams, templateRelPath)
  })
  handle('export:show-in-folder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
  handle('export:open-file', (_e, filePath: string) => shell.openPath(filePath))

  // ── Terminal de la vue Version (GH238) ───────────────────────────────────────
  // Sortie et fin poussées par 'terminal:data' / 'terminal:exit'.
  handle('terminal:detect', () => terminal.detect())
  // Sessions tuées au rechargement / à la fermeture de la fenêtre (le renderer ne peut plus le
  // faire) ; écoute posée une fois par webContents.
  const watchedOwners = new Set<number>()
  handle('terminal:start', (e, kind: TerminalKind, cwd: string, cols: number, rows: number) => {
    const sender = (e as IpcMainInvokeEvent).sender
    const owner = sender.id
    if (!watchedOwners.has(owner)) {
      watchedOwners.add(owner)
      // Nouvelle page principale (rechargement, même en échec) — ni une iframe (visionneuse draw.io
      // des vues Exigences…), ni une navigation interne du router (même document).
      sender.on('did-start-navigation', details => {
        if (details.isMainFrame && !details.isSameDocument) terminal.killOwnedBy(owner)
      })
      sender.once('destroyed', () => {
        terminal.killOwnedBy(owner)
        watchedOwners.delete(owner)
      })
    }
    return terminal.start(kind, cwd, cols, rows, owner)
  })
  handle('terminal:write', (_e, id: string, data: string) => terminal.write(id, data))
  handle('terminal:cd', (_e, id: string, repoPath: string) => terminal.cd(id, repoPath))
  handle('terminal:resize', (_e, id: string, cols: number, rows: number) => terminal.resize(id, cols, rows))
  handle('terminal:kill', (_e, id: string) => terminal.kill(id))
  // URL fixe : pas un ouvreur d'URL générique exposé au renderer.
  handle('terminal:open-git-download', () => shell.openExternal('https://git-scm.com/downloads'))
}
