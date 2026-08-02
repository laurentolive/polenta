import { app } from 'electron'
import * as fsPromises from 'fs/promises'
import * as fs from 'fs'
import * as path from 'path'
import git from 'isomorphic-git'
import * as yaml from 'js-yaml'

import type { SyncService } from './sync.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { RepoWatcherService } from './repo-watcher.service'
import { AGENTS_MD_TEMPLATE, AGENTS_MD_TEMPLATE_VERSION, extractAgentsMdVersion } from './agents-md.template'
import { resolveMcpServerLaunchConfig } from './mcp-launch.util'
import {
  buildMcpJsonContent,
  extractMcpJsonVersion,
  MCP_JSON_TEMPLATE_VERSION,
} from '../../mcp-server/mcp-json.template'
import type {
  PolentaWorkspaceConfig,
  WorkspaceTree,
  WorkspaceTreeNode,
  WorkspaceOpenResult,
  MountOverride,
  ProjectRecent,
  ProjectInfo,
  ProjectSchema,
} from '@polenta/types'
import { findSystemNode } from '@polenta/types'

interface RecentsStore {
  recents: ProjectRecent[]
  /** workspaceDir of the project currently open, so the home page can jump back into it. */
  lastOpenedDir?: string
}

export class WorkspaceService {
  private get workspacePath(): string {
    return path.join(app.getPath('userData'), 'workspace.json')
  }

  constructor(
    private readonly syncService: SyncService,
    private readonly workspaceTreeService?: WorkspaceTreeService,
    // T112 — starts the requirements/tests index's git-log-based cache invalidation
    // (see RepoWatcherService) for every repo in the workspace as soon as it's opened.
    // Optional to match workspaceTreeService's existing pattern (some construction paths
    // — tests, minimal fallback wiring — don't need it).
    private readonly watcherService?: RepoWatcherService,
  ) {}

  // ── Detection ─────────────────────────────────────────────────────────────────

  /**
   * Detect the nature of a directory:
   * - 'workspace'  → contains <dir>/.polenta/workspace.yaml
   * - 'repo'       → is a git repo but not a workspace
   * - 'unknown'    → neither
   */
  async detectWorkspace(dir: string): Promise<'workspace' | 'repo' | 'unknown'> {
    const markerPath = path.join(dir, '.polenta', 'workspace.yaml')
    const hasMarker = await fsPromises.stat(markerPath).then(() => true).catch(() => false)
    if (hasMarker) return 'workspace'

    const dotGit = path.join(dir, '.git')
    const hasGit = await fsPromises.stat(dotGit).then(() => true).catch(() => false)
    if (hasGit) return 'repo'

    return 'unknown'
  }

  // ── Opening / creating projects (renderer-facing entry points) ─────────────────

  /**
   * Open a project from a single directory chosen by the user.
   * - Already a workspace → open directly.
   * - A bare git repo (no `.polenta/workspace.yaml` yet) → adopted in place as a
   *   self-contained workspace (no files moved, no container promotion).
   * - Neither → not a Polenta project.
   */
  async openProject(dir: string): Promise<WorkspaceOpenResult> {
    const kind = await this.detectWorkspace(dir)
    if (kind === 'unknown') return { status: 'not-a-workspace' }
    if (kind === 'repo') {
      await this.initWorkspace(dir, dir)
    }
    return this.openWorkspace(dir)
  }

  /**
   * Create a brand new project: a fresh git repo, always nested one level
   * inside the chosen container directory.
   */
  async createNewProject(containerDir: string, name: string): Promise<WorkspaceOpenResult> {
    const rootRepoPath = path.join(containerDir, name)
    await fsPromises.mkdir(rootRepoPath, { recursive: true })
    await git.init({ fs, dir: rootRepoPath, defaultBranch: 'main' })

    await fsPromises.writeFile(
      path.join(rootRepoPath, '.gitignore'),
      '.polenta/tree.cache.yaml\n*.pref\n',
      'utf-8',
    )
    await fsPromises.writeFile(path.join(rootRepoPath, 'AGENTS.md'), AGENTS_MD_TEMPLATE, 'utf-8')
    // T122 sprint 4 — `.mcp.json` généré au même endroit/moment qu'`AGENTS.md` (T106),
    // pré-configuré pour lancer le serveur MCP de ce projet (cf. mcp-launch.util.ts).
    await fsPromises.writeFile(
      path.join(rootRepoPath, '.mcp.json'),
      buildMcpJsonContent(resolveMcpServerLaunchConfig()),
      'utf-8',
    )
    await git.add({ fs, dir: rootRepoPath, filepath: '.gitignore' })
    await git.add({ fs, dir: rootRepoPath, filepath: 'AGENTS.md' })
    await git.add({ fs, dir: rootRepoPath, filepath: '.mcp.json' })
    await git.commit({
      fs,
      dir: rootRepoPath,
      message: 'init: create project',
      author: { name: 'Polenta', email: 'polenta@localhost' },
    })

    await this.initWorkspace(containerDir, rootRepoPath)
    return this.openWorkspace(containerDir)
  }

  /**
   * Create a new project by cloning an existing remote repo, always nested
   * one level inside the chosen container directory.
   */
  async createFromClone(
    containerDir: string,
    remoteUrl: string,
    onProgress?: (phase: string, loaded: number, total: number) => void,
  ): Promise<WorkspaceOpenResult> {
    const name = path.basename(remoteUrl.replace(/\.git$/, '').replace(/\/+$/, ''))
    const rootRepoPath = path.join(containerDir, name)
    await fsPromises.mkdir(rootRepoPath, { recursive: true })
    await this.syncService.clone(
      remoteUrl,
      rootRepoPath,
      onProgress ? (p) => onProgress('cloning', p, 100) : undefined,
    )
    await this.initWorkspace(containerDir, rootRepoPath)
    return this.openWorkspace(containerDir)
  }

  /**
   * Resolve a workspace dir to the identity used throughout the app
   * (name + the actual repo path where requirements/tests/config live).
   */
  async resolve(workspaceDir: string): Promise<ProjectInfo> {
    const markerPath = path.join(workspaceDir, '.polenta', 'workspace.yaml')
    let config: PolentaWorkspaceConfig = {}
    try {
      const raw = await fsPromises.readFile(markerPath, 'utf-8')
      config = (yaml.load(raw) as PolentaWorkspaceConfig) ?? {}
    } catch {
      throw new Error(`Not a Polenta project: ${workspaceDir}`)
    }

    const localPath = this.resolveRootRepoPath(workspaceDir, config) ?? workspaceDir
    const label = await this.readRootLabel(localPath)
    const remoteUrl = await this.readRemoteUrl(localPath)
    return { name: path.basename(localPath), label, localPath, workspaceDir, remoteUrl }
  }

  /** Root SystemNode's configured `label`, if any (schema.yaml may be absent/invalid). */
  private async readRootLabel(repoPath: string): Promise<string | undefined> {
    try {
      const schemaPath = path.join(repoPath, '.polenta', 'schema.yaml')
      const raw = await fsPromises.readFile(schemaPath, 'utf-8')
      const schema = (yaml.load(raw) as ProjectSchema) ?? undefined
      return schema ? findSystemNode(schema.nodes, 'root')?.label : undefined
    } catch {
      return undefined
    }
  }

  /** Root repo's `origin` remote URL, if any is configured. */
  private async readRemoteUrl(repoPath: string): Promise<string | undefined> {
    try {
      const remotes = await git.listRemotes({ fs, dir: repoPath })
      return remotes.find((r: { remote: string; url: string }) => r.remote === 'origin')?.url ?? undefined
    } catch {
      return undefined
    }
  }

  // ── Recents ───────────────────────────────────────────────────────────────────

  /** List recently opened projects, silently dropping entries that no longer resolve. */
  async listRecents(): Promise<ProjectRecent[]> {
    const store = await this.readRecents()
    const checked = await Promise.all(
      store.recents.map(async (r) => ({
        recent: r,
        alive: (await this.detectWorkspace(r.workspaceDir)) !== 'unknown',
      })),
    )
    const alive = checked.filter((c) => c.alive).map((c) => c.recent)
    if (alive.length !== store.recents.length) {
      await this.writeRecents({ recents: alive })
    }
    return alive.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
  }

  async markRecent(workspaceDir: string): Promise<void> {
    const store = await this.readRecents()
    const norm = path.resolve(workspaceDir)
    const idx = store.recents.findIndex((r) => path.resolve(r.workspaceDir) === norm)
    const entry: ProjectRecent = {
      workspaceDir,
      name: path.basename(workspaceDir),
      lastOpenedAt: new Date().toISOString(),
    }
    if (idx >= 0) {
      store.recents[idx] = entry
    } else {
      store.recents.push(entry)
    }
    store.lastOpenedDir = workspaceDir
    await this.writeRecents(store)
  }

  /** The project currently open, if any — used to jump straight past the home page. */
  async getLastOpened(): Promise<ProjectRecent | null> {
    const store = await this.readRecents()
    if (!store.lastOpenedDir) return null
    if ((await this.detectWorkspace(store.lastOpenedDir)) === 'unknown') {
      store.lastOpenedDir = undefined
      await this.writeRecents(store)
      return null
    }
    const norm = path.resolve(store.lastOpenedDir)
    return store.recents.find((r) => path.resolve(r.workspaceDir) === norm) ?? null
  }

  /** Clear the "currently open" pointer (closing a project) without touching recents history. */
  async clearLastOpened(): Promise<void> {
    const store = await this.readRecents()
    store.lastOpenedDir = undefined
    await this.writeRecents(store)
  }

  private async readRecents(): Promise<RecentsStore> {
    try {
      const raw = await fsPromises.readFile(this.workspacePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<RecentsStore>
      return {
        recents: Array.isArray(parsed.recents) ? parsed.recents : [],
        lastOpenedDir: parsed.lastOpenedDir,
      }
    } catch {
      return { recents: [] }
    }
  }

  private async writeRecents(store: RecentsStore): Promise<void> {
    await fsPromises.mkdir(path.dirname(this.workspacePath), { recursive: true })
    await fsPromises.writeFile(this.workspacePath, JSON.stringify(store, null, 2), 'utf-8')
  }

  // ── Flat workspace methods (T69) ─────────────────────────────────────────────

  /**
   * Initialise a new flat workspace in <workspaceDir>.
   * Writes <workspaceDir>/.polenta/workspace.yaml.
   * If rootRepoPath === workspaceDir, marks the workspace as self-contained
   * (the workspace dir IS the repo — no nesting, used to adopt a pre-existing
   * bare repo in place). Otherwise rootRepoPath must be a direct child of
   * workspaceDir and must already exist on disk.
   * Does NOT modify any git repository.
   */
  async initWorkspace(workspaceDir: string, rootRepoPath: string): Promise<void> {
    const polentaDir = path.join(workspaceDir, '.polenta')
    await fsPromises.mkdir(polentaDir, { recursive: true })

    const config: PolentaWorkspaceConfig =
      path.resolve(rootRepoPath) === path.resolve(workspaceDir)
        ? { selfContained: true }
        : { rootRepo: path.basename(rootRepoPath) }

    const filePath = path.join(polentaDir, 'workspace.yaml')
    await fsPromises.writeFile(filePath, yaml.dump(config, { lineWidth: 120 }), 'utf-8')
    console.log('[WorkspaceService] workspace initialised at', workspaceDir)
  }

  /**
   * Open an existing flat workspace.
   * Performs full recursive parsing via WorkspaceTreeService (if available),
   * with diamond-conflict and parse-error support.
   * Falls back to a minimal tree (root only) when WorkspaceTreeService is not injected.
   *
   * Returns 'not-a-workspace' if .polenta/workspace.yaml is absent.
   */
  async openWorkspace(workspaceDir: string): Promise<WorkspaceOpenResult> {
    const markerPath = path.join(workspaceDir, '.polenta', 'workspace.yaml')

    let config: PolentaWorkspaceConfig = {}
    try {
      const raw = await fsPromises.readFile(markerPath, 'utf-8')
      config = (yaml.load(raw) as PolentaWorkspaceConfig) ?? {}
    } catch {
      return { status: 'not-a-workspace' }
    }

    const rootRepoPath = this.resolveRootRepoPath(workspaceDir, config)
    if (!rootRepoPath) {
      // Workspace marker exists but has no rootRepo — return minimal tree
      const tree: WorkspaceTree = {
        rootRepoHeadSha: '',
        generatedAt: new Date().toISOString(),
        nodes: [],
        logicalTree: {
          name: '',
          repoPath: workspaceDir,
          url: '',
          pin: '',
          isInterface: false,
          children: [],
        },
      }
      if (this.workspaceTreeService) {
        await this.workspaceTreeService.writeCache(workspaceDir, tree)
      } else {
        await this.writeCacheTree(workspaceDir, tree)
      }
      this.watchTree(tree)
      return { status: 'ok', tree }
    }

    // T122 sprint 4, point 7 (absorbe T121) — contrôle/régénère AGENTS.md/.mcp.json à
    // CHAQUE ouverture d'un projet existant, avant tout autre traitement (y compris le
    // court-circuit "cache valide" ci-dessous) : couvre aussi bien les projets créés
    // avant T106/T122 (jamais générés) que ceux dont le gabarit a évolué depuis leur
    // création. Best-effort — ne bloque jamais l'ouverture du projet en cas d'échec.
    await this.ensureAgentFiles(rootRepoPath)

    // Get HEAD SHA of root repo (for cache invalidation)
    let headSha = ''
    try {
      headSha = await git.resolveRef({ fs, dir: rootRepoPath, ref: 'HEAD' })
    } catch {
      // Not a valid git repo or empty repo — proceed with empty SHA
    }

    // Use WorkspaceTreeService for full recursive parsing
    if (this.workspaceTreeService) {
      // Check if cache is still valid
      if (await this.workspaceTreeService.isCacheValid(workspaceDir, rootRepoPath)) {
        const cached = await this.workspaceTreeService.readCache(workspaceDir)
        if (cached) {
          console.log('[WorkspaceService] using cached tree for', workspaceDir)
          this.watchTree(cached)
          return { status: 'ok', tree: cached }
        }
      }

      // Build full tree via recursive parsing
      const mountOverrides: MountOverride[] = config.mountOverrides ?? []
      const result = await this.workspaceTreeService.buildTree(workspaceDir, rootRepoPath, mountOverrides)

      if (result.status === 'diamond-conflict') {
        return result
      }
      if (result.status === 'parse-error') {
        return result
      }
      if (result.status === 'cycle') {
        return {
          status: 'parse-error',
          repoName: result.cycle[result.cycle.length - 1] ?? path.basename(rootRepoPath),
          error: `Cycle de dépendance détecté : ${result.cycle.join(' → ')}`,
        }
      }

      await this.workspaceTreeService.writeCache(workspaceDir, result.tree)
      this.watchTree(result.tree)
      return { status: 'ok', tree: result.tree }
    }

    // Fallback: minimal tree (root only)
    const cachedTree = await this.readCacheTree(workspaceDir)
    if (cachedTree && cachedTree.rootRepoHeadSha === headSha && headSha !== '') {
      console.log('[WorkspaceService] using cached tree for', workspaceDir)
      this.watchTree(cachedTree)
      return { status: 'ok', tree: cachedTree }
    }

    const rootNode: WorkspaceTreeNode = {
      name: path.basename(rootRepoPath),
      repoPath: rootRepoPath,
      url: '',
      pin: headSha,
      isInterface: false,
      children: [],
    }

    const tree: WorkspaceTree = {
      rootRepoHeadSha: headSha,
      generatedAt: new Date().toISOString(),
      nodes: [rootNode],
      logicalTree: rootNode,
    }

    await this.writeCacheTree(workspaceDir, tree)
    this.watchTree(tree)
    return { status: 'ok', tree }
  }

  /**
   * Contrôle/régénère `AGENTS.md` et `.mcp.json` à la racine du repo produit (T122
   * sprint 4, point 7 du spec — absorbe T121) : absents OU marqueur de version périmé
   * → régénérés ; déjà à jour → **aucune écriture** (mtime/hash inchangés — vérifié
   * manuellement, cf. specs/T122-sprint4.md). Comparaison par marqueur de version
   * embarqué dans le fichier généré (`extractAgentsMdVersion`/`extractMcpJsonVersion`),
   * PAS par contenu byte à byte : un projet dont l'utilisateur a ajouté ses propres
   * notes en bas d'`AGENTS.md` n'est pas réécrit tant que le gabarit n'a pas changé de
   * version (cf. specs/T122.md point 7).
   *
   * Appelée à chaque `openWorkspace()` avec un `rootRepoPath` résolu (donc à chaque
   * "ouverture d'un projet" — nouveau, existant, cloné) — best-effort : une erreur de
   * lecture/écriture (permissions, repo en lecture seule) est journalisée sur stderr
   * mais n'empêche jamais l'ouverture du projet.
   */
  async ensureAgentFiles(
    rootRepoPath: string,
  ): Promise<{ agentsMdRegenerated: boolean; mcpJsonRegenerated: boolean }> {
    const [agentsMdRegenerated, mcpJsonRegenerated] = await Promise.all([
      this.ensureAgentsMd(rootRepoPath).catch((err: unknown) => {
        console.error('[WorkspaceService] échec vérification/régénération AGENTS.md :', err)
        return false
      }),
      this.ensureMcpJson(rootRepoPath).catch((err: unknown) => {
        console.error('[WorkspaceService] échec vérification/régénération .mcp.json :', err)
        return false
      }),
    ])
    return { agentsMdRegenerated, mcpJsonRegenerated }
  }

  private async ensureAgentsMd(rootRepoPath: string): Promise<boolean> {
    return this.ensureVersionedFile(
      path.join(rootRepoPath, 'AGENTS.md'),
      'AGENTS.md',
      extractAgentsMdVersion,
      AGENTS_MD_TEMPLATE_VERSION,
      AGENTS_MD_TEMPLATE,
    )
  }

  private async ensureMcpJson(rootRepoPath: string): Promise<boolean> {
    return this.ensureVersionedFile(
      path.join(rootRepoPath, '.mcp.json'),
      '.mcp.json',
      extractMcpJsonVersion,
      MCP_JSON_TEMPLATE_VERSION,
      // Résolu paresseusement (pas passé en paramètre) : uniquement calculé quand une
      // régénération s'avère nécessaire (évite un `app.getAppPath()`/`app.isPackaged`
      // inutile sur le chemin "déjà à jour", très majoritaire à chaque ouverture).
      () => buildMcpJsonContent(resolveMcpServerLaunchConfig()),
    )
  }

  /**
   * Factorise le motif commun à `ensureAgentsMd`/`ensureMcpJson` (trouvé en revue de
   * code) : lit `filePath`, extrait son marqueur de version, régénère seulement si
   * absent/périmé — sinon aucune écriture (mtime/hash inchangés). `buildContent` est
   * un callback (pas une valeur déjà calculée) pour ne construire le contenu que
   * lorsqu'une régénération est effectivement nécessaire.
   */
  private async ensureVersionedFile(
    filePath: string,
    label: string,
    extractVersion: (content: string) => number | undefined,
    targetVersion: number,
    buildContent: string | (() => string),
  ): Promise<boolean> {
    const currentVersion = await fsPromises
      .readFile(filePath, 'utf-8')
      .then(extractVersion)
      .catch(() => undefined)
    if (currentVersion === targetVersion) return false

    const content = typeof buildContent === 'function' ? buildContent() : buildContent
    await fsPromises.writeFile(filePath, content, 'utf-8')
    console.log(`[WorkspaceService] ${label} régénéré (absent ou marqueur périmé) :`, filePath)
    return true
  }

  /** Starts the git-log cache watcher (RepoWatcherService) for every repo in the tree —
   *  idempotent (RepoWatcherService.watch() no-ops if a repo is already watched), so safe
   *  to call on every openWorkspace() regardless of whether the tree came from cache. */
  private watchTree(tree: WorkspaceTree): void {
    for (const node of tree.nodes) {
      this.watcherService?.watch(node.repoPath)
    }
  }

  /** Root repo path implied by a workspace config, or undefined if not yet linked. */
  private resolveRootRepoPath(workspaceDir: string, config: PolentaWorkspaceConfig): string | undefined {
    if (config.selfContained) return workspaceDir
    if (config.rootRepo) return path.join(workspaceDir, config.rootRepo)
    return undefined
  }

  /**
   * Get the cached workspace tree (alias for the private method, exposed for IPC).
   */
  async getCacheTree(workspaceDir: string): Promise<WorkspaceTree | null> {
    if (this.workspaceTreeService) {
      return this.workspaceTreeService.readCache(workspaceDir)
    }
    return this.readCacheTree(workspaceDir)
  }

  /**
   * Rebuild the workspace tree from scratch (ignores cache).
   */
  async rebuildTree(workspaceDir: string): Promise<WorkspaceOpenResult> {
    // Delete cache so openWorkspace rebuilds it
    const cachePath = path.join(workspaceDir, '.polenta', 'tree.cache.yaml')
    await fsPromises.unlink(cachePath).catch(() => {})
    return this.openWorkspace(workspaceDir)
  }

  /**
   * Set a mount-override in .polenta/workspace.yaml.
   */
  async setMountOverride(workspaceDir: string, override: MountOverride): Promise<void> {
    if (this.workspaceTreeService) {
      return this.workspaceTreeService.setMountOverride(workspaceDir, override)
    }
    // Fallback: write directly
    const markerPath = path.join(workspaceDir, '.polenta', 'workspace.yaml')
    let config: PolentaWorkspaceConfig = {}
    try {
      const raw = await fsPromises.readFile(markerPath, 'utf-8')
      config = (yaml.load(raw) as PolentaWorkspaceConfig) ?? {}
    } catch { /* ignore */ }

    const existing = config.mountOverrides ?? []
    const idx = existing.findIndex(o => o.url === override.url && o.pin === override.pin)
    if (idx >= 0) {
      existing[idx] = override
    } else {
      existing.push(override)
    }
    config.mountOverrides = existing

    await fsPromises.mkdir(path.dirname(markerPath), { recursive: true })
    await fsPromises.writeFile(markerPath, yaml.dump(config, { lineWidth: 120 }), 'utf-8')
  }

  /** Read the cached workspace tree from <workspaceDir>/.polenta/tree.cache.yaml */
  private async readCacheTree(workspaceDir: string): Promise<WorkspaceTree | null> {
    const cachePath = path.join(workspaceDir, '.polenta', 'tree.cache.yaml')
    try {
      const raw = await fsPromises.readFile(cachePath, 'utf-8')
      return (yaml.load(raw) as WorkspaceTree) ?? null
    } catch {
      return null
    }
  }

  /** Write the workspace tree to <workspaceDir>/.polenta/tree.cache.yaml */
  private async writeCacheTree(workspaceDir: string, tree: WorkspaceTree): Promise<void> {
    const polentaDir = path.join(workspaceDir, '.polenta')
    await fsPromises.mkdir(polentaDir, { recursive: true })
    const cachePath = path.join(polentaDir, 'tree.cache.yaml')
    await fsPromises.writeFile(cachePath, yaml.dump(tree, { lineWidth: 120 }), 'utf-8')
  }
}
