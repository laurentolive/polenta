/**
 * WorkspaceTreeService — Sprint 2 (T69)
 *
 * Responsible for:
 * - Two-pass recursive parsing of polenta-repo.yaml (DFS)
 * - Cycle detection (via URL set)
 * - Diamond conflict detection (same URL, different pins)
 * - Cloning missing dependencies via SyncService
 * - Reading / writing the tree cache at <workspace>/.polenta/tree.cache.yaml
 */

import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as path from 'path'
import git from 'isomorphic-git'
import * as yaml from 'js-yaml'

import type { SyncService } from './sync.service'
import type { PolentaRepoService } from './polenta-repo.service'
import type {
  WorkspaceTree,
  WorkspaceTreeNode,
  DiamondConflict,
  MountOverride,
  PolentaWorkspaceConfig,
  ImplementsDeclaration,
  ProjectSchema,
} from '@polenta/types'
import type { PolentaRepoDependency } from '@polenta/types'
import { findSystemNode } from '@polenta/types'
import { parseTreeCache, serializeTreeCache } from './tree-cache.util'

// ── Internal types ────────────────────────────────────────────────────────────

/** A flat dependency record collected during pass-1. */
interface FlatDep {
  /** Mount name (directory name). */
  name: string
  url: string
  pin: string
  /** The parent repo name that declared this dependency. */
  requiredBy: string
  /** Absolute path to the parent repo. */
  parentPath: string
}

/** Intermediate graph node built during pass-1. */
interface GraphNode {
  name: string
  url: string
  pin: string
  repoPath: string
  children: string[]  // mount names
  /** T123 (follow-up) — name of a local SystemNode of the declaring parent this node nests
   *  under. Set from whichever dependency declaration first discovers this mount name in the
   *  DFS — same "first declaration wins" simplification already applied to `pin`/`url` when a
   *  mount name is later re-encountered as a shared (diamond) dependency. */
  localParent?: string
}

export interface WorkspaceTreeResult {
  status: 'ok'
  tree: WorkspaceTree
}

export interface WorkspaceTreeConflictResult {
  status: 'diamond-conflict'
  conflicts: DiamondConflict[]
}

export interface WorkspaceTreeParseErrorResult {
  status: 'parse-error'
  repoName: string
  error: string
  /** GH30 — see `WorkspaceOpenResult`: the remote refused the clone/fetch (HTTP 401/403/404). */
  remoteAccess?: boolean
}

export interface WorkspaceTreeCycleResult {
  status: 'cycle'
  cycle: string[]
}

export type WorkspaceTreeBuildResult =
  | WorkspaceTreeResult
  | WorkspaceTreeConflictResult
  | WorkspaceTreeParseErrorResult
  | WorkspaceTreeCycleResult

/** GH30 — HTTP status of an isomorphic-git `HttpError`, or null for any other error. */
function httpErrorStatus(err: unknown): number | null {
  // Duck-typed on `code` rather than `instanceof`, robust to a duplicated isomorphic-git copy.
  const e = err as { code?: unknown; data?: { statusCode?: unknown } } | null
  return e?.code === 'HttpError' && typeof e.data?.statusCode === 'number' ? e.data.statusCode : null
}

// ── Service ───────────────────────────────────────────────────────────────────

export class WorkspaceTreeService {
  constructor(
    private readonly syncService: SyncService,
    private readonly polentaRepoService: PolentaRepoService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Build (or rebuild) the workspace tree.
   *
   * Two-pass algorithm:
   *   Pass 1 — Collect all deps recursively. Stop on cycle or parse error.
   *   Pass 2 — Detect diamond conflicts. If none → clone missing repos.
   *
   * Returns a discriminated union so callers can react appropriately.
   */
  async buildTree(
    workspaceDir: string,
    rootRepoPath: string,
    mountOverrides: MountOverride[],
  ): Promise<WorkspaceTreeBuildResult> {
    // Map: mountName → GraphNode
    const graph = new Map<string, GraphNode>()
    // Visited set (URL) for cycle detection
    const visiting = new Set<string>()

    // Seed the graph with the root repo.
    const rootName = path.basename(rootRepoPath)
    const rootUrl = await this.getRepoRemoteUrl(rootRepoPath)
    graph.set(rootName, {
      name: rootName,
      url: rootUrl,
      pin: '',
      repoPath: rootRepoPath,
      children: [],
    })

    // ── Pass 1: DFS collection ────────────────────────────────────────────────
    const pass1Result = await this.dfsCollect(
      rootName,
      rootRepoPath,
      rootUrl,
      graph,
      visiting,
      workspaceDir,
      mountOverrides,
      [],
    )

    if (pass1Result !== null) {
      return pass1Result
    }

    // ── Pass 2: Diamond detection ─────────────────────────────────────────────
    const conflicts = this.detectDiamondConflicts(graph)
    if (conflicts.length > 0) {
      return { status: 'diamond-conflict', conflicts }
    }

    // ── Clone missing repos ───────────────────────────────────────────────────
    for (const [name, node] of graph) {
      if (name === rootName) continue
      if (!node.url) continue
      const exists = await this.repoExistsAtPin(node.repoPath, node.pin)
      if (!exists) {
        // A repo can fail repoExistsAtPin for two very different reasons: the directory
        // doesn't exist yet (brand-new dependency — safe to clone), or it already holds a
        // valid clone whose current pin just isn't the requested one (e.g. the pin was just
        // edited to a branch/tag that hasn't been fetched locally yet). Cloning in the second
        // case would destroy the existing repo: isomorphic-git's clone() re-initializes .git
        // as an early step, before the network fetch that might then fail on a bad ref name —
        // so a typo'd branch could wipe an otherwise-fine local checkout (T74 finding).
        const alreadyCloned = await this.hasGitDir(node.repoPath)
        try {
          if (alreadyCloned) {
            await this.syncService.fetch(node.repoPath, node.url)
          } else {
            await fsP.mkdir(node.repoPath, { recursive: true })
            await this.syncService.clone(node.url, node.repoPath)
          }
          if (node.pin) {
            const isSha = /^[0-9a-f]{7,40}$/i.test(node.pin)
            try {
              await git.checkout({ fs, dir: node.repoPath, ref: node.pin })
            } catch {
              if (isSha) {
                // Best-effort for a SHA pin — repo still usable at its default branch.
                console.warn(`[WorkspaceTreeService] Could not checkout pin ${node.pin} for ${name}`)
              } else {
                // A branch/tag pin that doesn't exist on the remote is a real error (T70 UC-2).
                return {
                  status: 'parse-error',
                  repoName: name,
                  error: `La branche/tag "${node.pin}" est introuvable sur ${node.url}`,
                }
              }
            }
          }
        } catch (err) {
          console.error(`[WorkspaceTreeService] ${alreadyCloned ? 'Fetch' : 'Clone'} failed for ${name}:`, err)
          // GH30: GitHub answers 404 (not 401/403) for a private repo when the request carries no
          // valid credentials or the account has no access — the raw "HTTP Error: 404 Not Found"
          // reads as a broken URL/parse failure, so translate it into an actionable message.
          const statusCode = httpErrorStatus(err)
          if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
            const hasCredentials = await this.syncService.hasHttpsCredentials(node.url)
            return {
              status: 'parse-error',
              repoName: name,
              remoteAccess: true,
              error: hasCredentials
                ? `Dépôt introuvable ou accès refusé pour "${name}" (${node.url}, HTTP ${statusCode}) : vérifiez que votre compte a accès à ce dépôt et que votre token a la bonne portée (scope « repo », ou dépôt inclus dans un token fine-grained).`
                : `Dépôt introuvable ou accès refusé pour "${name}" (${node.url}, HTTP ${statusCode}) : aucun compte n'est configuré pour cet hôte dans Polenta — ajoutez un compte ayant accès à ce dépôt.`,
            }
          }
          // Non-fatal: report as a parse-error so the rest is usable
          return {
            status: 'parse-error',
            repoName: name,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      }
    }

    // ── Build WorkspaceTree ───────────────────────────────────────────────────
    const rootRepoHeadSha = await this.getHeadSha(rootRepoPath)
    const tree = await this.buildWorkspaceTree(rootName, graph, rootRepoHeadSha)

    return { status: 'ok', tree }
  }

  /**
   * Read the cached tree from <workspaceDir>/.polenta/tree.cache.yaml.
   * Returns null if absent, unreadable, or pointing outside `workspaceDir` (GH31 — copied or
   * moved workspace: callers then rebuild, or fall back to mono-repo).
   */
  async readCache(workspaceDir: string): Promise<WorkspaceTree | null> {
    const cachePath = path.join(workspaceDir, '.polenta', 'tree.cache.yaml')
    try {
      const raw = await fsP.readFile(cachePath, 'utf-8')
      return parseTreeCache(workspaceDir, raw)
    } catch {
      return null
    }
  }

  /**
   * Write the workspace tree to <workspaceDir>/.polenta/tree.cache.yaml.
   */
  async writeCache(workspaceDir: string, tree: WorkspaceTree): Promise<void> {
    const polentaDir = path.join(workspaceDir, '.polenta')
    await fsP.mkdir(polentaDir, { recursive: true })
    await this.ensureCacheIgnored(workspaceDir)
    const cachePath = path.join(polentaDir, 'tree.cache.yaml')
    await fsP.writeFile(cachePath, serializeTreeCache(workspaceDir, tree), 'utf-8')
  }

  /**
   * T156: this cache must never be versioned (T69-design.md — it stores machine-local absolute
   * paths and is fully regenerable, so a stale/foreign copy committed by someone else is worse
   * than useless). `createNewProject`/`openProject` (`workspace.service.ts`) only write a
   * `.gitignore` for the *self-contained* case where `workspaceDir` happens to equal the git
   * repo root — a multi-repo flat workspace's `workspaceDir` is a plain container directory one
   * level above the root repo, which those writes never touch, and `openProject`'s adopt-existing-
   * repo path wrote no `.gitignore` at all. Rather than chase every caller, this runs once here,
   * right at the only place the cache is ever written: a `.gitignore` placed directly next to the
   * `.polenta/` folder it excludes is honored by git regardless of which ancestor directory (if
   * any) turns out to be the actual repo root — and a no-op (inert stray file) if `workspaceDir`
   * isn't under git at all, which is the common case for a freshly chosen container folder.
   */
  private async ensureCacheIgnored(workspaceDir: string): Promise<void> {
    const gitignorePath = path.join(workspaceDir, '.gitignore')
    const line = '.polenta/tree.cache.yaml'
    const existing = await fsP.readFile(gitignorePath, 'utf-8').catch(() => '')
    if (existing.split(/\r?\n/).includes(line)) return
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
    await fsP.appendFile(gitignorePath, `${prefix}${line}\n`)
  }

  /**
   * Physically deletes a cloned dependency's directory (T74). Callers must remove the
   * dependency's reference from polenta-repo.yaml (and rebuild the tree) first — this
   * method never touches the manifest, so it must never run before that succeeds.
   */
  async removeClonedRepo(repoPath: string): Promise<void> {
    await fsP.rm(repoPath, { recursive: true, force: true })
  }

  /**
   * Physically renames a dependency's mount directory (T74 sprint 2). Callers are responsible
   * for updating polenta-repo.yaml and every implements[].interface reference to the new name
   * — this method only moves the directory, and does so first (the directory rename is atomic
   * at the OS level, so it either fully succeeds or leaves nothing inconsistent; it must run
   * before any manifest write so a failure here never leaves polenta-repo.yaml pointing at a
   * name whose directory was never actually renamed).
   */
  async renameClonedRepo(workspaceDir: string, oldMountName: string, newMountName: string): Promise<void> {
    const oldPath = path.join(workspaceDir, oldMountName)
    const newPath = path.join(workspaceDir, newMountName)
    await fsP.rename(oldPath, newPath)
  }

  /**
   * Returns true if the cache is still valid (root repo HEAD SHA matches).
   */
  async isCacheValid(workspaceDir: string, rootRepoPath: string): Promise<boolean> {
    const cached = await this.readCache(workspaceDir)
    if (!cached || !cached.rootRepoHeadSha) return false
    const currentSha = await this.getHeadSha(rootRepoPath)
    return currentSha !== '' && currentSha === cached.rootRepoHeadSha
  }

  /**
   * Update the mount-overrides in <workspaceDir>/.polenta/workspace.yaml
   * and add the given override. Writes the file atomically.
   */
  async setMountOverride(workspaceDir: string, override: MountOverride): Promise<void> {
    const markerPath = path.join(workspaceDir, '.polenta', 'workspace.yaml')
    let config: PolentaWorkspaceConfig = {}
    try {
      const raw = await fsP.readFile(markerPath, 'utf-8')
      config = (yaml.load(raw) as PolentaWorkspaceConfig) ?? {}
    } catch {
      // File might not exist yet
    }

    const existing = config.mountOverrides ?? []
    // Replace if url+pin already present; otherwise append
    const idx = existing.findIndex(o => o.url === override.url && o.pin === override.pin)
    if (idx >= 0) {
      existing[idx] = override
    } else {
      existing.push(override)
    }
    config.mountOverrides = existing

    await fsP.mkdir(path.dirname(markerPath), { recursive: true })
    await fsP.writeFile(markerPath, yaml.dump(config, { lineWidth: 120 }), 'utf-8')
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * DFS collection of all dependencies.
   * Mutates `graph` in place.
   * Returns a non-null result on error (cycle or parse-error), null on success.
   */
  private async dfsCollect(
    name: string,
    repoPath: string,
    repoUrl: string,
    graph: Map<string, GraphNode>,
    visiting: Set<string>,
    workspaceDir: string,
    mountOverrides: MountOverride[],
    ancestorChain: string[],
  ): Promise<WorkspaceTreeParseErrorResult | WorkspaceTreeCycleResult | null> {
    // Cycle detection: use URL (not name, since overrides can rename)
    const urlKey = repoUrl || name
    if (visiting.has(urlKey)) {
      const cycle = [...ancestorChain, name]
      return { status: 'cycle', cycle }
    }

    visiting.add(urlKey)

    let manifest = null
    try {
      manifest = await this.polentaRepoService.readManifest(repoPath)
    } catch (err) {
      // YAML parse error
      visiting.delete(urlKey)
      return {
        status: 'parse-error',
        repoName: name,
        error: err instanceof Error ? err.message : String(err),
      }
    }

    const deps: PolentaRepoDependency[] = manifest?.dependencies ?? []

    for (const dep of deps) {
      // Check if user has configured a mount-override for this (url, pin)
      const override = mountOverrides.find(o => o.url === dep.url && o.pin === dep.pin)
      const mountName = override ? override.mountAs : dep.name
      const depRepoPath = path.join(workspaceDir, mountName)

      // Update parent's children list
      const parentNode = graph.get(name)
      if (parentNode && !parentNode.children.includes(mountName)) {
        parentNode.children.push(mountName)
      }

      if (!graph.has(mountName)) {
        // New node
        graph.set(mountName, {
          name: mountName,
          url: dep.url,
          pin: dep.pin,
          repoPath: depRepoPath,
          children: [],
          localParent: dep.localParent,
        })
      } else {
        // Already in graph — could be shared (same url+pin) or conflict
        // Conflict detection is done in pass-2; nothing to do here
      }

      // Recurse into dependency (only if repo exists on disk; otherwise skip recursion)
      const depExists = await fsP.stat(depRepoPath).then(() => true).catch(() => false)
      if (depExists) {
        const result = await this.dfsCollect(
          mountName,
          depRepoPath,
          dep.url,
          graph,
          visiting,
          workspaceDir,
          mountOverrides,
          [...ancestorChain, name],
        )
        if (result !== null) {
          visiting.delete(urlKey)
          return result
        }
      }
    }

    visiting.delete(urlKey)
    return null
  }

  /**
   * Pass-2: detect diamond conflicts.
   * A conflict is: same url, different pins, for nodes that have no mount-override
   * (i.e., they share the same `name` in the graph but different pins, which is
   * impossible since the graph key is the mount name).
   *
   * More precisely: check if two different graph nodes share the same URL but different pins.
   */
  private detectDiamondConflicts(graph: Map<string, GraphNode>): DiamondConflict[] {
    // Group by url
    const byUrl = new Map<string, Array<{ name: string; pin: string; requiredBy: string[] }>>()

    for (const [, node] of graph) {
      if (!node.url) continue
      if (!byUrl.has(node.url)) {
        byUrl.set(node.url, [])
      }
      byUrl.get(node.url)!.push({ name: node.name, pin: node.pin, requiredBy: [] })
    }

    // Find parents for each node
    for (const [parentName, parentNode] of graph) {
      for (const childName of parentNode.children) {
        const childNode = graph.get(childName)
        if (!childNode) continue
        const entries = byUrl.get(childNode.url)
        if (!entries) continue
        const entry = entries.find(e => e.name === childName)
        if (entry && !entry.requiredBy.includes(parentName)) {
          entry.requiredBy.push(parentName)
        }
      }
    }

    const conflicts: DiamondConflict[] = []

    for (const [url, entries] of byUrl) {
      // Group entries by pin
      const pinGroups = new Map<string, string[]>()
      for (const entry of entries) {
        if (!pinGroups.has(entry.pin)) {
          pinGroups.set(entry.pin, [])
        }
        const requiredBy = entry.requiredBy.length > 0 ? entry.requiredBy : [entry.name]
        for (const r of requiredBy) {
          if (!pinGroups.get(entry.pin)!.includes(r)) {
            pinGroups.get(entry.pin)!.push(r)
          }
        }
      }

      if (pinGroups.size > 1) {
        // Multiple pins for the same URL → conflict
        conflicts.push({
          url,
          pins: Array.from(pinGroups.entries()).map(([pin, requiredBy]) => ({
            pin,
            requiredBy,
          })),
        })
      }
    }

    return conflicts
  }

  /**
   * Read and return the schema.yaml from a repo, or null if absent/invalid.
   * Used to determine isInterface and implements for workspace tree nodes.
   */
  private async readSchema(repoPath: string): Promise<ProjectSchema | null> {
    try {
      const schemaPath = path.join(repoPath, '.polenta', 'schema.yaml')
      const raw = await fsP.readFile(schemaPath, 'utf-8')
      return (yaml.load(raw) as ProjectSchema) ?? null
    } catch {
      return null
    }
  }

  /** Build a WorkspaceTree from the graph. */
  private async buildWorkspaceTree(
    rootName: string,
    graph: Map<string, GraphNode>,
    rootRepoHeadSha: string,
  ): Promise<WorkspaceTree> {
    // Read all schemas upfront to populate isInterface / implements
    const schemaCache = new Map<string, ProjectSchema | null>()
    for (const [, node] of graph) {
      schemaCache.set(node.name, await this.readSchema(node.repoPath))
    }

    // T123 — roles/implements vivent désormais sur le SystemNode `root` du repo, pas seulement au
    // niveau racine du fichier schema.yaml (déprécié, cf. schema.ts). On lit les deux : le niveau
    // fichier reste renseigné pour un schema.yaml jamais retouché depuis ce ticket (migration
    // additive côté SchemaService, cf. specs/T123-sprint1.md), le node root pour tout schema.yaml
    // édité depuis ce ticket (l'édition écrit désormais sur le node, plus sur le fichier).
    const getRootNode = (name: string) => {
      const s = schemaCache.get(name)
      return s ? findSystemNode(s.nodes, 'root') : undefined
    }

    const getInterfaceFlag = (name: string): boolean => {
      const s = schemaCache.get(name)
      const roles = s?.roles ?? getRootNode(name)?.roles
      return Array.isArray(roles) && roles.length > 0
    }

    const getImplements = (name: string): ImplementsDeclaration[] | undefined => {
      const s = schemaCache.get(name)
      const impl = s?.implements ?? getRootNode(name)?.implements
      if (!impl || impl.length === 0) return undefined
      return impl
    }

    const buildNode = (name: string, visited: Set<string>): WorkspaceTreeNode => {
      const node = graph.get(name)!
      const children: WorkspaceTreeNode[] = []
      for (const childName of node.children) {
        if (!visited.has(childName)) {
          visited.add(childName)
          children.push(buildNode(childName, visited))
        }
      }
      const impl = getImplements(name)
      const label = getRootNode(name)?.label
      const treeNode: WorkspaceTreeNode = {
        name: node.name,
        repoPath: node.repoPath,
        url: node.url,
        pin: node.pin,
        isInterface: getInterfaceFlag(name),
        children,
      }
      if (label) treeNode.label = label
      if (impl) treeNode.implements = impl
      if (node.localParent) treeNode.localParent = node.localParent
      return treeNode
    }

    const visited = new Set<string>([rootName])
    const logicalTree = buildNode(rootName, visited)

    // Flat list: all unique nodes
    const nodes: WorkspaceTreeNode[] = []
    for (const [, node] of graph) {
      const impl = getImplements(node.name)
      const label = getRootNode(node.name)?.label
      const flatNode: WorkspaceTreeNode = {
        name: node.name,
        repoPath: node.repoPath,
        url: node.url,
        pin: node.pin,
        isInterface: getInterfaceFlag(node.name),
        children: [],
      }
      if (label) flatNode.label = label
      if (impl) flatNode.implements = impl
      if (node.localParent) flatNode.localParent = node.localParent
      nodes.push(flatNode)
    }

    return {
      rootRepoHeadSha,
      generatedAt: new Date().toISOString(),
      nodes,
      logicalTree,
    }
  }

  /**
   * Returns true if the repo exists on disk and HEAD matches the expected pin.
   * Resolves `pin` locally (works uniformly for a SHA, a branch, or a tag) and
   * compares it to HEAD — never "trusts" a branch/tag pin without checking, so a
   * previously failed checkout (T70 UC-2) is never silently treated as settled.
   */
  private async repoExistsAtPin(repoPath: string, pin: string): Promise<boolean> {
    try {
      const stat = await fsP.stat(path.join(repoPath, '.git'))
      if (!stat.isDirectory() && !stat.isFile()) return false
      if (!pin) return true // no pin declared — whatever is checked out is acceptable

      const head = await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })

      if (/^[0-9a-f]{7,40}$/i.test(pin)) {
        return head.startsWith(pin) || pin.startsWith(head.substring(0, pin.length))
      }

      try {
        const pinnedSha = await git.resolveRef({ fs, dir: repoPath, ref: pin })
        return head === pinnedSha
      } catch {
        // Branch/tag pin not resolvable locally — needs a (re)checkout.
        return false
      }
    } catch {
      return false
    }
  }

  /**
   * True if `repoPath` already holds a git checkout (T74) — distinguishes "never cloned"
   * from "cloned, but the current pin doesn't match" for repoExistsAtPin() callers that must
   * not clone() over an existing repo (which would destroy it).
   */
  private async hasGitDir(repoPath: string): Promise<boolean> {
    try {
      const stat = await fsP.stat(path.join(repoPath, '.git'))
      return stat.isDirectory() || stat.isFile()
    } catch {
      return false
    }
  }

  /** Get the HEAD commit SHA of a repo. Returns '' on error. */
  private async getHeadSha(repoPath: string): Promise<string> {
    try {
      return await git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
    } catch {
      return ''
    }
  }

  /** Get the remote origin URL of a repo. Returns '' if not a git repo or no remote. */
  private async getRepoRemoteUrl(repoPath: string): Promise<string> {
    try {
      const remotes = await git.listRemotes({ fs, dir: repoPath })
      return remotes.find((r: { remote: string; url: string }) => r.remote === 'origin')?.url ?? ''
    } catch {
      return ''
    }
  }
}
