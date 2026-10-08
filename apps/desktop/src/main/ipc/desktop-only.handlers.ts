import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import * as fsP from 'fs/promises'
import * as path from 'path'
import type { ExportKind, ExportFormat, ExportResult, ExecutionSheetLocale, ExecutionImportPreview } from '@polenta/types'
import type { Container } from './index'
import type { HandlerRegistry } from './registry'
import type { PlatformHost } from '../host/platform-host'
import type { UpdateService } from '../services/update.service'
import { IMAGE_MIME_BY_EXT, importFileIntoRepo, saveExport, saveExecutionSheet } from './file-ops'

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

export function registerDesktopOnlyHandlers(c: Container, update: UpdateService): void {
  // ── Auth : Device Flow GitHub (ouvre le navigateur du poste) ──────────────────
  ipcMain.handle('auth:device-flow-start', (_e, remote: string) => c.auth.startDeviceFlow(remote))
  ipcMain.handle('auth:device-flow-poll', (_e, remote: string, deviceCode: string) =>
    c.auth.pollDeviceFlow(remote, deviceCode))

  // ── App ───────────────────────────────────────────────────────────────────────
  ipcMain.handle('app:set-title', (_event, title: string) => {
    BrowserWindow.getFocusedWindow()?.setTitle(title)
  })
  // app.getVersion() lit le champ "version" de package.json (packagé dans app.asar par
  // electron-builder) — c'est aussi ce champ qui alimente le macro ${version} de
  // electron-builder.yml pour le nom de l'exe généré : une seule string à modifier à
  // chaque release.
  ipcMain.handle('app:get-version', () => app.getVersion())
  // GH26 — restreint aux pages de release du repo : seul usage (lien « Voir les nouveautés »),
  // pas un ouvreur d'URL générique exposé au renderer.
  ipcMain.handle('app:open-release-page', (_e, url: string) => {
    if (url.startsWith('https://github.com/laurentolive/polenta/releases/')) return shell.openExternal(url)
  })

  // ── Update (GH26) ─────────────────────────────────────────────────────────────
  // État poussé aux fenêtres par 'update:state-changed' ; get-state couvre une fenêtre
  // montée après l'événement.
  ipcMain.handle('update:get-state', () => update.getState())
  ipcMain.handle('update:install', () => update.install())

  // ── Campagnes : classeur Excel d'exécution (GH36) ──────────────────────────────
  // Dialogue d'enregistrement ici (comme `export:save`), contenu construit côté main à partir de
  // la campagne.
  ipcMain.handle('campaigns:execution-sheet-export', async (
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
  ipcMain.handle('campaigns:execution-sheet-preview', async (
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
  ipcMain.handle('dialog:pick-folder', async (_event, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title ?? 'Sélectionner un dossier',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:pick-image-file', async () => {
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

  ipcMain.handle('dialog:pick-drawio-file', async (_e, repoPath: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Sélectionner un diagramme draw.io',
      properties: ['openFile'],
      filters: [{ name: 'draw.io', extensions: ['drawio'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { status: 'canceled' as const }
    return importFileIntoRepo(repoPath, result.filePaths[0], 'diagrams')
  })

  // ── Draw.io (T47) ────────────────────────────────────────────────────────────
  ipcMain.handle('drawio:open-external', async (_e, repoPath: string, relativePath: string) => {
    await shell.openPath(path.join(repoPath, relativePath))
  })

  // ── Image (T76) ──────────────────────────────────────────────────────────────
  ipcMain.handle('image:pick-file', async (_e, repoPath: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Insérer une image',
      properties: ['openFile'],
      filters: IMAGE_DIALOG_FILTERS,
    })
    if (result.canceled || !result.filePaths[0]) return { status: 'canceled' as const }
    return importFileIntoRepo(repoPath, result.filePaths[0], 'images')
  })

  // ── Export (T43) ─────────────────────────────────────────────────────────────
  ipcMain.handle('export:save', async (
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
  ipcMain.handle('export:show-in-folder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
  ipcMain.handle('export:open-file', (_e, filePath: string) => shell.openPath(filePath))
}
