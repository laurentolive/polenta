import * as fsP from 'fs/promises'
import * as path from 'path'
import type { ExportKind, ExportFormat, ExecutionSheetLocale } from '@polenta/types'
import type { Container } from '../main/ipc/index'
import type { HandlerRegistry } from '../main/ipc/registry'
import { findAvailableFileName, importFileIntoRepo, saveExport, saveExecutionSheet } from '../main/ipc/file-ops'
import type { WEB_ONLY_CHANNELS } from './channel-policy'
import type { FileStore } from './file-store'

export interface UserDirs {
  root: string
  workspaces: string
  userData: string
}

export interface WebHandlerContext {
  container: Container
  dirs: UserDirs
  uploads: FileStore
  downloads: FileStore
  version: string
}

export interface WebWorkspaceEntry {
  name: string
  workspaceDir: string
}

/** Résultat d'un export web : le fichier attend dans `downloads/`, le navigateur le télécharge. */
export type WebDownloadResult =
  | { status: 'ok'; downloadId: string; fileName: string }
  | { status: 'error'; message: string }

function slug(name: string): string {
  const s = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '')
    .slice(0, 64)
  return s || 'projet'
}

/**
 * GH44 — channels propres au serveur web (specs/GH44-design.md §4.4, §5.4) : ce que le desktop fait
 * avec un dialogue natif passe ici par un dossier choisi par le serveur dans l'espace de
 * l'utilisateur, un upload ou un téléchargement.
 */
export function registerWebHandlers(r: HandlerRegistry, ctx: WebHandlerContext): void {
  const { container: c, dirs, uploads, downloads } = ctx
  const handle = (channel: typeof WEB_ONLY_CHANNELS[number], fn: Parameters<HandlerRegistry['handle']>[1]) =>
    r.handle(channel, fn)

  async function uploaded(uploadId: string): Promise<{ filePath: string; fileName: string }> {
    const file = await uploads.resolve(uploadId)
    if (!file) throw new Error('Fichier envoyé introuvable ou expiré, recommencez.')
    return file
  }

  async function workspaceChild(dir: string): Promise<string> {
    const resolved = path.resolve(dir)
    if (path.dirname(resolved) !== path.resolve(dirs.workspaces)) {
      throw new Error('Ce dossier n’est pas un projet de « Mes projets ».')
    }
    return resolved
  }

  handle('app:get-version', () => ctx.version)

  // ── Mes projets ─────────────────────────────────────────────────────────────────
  handle('web:workspaces-root', () => dirs.workspaces)

  handle('web:list-workspaces', async (): Promise<WebWorkspaceEntry[]> => {
    const entries = await fsP.readdir(dirs.workspaces, { withFileTypes: true }).catch(() => [])
    const result: WebWorkspaceEntry[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const workspaceDir = path.join(dirs.workspaces, entry.name)
      if (await c.workspace.detectWorkspace(workspaceDir) === 'workspace') {
        result.push({ name: entry.name, workspaceDir })
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  })

  // Remplace le choix du dossier de destination (démo, clone, création) : un dossier neuf, vide.
  handle('web:new-workspace-dir', async (_e, nameHint?: string) => {
    await fsP.mkdir(dirs.workspaces, { recursive: true })
    const name = await findAvailableFileName(dirs.workspaces, slug(String(nameHint ?? '')))
    const dir = path.join(dirs.workspaces, name)
    await fsP.mkdir(dir)
    return dir
  })

  // Refusé tant qu'un repo du projet a des modifications ou des commits non publiés, sauf `force`.
  handle('web:delete-workspace', async (_e, workspaceDir: string, force?: boolean) => {
    const dir = await workspaceChild(workspaceDir)
    const tree = await c.workspaceTree.readCache(dir).catch(() => null)
    const repoPaths = new Set((tree?.nodes ?? []).map(n => n.repoPath).filter(Boolean))
    if (!force) {
      const dirty: string[] = []
      for (const repoPath of repoPaths) {
        const status = await c.sync.status(repoPath).catch(() => null)
        if (status && (status.staged.length > 0 || status.unstaged.length > 0 || status.ahead > 0)) {
          dirty.push(path.basename(repoPath))
        }
      }
      if (dirty.length > 0) return { status: 'unpublished' as const, repos: dirty }
    }
    for (const repoPath of repoPaths) c.watcher.unwatch(repoPath)
    const lastOpened = await c.workspace.getLastOpened()
    if (lastOpened && path.resolve(lastOpened.workspaceDir) === dir) await c.workspace.clearLastOpened()
    await fsP.rm(dir, { recursive: true, force: true })
    return { status: 'deleted' as const }
  })

  // ── Fichiers envoyés (remplacent les dialogues d'ouverture) ────────────────────
  handle('web:image-import', async (_e, repoPath: string, uploadId: string) => {
    const file = await uploaded(uploadId)
    const result = await importFileIntoRepo(repoPath, file.filePath, 'images', file.fileName)
    await uploads.remove(uploadId)
    return result
  })
  handle('web:drawio-import', async (_e, repoPath: string, uploadId: string) => {
    const file = await uploaded(uploadId)
    const result = await importFileIntoRepo(repoPath, file.filePath, 'diagrams', file.fileName)
    await uploads.remove(uploadId)
    return result
  })
  handle('web:execution-sheet-preview', async (_e, repoPath: string, campaignId: string, uploadId: string) => {
    const file = await uploaded(uploadId)
    return c.campaignExecution.preview(repoPath, campaignId, file.filePath)
  })

  // ── Exports (remplacent « Enregistrer sous ») ───────────────────────────────────
  handle('web:execution-sheet-export', async (
    _e, repoPath: string, campaignId: string, locale: ExecutionSheetLocale,
  ): Promise<WebDownloadResult> => {
    const today = new Date().toISOString().slice(0, 10)
    const target = await downloads.create(`${campaignId}_execution_${today}.xlsx`)
    const result = await saveExecutionSheet(c, target.filePath, repoPath, campaignId, locale)
    if (result.status !== 'ok') {
      await downloads.remove(target.id)
      return { status: 'error', message: result.status === 'error' ? result.message : 'Export annulé' }
    }
    return { status: 'ok', downloadId: target.id, fileName: target.fileName }
  })
  handle('web:export', async (
    _e,
    repoPath: string,
    kind: ExportKind,
    format: ExportFormat,
    payload: unknown,
    printParams: Record<string, string> | undefined,
    suggestedName: string,
    templateRelPath?: string,
  ): Promise<WebDownloadResult> => {
    const target = await downloads.create(suggestedName || `export.${format}`)
    const result = await saveExport(c, target.filePath, repoPath, kind, format, payload, printParams, templateRelPath)
    if (result.status !== 'ok') {
      await downloads.remove(target.id)
      return { status: 'error', message: result.status === 'error' ? result.message : 'Export annulé' }
    }
    return { status: 'ok', downloadId: target.id, fileName: target.fileName }
  })
}
