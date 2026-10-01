import * as fsPromises from 'fs/promises'
import type { Dirent } from 'fs'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import git from 'isomorphic-git'

export interface GitAuthor {
  name: string
  email: string
}

export interface FileHistory {
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export class GitService {
  // ─── Working tree reads (fs) ────────────────────────────────────────────────

  async readYaml<T>(repoPath: string, filePath: string): Promise<T | null> {
    try {
      const raw = await fsPromises.readFile(path.join(repoPath, filePath), 'utf-8')
      return yaml.load(raw) as T
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return null
      throw err
    }
  }

  async writeYaml(repoPath: string, filePath: string, data: unknown): Promise<void> {
    const full = path.join(repoPath, filePath)
    await fsPromises.mkdir(path.dirname(full), { recursive: true })
    await fsPromises.writeFile(full, yaml.dump(data, { lineWidth: 120 }), 'utf-8')
  }

  /** Writes raw text (not YAML) — e.g. the empty tombstone files of GH20 (`id-counter.util.ts`). */
  async writeText(repoPath: string, filePath: string, content: string): Promise<void> {
    const full = path.join(repoPath, filePath)
    await fsPromises.mkdir(path.dirname(full), { recursive: true })
    await fsPromises.writeFile(full, content, 'utf-8')
  }

  async fileExists(repoPath: string, filePath: string): Promise<boolean> {
    try {
      await fsPromises.access(path.join(repoPath, filePath))
      return true
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return false
      throw err
    }
  }

  /** Configured integration branch for this repo (`config/project.yaml`), `'main'` if absent/unreadable. */
  async getIntegrationBranch(repoPath: string): Promise<string> {
    try {
      const config = await this.readYaml<{ integrationBranch?: string }>(repoPath, 'config/project.yaml')
      return config?.integrationBranch ?? 'main'
    } catch {
      return 'main'
    }
  }

  /** Persists the configured integration branch — merges into existing `config/project.yaml`, never overwrites other keys. */
  async setIntegrationBranch(repoPath: string, branch: string): Promise<void> {
    const existing = await this.readYaml<Record<string, unknown>>(repoPath, 'config/project.yaml')
    const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
    await this.writeYaml(repoPath, 'config/project.yaml', { ...base, integrationBranch: branch })
  }

  async listFiles(repoPath: string, prefix: string): Promise<string[]> {
    const baseDir = path.join(repoPath, prefix)
    const walk = async (dir: string, base: string): Promise<string[]> => {
      let entries: Dirent[]
      try {
        entries = await fsPromises.readdir(dir, { withFileTypes: true })
      } catch (err: unknown) {
        if (isNodeError(err) && err.code === 'ENOENT') return []
        throw err
      }
      const results: string[] = []
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const rel = base ? `${base}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          results.push(...(await walk(path.join(dir, entry.name), rel)))
        } else {
          results.push(rel)
        }
      }
      return results
    }

    const files = await walk(baseDir, '')
    return files.map(f => (prefix ? `${prefix}/${f}` : f))
  }

  async deleteFile(repoPath: string, filePath: string): Promise<void> {
    await fsPromises.unlink(path.join(repoPath, filePath))
  }

  /**
   * Read every `.yaml` file directly under `dir` and parse it as `T`, in parallel —
   * shared by any service storing "one shared object = one YAML file in a folder"
   * (T77: `queries/`, `dashboards/`). Extracted because `saved-queries.service.ts`
   * and `dashboards.service.ts` both had their own copy of this exact
   * list+filter+Promise.all+filter-null sequence.
   */
  async readYamlDir<T>(repoPath: string, dir: string): Promise<T[]> {
    const files = await this.listFiles(repoPath, dir)
    const yamlFiles = files.filter((f) => f.endsWith('.yaml'))
    const items: (T | null)[] = await Promise.all(yamlFiles.map((file) => this.readYaml<T>(repoPath, file)))
    return items.filter((it): it is T => it !== null)
  }

  // ─── Git objects reads (lecture historique uniquement) ─────────────────────

  /**
   * T171 — lit un fichier YAML tel qu'il existe au tag `tag`. Distingue « tag introuvable »
   * (`tagFound: false`, la campagne ne se replie pas sur l'état courant) de « fichier absent au
   * tag » (`tagFound: true, data: null`). Un tag annoté est déréférencé vers son commit.
   */
  async readYamlAtTag<T>(repoPath: string, tag: string, filePath: string): Promise<{ tagFound: boolean; data: T | null }> {
    const oid = await this.resolveTagOid(repoPath, tag)
    if (!oid) return { tagFound: false, data: null }
    return { tagFound: true, data: await this.readYamlRef<T>(repoPath, oid, filePath) }
  }

  /** Commit pointé par le tag `tag` (tag annoté déréférencé), `null` si le tag est introuvable. */
  async resolveTagOid(repoPath: string, tag: string): Promise<string | null> {
    try {
      let oid = await git.resolveRef({ fs, dir: repoPath, ref: `refs/tags/${tag}` })
      const { type } = await git.readObject({ fs, dir: repoPath, oid, format: 'parsed' })
      if (type === 'tag') oid = (await git.readTag({ fs, dir: repoPath, oid })).tag.object
      return oid
    } catch {
      return null
    }
  }

  async readYamlRef<T>(repoPath: string, ref: string, filePath: string): Promise<T | null> {
    try {
      const { blob } = await git.readBlob({ fs, dir: repoPath, oid: ref, filepath: filePath })
      return yaml.load(Buffer.from(blob).toString('utf-8')) as T
    } catch {
      return null
    }
  }

  /**
   * Lists every file path under `prefix` as it exists in the tree at `ref` — the git-object
   * equivalent of `listFiles`, for reading a snapshot at an arbitrary (possibly historical)
   * commit/tag instead of the working tree. Used by T46's impact analysis to read
   * requirements/tests/links as they existed at a baseline, not the live working tree.
   */
  async listFilesAtRef(repoPath: string, ref: string, prefix: string): Promise<string[]> {
    const results: string[] = []
    await git.walk({
      fs,
      dir: repoPath,
      trees: [git.TREE({ ref })],
      map: async (filepath, [entry]) => {
        if (filepath === '.' || !filepath.startsWith(prefix)) return
        if (!entry) return
        if ((await entry.type()) === 'tree') return
        results.push(filepath)
      },
    })
    return results
  }

  /** Ref-aware equivalent of `readYamlDir` — reads every `.yaml` file under `dir` as it existed
   * at `ref`, in parallel. Used by T46 to build a read-only snapshot at a baseline. */
  async readYamlDirAtRef<T>(repoPath: string, ref: string, dir: string): Promise<T[]> {
    const files = await this.listFilesAtRef(repoPath, ref, dir)
    const yamlFiles = files.filter((f) => f.endsWith('.yaml'))
    const items: (T | null)[] = await Promise.all(yamlFiles.map((file) => this.readYamlRef<T>(repoPath, ref, file)))
    return items.filter((it): it is T => it !== null)
  }

  // ─── File history (git log) ─────────────────────────────────────────────────

  /**
   * Créé/modifié le/par pour un fichier, dérivés de son historique git plutôt que
   * stockés dans le fichier lui-même (T112) — commit le plus ancien touchant ce chemin
   * = création, le plus récent = dernière modification. `null` si le fichier n'a jamais
   * été commité (ex. juste créé, en attente de premier commit) : `force: true` évite que
   * `git.log` lève dans ce cas plutôt que de renvoyer un tableau vide.
   */
  async fileHistory(repoPath: string, filePath: string): Promise<FileHistory | null> {
    const commits = await git.log({ fs, dir: repoPath, filepath: filePath, ref: 'HEAD', force: true }).catch(() => [])
    if (commits.length === 0) return null
    const newest = commits[0]
    const oldest = commits[commits.length - 1]
    return {
      updatedAt: new Date(newest.commit.author.timestamp * 1000).toISOString(),
      updatedBy: newest.commit.author.name,
      createdAt: new Date(oldest.commit.author.timestamp * 1000).toISOString(),
      createdBy: oldest.commit.author.name,
    }
  }

  /**
   * Batched equivalent of `fileHistory()` for every file under `prefix` (T142) — one single
   * walk of the commit history instead of one `git.log({ filepath })` per file. isomorphic-git's
   * per-file `git.log` re-walks the ENTIRE reachable commit DAG for every call (see its `_log`
   * implementation: a topological traversal that resolves the file's blob oid at each commit),
   * so calling it once per requirement/test file costs O(files × commits) — the more specs and
   * the longer the project's history, the slower every index build (RequirementsIndexService /
   * TestsIndexService), i.e. the app's perceived startup time (T141 fixed a separate, unrelated
   * boot-time cost — this one scales with repo content, not with it).
   *
   * Walks the commit list once (`git.log` without `filepath`) and, for each commit, diffs its
   * `prefix` subtree against the same subtree in its *first* parent (or against nothing, for the
   * root commit) — `readSubtreeOid` + `diffSubtrees` below, both scoped to `prefix` from the
   * start (never touch any other part of the tree) and pruned wherever a subtree's oid is
   * unchanged, so the cost of a commit that didn't touch `prefix` at all is one `readTree` call,
   * not a full walk. Measured on this repo's own `specs/` (280 files, 536 commits): ~12s batched
   * vs. ~300s for the per-file loop it replaces (apps/desktop/src/main/services/*-index.service.ts).
   *
   * `createdAt` is the oldest commit touching a path, `updatedAt` the newest — same fields as
   * `fileHistory()`, but **not always the same values**: cross-checked against this repo's own
   * `specs/` history (which has real merges — see WORKFLOW.md's per-ticket branch/worktree
   * model), `fileHistory()`'s per-file DAG traversal turned out to report false-positive
   * `updatedAt`s on merge commits — timestamps matching no commit that `git log -- <path>`
   * actually shows as having touched the file (e.g. `specs/T98.md`, `specs/T110.md`: verified
   * against plain `git log -- <path>`). The first-parent diff here doesn't have that failure
   * mode and agrees with `git log --full-history -- <path>` on every spot-checked case — so this
   * is a correctness fix for those files, not just a speedup, even though the two can disagree.
   */
  // T179 — `ref` : historique jusqu'à un commit donné (tag de baseline) plutôt que HEAD.
  async fileHistoryMap(repoPath: string, prefix: string, ref = 'HEAD'): Promise<Map<string, FileHistory>> {
    const result = new Map<string, FileHistory>()
    const commits = await git.log({ fs, dir: repoPath, ref, force: true }).catch(() => [])

    for (const commit of commits) {
      const parentOid = commit.commit.parent[0]
      const [oidA, oidB] = await Promise.all([
        this.readSubtreeOid(repoPath, commit.oid, prefix),
        parentOid ? this.readSubtreeOid(repoPath, parentOid, prefix) : Promise.resolve(null),
      ])
      if (oidA === oidB) continue

      const changed: string[] = []
      await this.diffSubtrees(repoPath, prefix, oidA, oidB, changed)
      if (changed.length === 0) continue

      const when = new Date(commit.commit.author.timestamp * 1000).toISOString()
      const who = commit.commit.author.name
      for (const filepath of changed) {
        const existing = result.get(filepath)
        if (!existing) {
          result.set(filepath, { updatedAt: when, updatedBy: who, createdAt: when, createdBy: who })
        } else {
          // `commits` is newest-first, so the last write to a given path (as we keep walking
          // toward the root) is always its oldest — overwritten unconditionally on every hit.
          existing.createdAt = when
          existing.createdBy = who
        }
      }
    }

    return result
  }

  /** oid of the tree at `path` inside `commitOid`, or `null` if `path` doesn't exist there. */
  private async readSubtreeOid(repoPath: string, commitOid: string, path: string): Promise<string | null> {
    try {
      const { oid } = await git.readTree({ fs, dir: repoPath, oid: commitOid, filepath: path })
      return oid
    } catch {
      return null
    }
  }

  /**
   * Recursively collects every file path under `pathPrefix` whose blob oid differs between tree
   * `oidA` and tree `oidB` (either may be `null` — path added/removed entirely). Short-circuits
   * on every subtree whose oid already matches on both sides — the same pruning that makes plain
   * `git diff` cheap even on large trees, applied manually since isomorphic-git's `walk()` has no
   * built-in path scoping (it always visits the whole tree, oid-matching or not — confirmed via
   * a throwaway benchmark against `git.walk` while designing this: sped this up a further ~2×
   * over walking the whole repo tree once per commit and filtering by prefix afterward).
   */
  private async diffSubtrees(
    repoPath: string,
    pathPrefix: string,
    oidA: string | null,
    oidB: string | null,
    changed: string[],
  ): Promise<void> {
    if (oidA === oidB) return

    const [treeA, treeB] = await Promise.all([
      oidA ? git.readTree({ fs, dir: repoPath, oid: oidA }) : null,
      oidB ? git.readTree({ fs, dir: repoPath, oid: oidB }) : null,
    ])
    const entriesA = new Map((treeA?.tree ?? []).map((e) => [e.path, e]))
    const entriesB = new Map((treeB?.tree ?? []).map((e) => [e.path, e]))

    for (const name of new Set([...entriesA.keys(), ...entriesB.keys()])) {
      const a = entriesA.get(name)
      const b = entriesB.get(name)
      if (a?.oid === b?.oid) continue
      const childPath = `${pathPrefix}/${name}`
      if (a?.type === 'tree' || b?.type === 'tree') {
        await this.diffSubtrees(
          repoPath,
          childPath,
          a?.type === 'tree' ? a.oid : null,
          b?.type === 'tree' ? b.oid : null,
          changed,
        )
      } else {
        changed.push(childPath)
      }
    }
  }

  // ─── Branch operations ──────────────────────────────────────────────────────

  async headSha(repoPath: string): Promise<string> {
    return git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
  }

  /** GH34 — tags (triés) pointant sur le commit HEAD, annotés déréférencés ; `[]` si aucun. */
  async tagsAtHead(repoPath: string): Promise<string[]> {
    const head = await this.headSha(repoPath)
    const tags = await git.listTags({ fs, dir: repoPath })
    const matching: string[] = []
    for (const tag of tags) {
      if ((await this.resolveTagOid(repoPath, tag)) === head) matching.push(tag)
    }
    return matching.sort()
  }

  async currentBranch(repoPath: string): Promise<string> {
    const branch = await git.currentBranch({ fs, dir: repoPath, fullname: false })
    return branch ?? 'HEAD'
  }

  async listBranches(repoPath: string): Promise<string[]> {
    return git.listBranches({ fs, dir: repoPath })
  }

  async createBranch(repoPath: string, branchName: string): Promise<void> {
    await git.branch({ fs, dir: repoPath, ref: branchName })
  }

  async checkout(repoPath: string, branchName: string, create?: boolean): Promise<void> {
    if (create) {
      await git.branch({ fs, dir: repoPath, ref: branchName, checkout: true })
    } else {
      await git.checkout({ fs, dir: repoPath, ref: branchName })
    }
  }

  async deleteBranch(repoPath: string, name: string): Promise<void> {
    await git.deleteBranch({ fs, dir: repoPath, ref: name })
  }

  async mergeBase(repoPath: string, a: string, b: string): Promise<string> {
    const shaA = await git.resolveRef({ fs, dir: repoPath, ref: a })
    const shaB = await git.resolveRef({ fs, dir: repoPath, ref: b })

    // Walk the commit graph to find common ancestor
    const ancestorsA = new Set<string>()
    const queue: string[] = [shaA]

    while (queue.length > 0) {
      const sha = queue.shift()!
      if (ancestorsA.has(sha)) continue
      ancestorsA.add(sha)
      const commit = await git.readCommit({ fs, dir: repoPath, oid: sha })
      for (const parent of commit.commit.parent) {
        queue.push(parent)
      }
    }

    // BFS from B to find first ancestor also in A
    const queueB: string[] = [shaB]
    const visitedB = new Set<string>()
    while (queueB.length > 0) {
      const sha = queueB.shift()!
      if (visitedB.has(sha)) continue
      visitedB.add(sha)
      if (ancestorsA.has(sha)) return sha
      const commit = await git.readCommit({ fs, dir: repoPath, oid: sha })
      for (const parent of commit.commit.parent) {
        queueB.push(parent)
      }
    }

    throw new Error(`No common ancestor found between ${a} and ${b}`)
  }
}

interface NodeError extends Error {
  code?: string
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error && 'code' in err
}
