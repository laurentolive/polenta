import * as fs from 'fs'
import * as path from 'path'

import { gitFor, type GitBackend } from './git-backend'
import { runGit } from './git-runner'

/**
 * GH337 sprint 4 — fixtures de dépôts pour les tests, avec le git embarqué (plus isomorphic-git).
 *
 * Principes : les fichiers s'écrivent en synchrone, sans processus ; un commit = un `add` + un
 * `commit` ; auteur et date sont fixés (`DEFAULT_AUTHOR`, `timestamp` en secondes UTC) pour que les
 * oids et l'ordre des historiques soient reproductibles.
 */

export interface TestAuthor { name: string; email: string; timestamp?: number }

export const DEFAULT_AUTHOR: TestAuthor = { name: 'Testeur', email: 't@x' }

/** Un fichier à écrire : contenu texte (LF tel quel) ou binaire. */
export type FixtureFiles = Record<string, string | Buffer>

export class TestRepo {
  readonly git: GitBackend

  constructor(readonly dir: string) {
    this.git = gitFor(dir)
  }

  /** `git init` (crée le dossier). */
  static async init(dir: string, initialBranch = 'main'): Promise<TestRepo> {
    const repo = new TestRepo(dir)
    await repo.git.init(initialBranch)
    return repo
  }

  /** Dépôt avec un commit initial (fichiers optionnels), auteur et date fixés. */
  static async create(dir: string, files: FixtureFiles = {}, opts: { initialBranch?: string; message?: string; author?: TestAuthor } = {}): Promise<TestRepo> {
    const repo = await TestRepo.init(dir, opts.initialBranch)
    repo.write(files)
    await repo.commitAll(opts.message ?? 'init', opts.author)
    return repo
  }

  /** Écrit des fichiers (chemins relatifs au dépôt), en créant les dossiers. Aucun processus. */
  write(files: FixtureFiles): this {
    for (const [rel, data] of Object.entries(files)) {
      const abs = path.join(this.dir, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, data)
    }
    return this
  }

  /** Lit un fichier du disque (chemin relatif au dépôt). */
  read(rel: string): string {
    return fs.readFileSync(path.join(this.dir, rel), 'utf8')
  }

  /** Supprime un fichier du disque (sans toucher à l'index). */
  unlink(rel: string): this {
    fs.rmSync(path.join(this.dir, rel), { force: true, recursive: true })
    return this
  }

  /** `git add` des chemins (`.` par défaut). */
  async add(paths: string[] = ['.']): Promise<this> {
    await this.git.add(paths)
    return this
  }

  /**
   * Commit de l'index tel quel (sans `add`). Commit vide accepté par défaut : comme l'ancien moteur
   * des fixtures, un commit sans changement n'échoue pas.
   */
  async commit(message: string, author: TestAuthor = DEFAULT_AUTHOR, opts: { allowEmpty?: boolean; paths?: string[] } = {}): Promise<string> {
    return this.git.commit({ message, author, allowEmpty: opts.allowEmpty ?? true, paths: opts.paths })
  }

  /** `add .` puis commit : le cas le plus courant des fixtures. */
  async commitAll(message: string, author: TestAuthor = DEFAULT_AUTHOR, opts: { allowEmpty?: boolean } = {}): Promise<string> {
    await this.add(['.'])
    return this.commit(message, author, opts)
  }

  /** Écrit des fichiers, `add .` et commit, en une étape. */
  async writeCommit(files: FixtureFiles, message: string, author: TestAuthor = DEFAULT_AUTHOR): Promise<string> {
    this.write(files)
    return this.commitAll(message, author)
  }

  /** Commit avec date fixée (secondes UTC) pour les auteurs et l'ordre des historiques. */
  async commitAt(files: FixtureFiles, message: string, timestamp: number, author: TestAuthor = DEFAULT_AUTHOR): Promise<string> {
    this.write(files)
    await this.add(['.'])
    return this.commit(message, { ...author, timestamp })
  }

  async branch(name: string, start = 'HEAD'): Promise<void> {
    await this.git.createBranch(name, start)
  }

  async deleteBranch(name: string): Promise<void> {
    await this.git.deleteBranch(name)
  }

  /** Bascule sur une branche ou un commit. `create` : crée la branche depuis HEAD d'abord. */
  async checkout(rev: string, opts: { create?: boolean; detach?: boolean; force?: boolean } = {}): Promise<void> {
    if (opts.create) await this.git.createBranch(rev)
    await this.git.checkout(rev, { detach: opts.detach, force: opts.force })
  }

  async tag(name: string, target = 'HEAD'): Promise<void> {
    await this.git.tag(name, target)
  }

  async annotatedTag(name: string, target: string, message: string, tagger: TestAuthor = DEFAULT_AUTHOR): Promise<void> {
    await this.git.annotatedTag(name, target, message, tagger)
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.git.addRemote(name, url)
  }

  async removeRemote(name: string): Promise<void> {
    await this.git.removeRemote(name)
  }

  /** Remote `origin` pointant sur un dépôt local (`file://`), pour fetch/push sans réseau. */
  async addLocalRemote(name: string, remoteDir: string): Promise<void> {
    await this.git.addRemote(name, pathToFileUrl(remoteDir))
  }

  async setConfig(key: string, value: string): Promise<void> {
    await this.git.setConfig(key, value)
  }

  /** Retire une clé de la config locale (sans erreur si elle est absente). */
  async unsetConfig(key: string): Promise<void> {
    await this.raw(['config', '--local', '--unset-all', key]).catch(() => undefined)
  }

  /** Exécute une commande git brute (cas non couverts par `GitBackend`). Réservé aux fixtures. */
  async raw(args: string[], stdin?: string): Promise<string> {
    const r = await runGit(this.dir, args, { stdin, write: true })
    return r.stdout.toString('utf8')
  }

  /** oid complet de `rev` (lève si absent). */
  resolve(rev = 'HEAD'): Promise<string> {
    return this.git.resolveOrThrow(rev)
  }

  /** Branche courante, `null` en tête détachée. */
  currentBranch(): Promise<string | null> {
    return this.git.currentBranch()
  }

  /** Noms des branches locales, triés. */
  listBranches(): Promise<string[]> {
    return this.git.refNames('refs/heads')
  }

  /** Noms des tags, triés. */
  listTags(): Promise<string[]> {
    return this.git.refNames('refs/tags')
  }

  /**
   * État d'un chemin, en vocabulaire de fixtures : `unmodified`, `added`, `modified` (indexé),
   * `*modified` (non indexé), `*deleted`, `*added` (non suivi).
   */
  async status(rel: string): Promise<string> {
    const entry = (await this.git.status({ prefixes: [rel] })).find(e => e.path === rel)
    if (!entry) return 'unmodified'
    if (entry.index === '?') return '*added'
    if (entry.worktree === '.' || entry.worktree === ' ') {
      if (entry.index === 'A') return 'added'
      return 'modified'
    }
    if (entry.worktree === 'D') return '*deleted'
    return '*modified'
  }
}

/** `file://` pour un chemin absolu, avec les `/` attendus par git sous Windows. */
export function pathToFileUrl(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, '/')
  return abs.startsWith('/') ? `file://${abs}` : `file:///${abs}`
}
