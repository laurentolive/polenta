import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import git from 'isomorphic-git'

import type { GitService } from './git.service'
import type { SyncService } from './sync.service'
import type { WorkspaceService } from './workspace.service'
import type { DashboardSeedService } from './dashboard-seed.service'
import { GITATTRIBUTES_LINE, GITIGNORE_LINES, isLocalStateFile } from './repo-conformity.util'

/** GH336 — un élément de mise en conformité (miroir : `@polenta/api-client` types). */
export interface ConformityItem {
  id: 'gitattributes' | 'gitignore' | 'tracked-local' | 'agent-files' | 'dashboards-seed'
  files: string[]
}
export interface ConformityResult {
  sha: string | null
  pushed: boolean
  pushError?: string
}

/**
 * GH336 (spec §3.2, §4, §6) — mise en conformité d'un repo Polenta existant. Polenta n'écrit plus
 * de fichier versionné de lui-même : `check` dit ce qui manque, l'utilisateur valide, `apply` écrit,
 * commite **ces seuls fichiers** et pousse aussitôt — rien ne reste en modification locale.
 */
export class RepoConformityService {
  constructor(
    private readonly git: GitService,
    private readonly sync: SyncService,
    private readonly workspace: WorkspaceService,
    /** Contenu partagé des dashboards (Status, bibliothèque) : repo racine seulement. */
    private readonly dashboardSeed?: DashboardSeedService,
    private readonly usernameOf: (repoPath: string) => Promise<string> = async () => 'local',
  ) {}

  async check(repoPath: string, root: boolean): Promise<ConformityItem[]> {
    const items: ConformityItem[] = []
    const attributes = await readText(repoPath, '.gitattributes')
    if (!lines(attributes).includes(GITATTRIBUTES_LINE)) {
      items.push({ id: 'gitattributes', files: ['.gitattributes'] })
    }
    const ignore = lines(await readText(repoPath, '.gitignore'))
    if (GITIGNORE_LINES.some(l => !ignore.includes(l))) items.push({ id: 'gitignore', files: ['.gitignore'] })
    const tracked = (await git.listFiles({ fs, dir: repoPath, ref: 'HEAD' }).catch(() => [] as string[]))
      .filter(isLocalStateFile)
    if (tracked.length > 0) items.push({ id: 'tracked-local', files: tracked })
    if (root) {
      const agentFiles = await this.workspace.pendingAgentFiles(repoPath)
      if (agentFiles.length > 0) items.push({ id: 'agent-files', files: agentFiles.map(f => f.path) })
      if (this.dashboardSeed && await this.dashboardSeed.sharedSeedPending(repoPath, await this.usernameOf(repoPath)).catch(() => false)) {
        items.push({ id: 'dashboards-seed', files: ['dashboards/', 'queries/'] })
      }
    }
    return items
  }

  async apply(repoPath: string, root: boolean): Promise<ConformityResult> {
    const items = await this.check(repoPath, root)
    if (items.length === 0) return { sha: null, pushed: true }

    // Un fichier local commité par erreur (et modifié) est justement ce que la mise en conformité
    // corrige : il ne compte pas comme modification à publier d'abord.
    const { staged, unstaged } = await this.sync.status(repoPath)
    if ([...staged, ...unstaged].some(f => !isLocalStateFile(f.path))) throw new Error('conformity-dirty')
    const integration = await this.git.getIntegrationBranch(repoPath)
    const branch = await git.currentBranch({ fs, dir: repoPath })
    if (branch !== integration) throw new Error(`conformity-off-integration:${integration}`)

    // Intégration à jour avec origin avant d'y commiter (règles de Publier, GH39).
    await this.sync.fetch(repoPath, '')
    const { state } = await this.sync.integrationState(repoPath, integration)
    if (state === 'diverged') throw new Error('conformity-diverged')
    if (state === 'behind') {
      const pulled = await this.sync.pull(repoPath)
      if (!pulled.success) throw new Error('conformity-diverged')
    }

    const ids = new Set(items.map(i => i.id))
    if (ids.has('gitattributes')) {
      // En tête : les règles plus précises écrites après (ex. `-text` d'un fichier vendoré) l'emportent.
      const existing = await readText(repoPath, '.gitattributes')
      await fsP.writeFile(path.join(repoPath, '.gitattributes'), `${GITATTRIBUTES_LINE}\n${existing ?? ''}`)
    }
    if (ids.has('gitignore')) {
      const existing = (await readText(repoPath, '.gitignore')) ?? ''
      const missing = GITIGNORE_LINES.filter(l => !lines(existing).includes(l))
      const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
      await fsP.writeFile(path.join(repoPath, '.gitignore'), `${existing}${prefix}${missing.join('\n')}\n`)
    }
    if (ids.has('agent-files')) {
      for (const f of await this.workspace.pendingAgentFiles(repoPath)) {
        await fsP.writeFile(path.join(repoPath, f.path), f.content, 'utf-8')
      }
    }
    if (ids.has('dashboards-seed')) await this.dashboardSeed!.applySharedSeed(repoPath, await this.usernameOf(repoPath))
    // Arbre propre au départ (hors fichiers locaux) : tout ce qui a changé vient de cette mise à jour.
    await this.sync.stageAll(repoPath)
    // Retirés de l'index seulement : le fichier local (préférences) reste sur le disque.
    for (const filepath of items.find(i => i.id === 'tracked-local')?.files ?? []) {
      await git.remove({ fs, dir: repoPath, filepath })
    }
    const labels = items.map(i => i.id).join(', ')
    const { sha } = await this.sync.commit(repoPath, `[polenta] Mise en conformité du dépôt (${labels})`)
    if (ids.has('gitattributes')) await normalizeEol(repoPath)

    try {
      await this.sync.pushBranch(repoPath, integration)
      return { sha, pushed: true }
    } catch (err: unknown) {
      return { sha, pushed: false, pushError: err instanceof Error ? err.message : String(err) }
    }
  }
}

async function readText(repoPath: string, rel: string): Promise<string | null> {
  return fsP.readFile(path.join(repoPath, rel), 'utf-8').catch(() => null)
}

function lines(text: string | null): string[] {
  return (text ?? '').split(/\r?\n/).map(l => l.trim())
}

/** Fichiers suivis qui ne diffèrent de HEAD que par CRLF : réécrits tels que dans git (LF). */
async function normalizeEol(repoPath: string): Promise<void> {
  const headOid = await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
  const cache = {}
  for (const filepath of await git.listFiles({ fs, dir: repoPath, ref: 'HEAD' })) {
    const abs = path.join(repoPath, filepath)
    const onDisk = await fsP.readFile(abs).catch(() => null)
    if (!onDisk || !onDisk.includes('\r\n') || onDisk.subarray(0, 8000).includes(0)) continue
    const { blob } = await git.readBlob({ fs, dir: repoPath, oid: headOid, filepath, cache })
    const inGit = Buffer.from(blob)
    if (inGit.includes('\r\n')) continue
    if (Buffer.from(onDisk.toString('latin1').replace(/\r\n/g, '\n'), 'latin1').equals(inGit)) {
      await fsP.writeFile(abs, inGit)
    }
  }
}
