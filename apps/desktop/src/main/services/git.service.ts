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

  /**
   * Increment and persist a named counter in `config/counters.yaml`, returning
   * `{idPrefix}-{padded number}` (e.g. `QUERY-0001`) — shared by every T77 service
   * using this ID scheme (SavedQuery, Dashboard). `ReviewsService.nextReviewId` uses
   * the same mechanism but predates this sprint and isn't touched here.
   */
  async nextCounterId(repoPath: string, counterKey: string, idPrefix: string): Promise<string> {
    const countersPath = 'config/counters.yaml'
    let counters: Record<string, number | undefined> = {}
    try {
      const existing = await this.readYaml<Record<string, number | undefined>>(repoPath, countersPath)
      counters = existing ?? {}
    } catch {
      // file doesn't exist yet
    }
    const next = (counters[counterKey] ?? 0) + 1
    counters[counterKey] = next
    await this.writeYaml(repoPath, countersPath, counters)
    return `${idPrefix}-${String(next).padStart(4, '0')}`
  }

  // ─── Git objects reads (lecture historique uniquement) ─────────────────────

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

  // ─── Branch operations ──────────────────────────────────────────────────────

  async headSha(repoPath: string): Promise<string> {
    return git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' })
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
