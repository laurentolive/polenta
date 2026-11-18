import * as fsPromises from 'fs/promises'
import type { Dirent } from 'fs'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import git from 'isomorphic-git'
import { historyTimestamp } from '@polenta/types'
import { gitFor } from '../git/git-backend'
import { safeCheckout } from './safe-checkout.util'

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
      // `^{}` : un tag annoté est pelé jusqu'à l'objet visé (le commit).
      return await gitFor(repoPath).resolve(`refs/tags/${tag}^{}`)
    } catch {
      return null
    }
  }

  async readYamlRef<T>(repoPath: string, ref: string, filePath: string): Promise<T | null> {
    try {
      const text = await gitFor(repoPath).readText(ref, filePath)
      return text === null ? null : yaml.load(text) as T
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
    const g = gitFor(repoPath)
    const oid = await g.resolveOrThrow(ref) // ref absente : erreur, pas une liste vide
    const entries = await g.lsTree(oid, prefix ? { prefix } : {})
    return entries.filter(e => e.type !== 'tree' && e.path.startsWith(prefix)).map(e => e.path)
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
   * Créé/modifié le/par d'un fichier d'après son historique git (repli des campagnes ; les
   * exigences, tests et issues portent leurs dates dans le YAML, GH340) — commit le plus ancien touchant ce chemin
   * = création, le plus récent = dernière modification. `null` si le fichier n'a jamais
   * été commité (ex. juste créé, en attente de premier commit) ou si le dépôt n'a pas de commit.
   * Un seul `git log -- <fichier>` (plus récent d'abord), date d'auteur.
   */
  async fileHistory(repoPath: string, filePath: string): Promise<FileHistory | null> {
    // Chemin littéral : `GIT_LITERAL_PATHSPECS=1` dans l'environnement de Polenta (git-config.ts).
    const commits = await gitFor(repoPath).log('HEAD', { paths: [filePath] }).catch(() => [])
    if (commits.length === 0) return null
    const newest = commits[0]
    const oldest = commits[commits.length - 1]
    return {
      updatedAt: new Date(newest.author.timestamp * 1000).toISOString(),
      updatedBy: newest.author.name,
      createdAt: new Date(oldest.author.timestamp * 1000).toISOString(),
      createdBy: oldest.author.name,
    }
  }

  /**
   * GH77 — commits de la **chaîne des premiers parents** de `ref` qui modifient un fichier sous l'un
   * des `prefixes`, du plus ancien au plus récent, avec les fichiers modifiés (comparaison au premier
   * parent, élagage des sous-arbres identiques). Les commits d'une branche
   * fusionnée ne sont pas parcourus : leurs changements apparaissent au commit de fusion — l'histoire
   * de la branche d'intégration. Date = date de commit (monotone le long de la chaîne, contrairement
   * à la date d'auteur après un rebase). Base de la reprise de l'historique des champs.
   */
  async commitChanges(
    repoPath: string, prefixes: string[], ref = 'HEAD',
  ): Promise<Array<{ oid: string; at: string; by: string; files: string[] }>> {
    // Un seul `git log --first-parent --name-status` (repo sans commit ou ref absente : []).
    const commits = await gitFor(repoPath).pathCommits(ref, prefixes, { firstParent: true })
    return commits.reverse().map(c => ({
      oid: c.oid,
      at: new Date(c.committer.timestamp * 1000).toISOString(),
      by: c.author.name,
      files: c.changes!.map(ch => ch.path),
    }))
  }

  /**
   * GH340 — dates de création / modification des fichiers sous `prefixes`, pour la reprise (mise en
   * conformité). Un parcours unique de **tous** les commits atteignables depuis `ref` (pas seulement
   * les premiers parents) :
   * - commit à un parent : fichiers différents du parent ; commit racine : tous ses fichiers. Les
   *   commits de fusion sont écartés, pour que l'auteur soit celui qui a fait la modification et non
   *   celui qui a fusionné ;
   * - un fichier que seuls des commits de fusion ont touché (résolution de conflit, « Garder les
   *   deux » de GH37) prend ses dates de ces commits (comparés au premier parent) ;
   * - création = plus ancien commit qui touche le fichier, modification = plus récent, par **date de
   *   commit** (comme GH77 : un rebase ou un cherry-pick garde la date d'auteur d'origine) ; auteur =
   *   l'auteur du commit. À égalité de date, le commit le plus loin de `ref` crée, le plus proche modifie ;
   * - dépôt superficiel (shallow) : un parent absent arrête cette branche du parcours, sans erreur.
   * Les déplacements et renommages ne sont pas suivis (création = le commit qui crée le chemin).
   * Un seul `git log --name-status` (`GitBackend.fileHistories`, #337) ; repo sans commit : vide.
   */
  async auditDatesFromHistory(repoPath: string, prefixes: string[], ref = 'HEAD'): Promise<Map<string, FileHistory>> {
    const dates = await gitFor(repoPath).fileHistories(ref, prefixes)
    const at = (s: number) => historyTimestamp(new Date(s * 1000))
    return new Map([...dates].map(([file, d]) => [file, {
      createdAt: at(d.created), createdBy: d.createdBy, updatedAt: at(d.updated), updatedBy: d.updatedBy,
    }]))
  }

  /**
   * GH77 — contenu texte d'un fichier dans un commit ; `null` si le fichier n'y existe pas. Toute
   * autre erreur (objet manquant, pack corrompu) est levée : elle ne doit pas passer pour une
   * suppression.
   */
  /** Le commit est-il présent dans le repo ? Un objet présent qui n'est pas un commit lève. */
  async hasCommit(repoPath: string, commitOid: string): Promise<boolean> {
    const info = await gitFor(repoPath).objectInfo(commitOid)
    if (!info) return false
    if (info.type !== 'commit') throw new Error(`${commitOid} n'est pas un commit (${info.type})`)
    return true
  }

  async readTextAt(repoPath: string, commitOid: string, filePath: string): Promise<string | null> {
    return gitFor(repoPath).readText(commitOid, filePath)
  }

  /**
   * GH200 — commits de la chaîne des premiers parents de `ref` qui modifient `filePath` (oid du blob
   * différent de celui du premier parent), du plus récent au plus ancien. `stopAt` : le parcours
   * s'arrête à ce commit (exclu). Même lecture que `commitChanges` (histoire de la branche
   * d'intégration), limitée à un fichier.
   */
  async fileCommits(
    repoPath: string, filePath: string, opts: { ref?: string; stopAt?: string | null } = {},
  ): Promise<Array<{ oid: string; at: string; by: string }>> {
    // Un seul `git log --first-parent -- <fichier>` (repo sans commit ou ref absente : []).
    const commits = await gitFor(repoPath).pathCommits(opts.ref ?? 'HEAD', [filePath], {
      firstParent: true, ...(opts.stopAt ? { stopAt: opts.stopAt } : {}),
    })
    return commits.map(c => ({ oid: c.oid, at: new Date(c.committer.timestamp * 1000).toISOString(), by: c.author.name }))
  }

  // ─── Branch operations ──────────────────────────────────────────────────────

  async headSha(repoPath: string): Promise<string> {
    return gitFor(repoPath).resolveOrThrow('HEAD')
  }

  /** GH34 — tags (triés) pointant sur le commit HEAD, annotés déréférencés ; `[]` si aucun. */
  async tagsAtHead(repoPath: string): Promise<string[]> {
    const g = gitFor(repoPath)
    const head = await g.resolveOrThrow('HEAD')
    const tags = await g.refs(['refs/tags'])
    return tags
      .filter(t => (t.peeled ?? t.oid) === head)
      .map(t => t.ref.slice('refs/tags/'.length))
      .sort()
  }

  async currentBranch(repoPath: string): Promise<string> {
    return (await gitFor(repoPath).currentBranch()) ?? 'HEAD'
  }

  async listBranches(repoPath: string): Promise<string[]> {
    return gitFor(repoPath).refNames('refs/heads')
  }

  async createBranch(repoPath: string, branchName: string): Promise<void> {
    await git.branch({ fs, dir: repoPath, ref: branchName })
  }

  async checkout(repoPath: string, branchName: string, create?: boolean): Promise<void> {
    if (create) {
      await git.branch({ fs, dir: repoPath, ref: branchName, checkout: true })
    } else {
      await safeCheckout({ dir: repoPath, ref: branchName })
    }
  }

  async deleteBranch(repoPath: string, name: string): Promise<void> {
    await git.deleteBranch({ fs, dir: repoPath, ref: name })
  }

  async mergeBase(repoPath: string, a: string, b: string): Promise<string> {
    const g = gitFor(repoPath)
    const [shaA, shaB] = await Promise.all([g.resolveOrThrow(a), g.resolveOrThrow(b)])
    const [base] = await g.mergeBases(shaA, shaB)
    if (!base) throw new Error(`No common ancestor found between ${a} and ${b}`)
    return base
  }
}

interface NodeError extends Error {
  code?: string
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error && 'code' in err
}
