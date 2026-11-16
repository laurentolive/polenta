import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { objectData, objectInfo, type ObjectInfo } from './cat-file-batch'
import { GitError, isGitError } from './git-errors'
import { gitText, repoKey, runGit, splitZ, type RunOptions } from './git-runner'
import { closeRepo } from './process-registry'

/**
 * GH337 — la seule API git des services (design §4). Une instance par dépôt (`gitFor`).
 * Lectures : `cat-file --batch-command` persistant + processus ponctuels groupés. Écritures :
 * file par dépôt. Aucun service n'importe de moteur git ni ne lance `git` en dehors de ce module.
 */

export interface GitPerson { name: string; email: string; timestamp: number; tzOffset: number }
export interface GitAuthor { name: string; email: string }

export interface CommitInfo {
  oid: string
  tree: string
  parents: string[]
  author: GitPerson
  committer: GitPerson
  message: string
}

export interface TagInfo { oid: string; object: string; type: string; tag: string; tagger: GitPerson | null; message: string }
export interface TreeEntry { mode: string; type: 'blob' | 'tree' | 'commit'; oid: string; path: string }
export interface RefInfo { ref: string; oid: string; peeled: string | null; upstream: string | null; symref: string | null }
export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T'
export interface NameStatus { path: string; status: ChangeStatus; oldPath?: string }

/**
 * Entrée de `status --porcelain=v2`. `index` / `worktree` : `.` (inchangé), `M`, `A`, `D`, `R`, `C`,
 * `T`, `U` (non fusionné) ; `?` pour un non suivi, `!` pour un ignoré.
 */
export interface StatusEntry { path: string; index: string; worktree: string; origPath?: string }

export interface MergeTreeResult { clean: boolean; tree: string; conflicts: string[] }

export const NULL_OID = '0000000000000000000000000000000000000000'
const OID_RE = /^[0-9a-f]{40}$/

/** Options `-c` qui neutralisent la config locale d'un dépôt pour un commit ou une fusion de Polenta. */
function commitConfig(author?: GitAuthor): string[] {
  const c = ['-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', `core.hooksPath=${emptyHooksDir()}`]
  if (author) c.push('-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`)
  return c
}

let hooksDir: string | null = null
function emptyHooksDir(): string {
  if (!hooksDir) {
    hooksDir = path.join(os.tmpdir(), 'polenta-git-no-hooks')
    fs.mkdirSync(hooksDir, { recursive: true })
  }
  return hooksDir
}

function personEnv(prefix: 'AUTHOR' | 'COMMITTER', p: GitAuthor & { timestamp?: number }): Record<string, string> {
  const e: Record<string, string> = { [`GIT_${prefix}_NAME`]: p.name, [`GIT_${prefix}_EMAIL`]: p.email }
  if (p.timestamp !== undefined) e[`GIT_${prefix}_DATE`] = `@${p.timestamp} +0000`
  return e
}

function parsePerson(line: string): GitPerson {
  const m = /^(.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(line)
  if (!m) return { name: line, email: '', timestamp: 0, tzOffset: 0 }
  const tz = m[4]
  const minutes = (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3))) * (tz[0] === '-' ? -1 : 1)
  return { name: m[1], email: m[2], timestamp: Number(m[3]), tzOffset: minutes }
}

export function parseCommitObject(oid: string, data: Buffer): CommitInfo {
  const text = data.toString('utf8')
  const sep = text.indexOf('\n\n')
  const head = sep < 0 ? text : text.slice(0, sep)
  const message = sep < 0 ? '' : text.slice(sep + 2)
  const c: CommitInfo = {
    oid, tree: '', parents: [], message,
    author: { name: '', email: '', timestamp: 0, tzOffset: 0 },
    committer: { name: '', email: '', timestamp: 0, tzOffset: 0 },
  }
  for (const line of head.split('\n')) {
    if (line.startsWith(' ')) continue // continuation (gpgsig)
    const sp = line.indexOf(' ')
    const key = line.slice(0, sp)
    const val = line.slice(sp + 1)
    if (key === 'tree') c.tree = val
    else if (key === 'parent') c.parents.push(val)
    else if (key === 'author') c.author = parsePerson(val)
    else if (key === 'committer') c.committer = parsePerson(val)
  }
  return c
}

function parseTagObject(oid: string, data: Buffer): TagInfo {
  const text = data.toString('utf8')
  const sep = text.indexOf('\n\n')
  const head = sep < 0 ? text : text.slice(0, sep)
  const t: TagInfo = { oid, object: '', type: '', tag: '', tagger: null, message: sep < 0 ? '' : text.slice(sep + 2) }
  for (const line of head.split('\n')) {
    const sp = line.indexOf(' ')
    const key = line.slice(0, sp)
    const val = line.slice(sp + 1)
    if (key === 'object') t.object = val
    else if (key === 'type') t.type = val
    else if (key === 'tag') t.tag = val
    else if (key === 'tagger') t.tagger = parsePerson(val)
  }
  return t
}

/** `status --porcelain=v2 -z` → entrées (les renommages occupent deux champs NUL). */
export function parseStatusV2(out: Buffer | string): StatusEntry[] {
  const parts = splitZ(out)
  const entries: StatusEntry[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const kind = p[0]
    if (kind === '1') {
      const f = p.split(' ')
      entries.push({ index: f[1][0], worktree: f[1][1], path: f.slice(8).join(' ') })
    } else if (kind === '2') {
      const f = p.split(' ')
      entries.push({ index: f[1][0], worktree: f[1][1], path: f.slice(9).join(' '), origPath: parts[++i] })
    } else if (kind === 'u') {
      const f = p.split(' ')
      entries.push({ index: 'U', worktree: 'U', path: f.slice(10).join(' ') })
    } else if (kind === '?') {
      entries.push({ index: '?', worktree: '?', path: p.slice(2) })
    } else if (kind === '!') {
      entries.push({ index: '!', worktree: '!', path: p.slice(2) })
    }
  }
  return entries
}

/** Sortie `-z` de `diff-tree --name-status` / `log --name-status` (R/C suivis de deux chemins). */
export function parseNameStatus(parts: string[], start = 0, end = parts.length): NameStatus[] {
  const out: NameStatus[] = []
  for (let i = start; i < end; i++) {
    const code = parts[i]
    if (!code) continue
    const status = code[0] as ChangeStatus
    if (status === 'R' || status === 'C') {
      out.push({ status, oldPath: parts[i + 1], path: parts[i + 2] })
      i += 2
    } else {
      out.push({ status, path: parts[i + 1] })
      i += 1
    }
  }
  return out
}

const LOG_FORMAT = '%x01%H%x00%T%x00%P%x00%an%x00%ae%x00%at%x00%ad%x00%cn%x00%ce%x00%ct%x00%B%x00'

function tzOf(dateField: string): number {
  // %ad au format --date=raw : "<ts> <+hhmm>"
  const tz = dateField.split(' ')[1] ?? '+0000'
  return (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3))) * (tz[0] === '-' ? -1 : 1)
}

export interface LogEntry extends CommitInfo { changes?: NameStatus[] }

/** Analyse la sortie de `log -z --format=LOG_FORMAT [--name-status]`. */
export function parseLog(out: Buffer | string, withChanges: boolean): LogEntry[] {
  const text = typeof out === 'string' ? out : out.toString('utf8')
  const entries: LogEntry[] = []
  for (const chunk of text.split('\x01')) {
    if (!chunk) continue
    const f = chunk.split('\0')
    const [oid, tree, parents, an, ae, at, ad, cn, ce, ct, body] = f
    const e: LogEntry = {
      oid, tree,
      parents: parents ? parents.split(' ') : [],
      author: { name: an, email: ae, timestamp: Number(at), tzOffset: tzOf(ad ?? '') },
      committer: { name: cn, email: ce, timestamp: Number(ct), tzOffset: 0 },
      message: body ?? '',
    }
    if (withChanges) {
      // Après le corps : un champ vide puis « \n » avant la première paire statut\0chemin.
      const rest = f.slice(11)
      while (rest.length && rest[0].replace(/\n/g, '') === '') rest.shift()
      if (rest.length) rest[0] = rest[0].replace(/^\n+/, '')
      e.changes = parseNameStatus(rest)
    }
    entries.push(e)
  }
  return entries
}

export interface NetworkOptions {
  /** Variables askpass de l'opération (§6). */
  env?: Record<string, string>
  timeoutMs?: number
  /** Options `-c` (proxy). */
  config?: string[]
  onProgress?: (line: string) => void
  signal?: AbortSignal
}

export class GitBackend {
  constructor(readonly dir: string) {}

  private run(args: string[], opts?: RunOptions) { return runGit(this.dir, args, opts) }
  private text(args: string[], opts?: RunOptions) { return gitText(this.dir, args, opts) }

  // ─── Lectures ────────────────────────────────────────────────────────────────

  /** oid de `rev` (oid, branche, tag, `HEAD`, `rev:path`, `rev^{tree}`…), `null` si absent. */
  async resolve(rev: string): Promise<string | null> {
    return (await objectInfo(this.dir, rev))?.oid ?? null
  }

  async resolveOrThrow(rev: string): Promise<string> {
    const oid = await this.resolve(rev)
    if (!oid) throw new GitError('not-found', ['resolve', rev], null, `référence introuvable : ${rev}`)
    return oid
  }

  /** Commit visé par `rev` (tag annoté déréférencé). */
  async resolveCommit(rev: string): Promise<string | null> {
    return this.resolve(`${rev}^{commit}`)
  }

  objectInfo(rev: string): Promise<ObjectInfo | null> {
    return objectInfo(this.dir, rev)
  }

  async currentBranch(): Promise<string | null> {
    try {
      return (await this.text(['symbolic-ref', '-q', '--short', 'HEAD'])).trim() || null
    } catch (err) {
      if (isGitError(err)) return null
      throw err
    }
  }

  async readBlob(rev: string): Promise<Buffer | null> {
    const o = await objectData(this.dir, rev)
    return o && o.type === 'blob' ? o.data : null
  }

  async readText(rev: string, filePath: string): Promise<string | null> {
    return (await this.readBlob(`${rev}:${filePath}`))?.toString('utf8') ?? null
  }

  async readCommit(rev: string): Promise<CommitInfo | null> {
    const o = await objectData(this.dir, OID_RE.test(rev) ? rev : `${rev}^{commit}`)
    return o && o.type === 'commit' ? parseCommitObject(o.oid, o.data) : null
  }

  async readTag(oid: string): Promise<TagInfo | null> {
    const o = await objectData(this.dir, oid)
    return o && o.type === 'tag' ? parseTagObject(o.oid, o.data) : null
  }

  /** Entrées de l'arbre de `rev` sous `prefix` (récursif par défaut, fichiers seulement). */
  async lsTree(rev: string, opts: { prefix?: string; recursive?: boolean; trees?: boolean } = {}): Promise<TreeEntry[]> {
    const args = ['ls-tree', '-z', '--full-tree']
    if (opts.recursive !== false) args.push('-r')
    if (opts.trees) args.push('-t')
    args.push(rev)
    if (opts.prefix) args.push('--', opts.prefix.replace(/\/$/, '') + (opts.recursive === false ? '/' : ''))
    let out: Buffer
    try {
      out = (await this.run(args)).stdout
    } catch (err) {
      if (isGitError(err, 'not-found')) return []
      throw err
    }
    return splitZ(out).map(line => {
      const tab = line.indexOf('\t')
      const [mode, type, oid] = line.slice(0, tab).split(' ')
      return { mode, type: type as TreeEntry['type'], oid, path: line.slice(tab + 1) }
    })
  }

  /** Commits de `revs` (plus récents d'abord). `changes` : fichiers modifiés (premier parent, fusions incluses si `mergesVsFirstParent`). */
  async log(revs: string | string[], opts: {
    limit?: number; paths?: string[]; firstParent?: boolean; changes?: boolean; mergesVsFirstParent?: boolean; topoOrder?: boolean
  } = {}): Promise<LogEntry[]> {
    const args = ['log', '-z', `--format=${LOG_FORMAT}`, '--date=raw']
    if (opts.limit) args.push(`-n${opts.limit}`)
    if (opts.firstParent) args.push('--first-parent')
    if (opts.topoOrder) args.push('--topo-order')
    if (opts.changes) args.push('--name-status', '--no-renames')
    if (opts.changes && opts.mergesVsFirstParent) args.push('--diff-merges=first-parent')
    args.push(...(Array.isArray(revs) ? revs : [revs]))
    args.push('--')
    if (opts.paths) args.push(...opts.paths)
    try {
      return parseLog((await this.run(args)).stdout, !!opts.changes)
    } catch (err) {
      // Dépôt sans commit, ou rev absente.
      if (isGitError(err, 'not-found') || (isGitError(err) && /does not have any commits/.test(err.stderr))) return []
      throw err
    }
  }

  /** Refs selon les motifs (`refs/heads`, `refs/tags`, `refs/remotes`), avec cible pelée des tags annotés. */
  async refs(patterns: string[] = []): Promise<RefInfo[]> {
    const fmt = '%(refname)%00%(objectname)%00%(*objectname)%00%(upstream)%00%(symref)'
    const out = await this.text(['for-each-ref', `--format=${fmt}`, ...patterns])
    return out.split('\n').filter(Boolean).map(line => {
      const [ref, oid, peeled, upstream, symref] = line.split('\0')
      return { ref, oid, peeled: peeled || null, upstream: upstream || null, symref: symref || null }
    })
  }

  async remotes(): Promise<{ name: string; url: string }[]> {
    let out: string
    try {
      out = await this.text(['config', '--get-regexp', '^remote\\..*\\.url$'])
    } catch (err) {
      if (isGitError(err) && err.exitCode === 1) return []
      throw err
    }
    return out.split('\n').filter(Boolean).map(line => {
      const sp = line.indexOf(' ')
      return { name: line.slice('remote.'.length, sp - '.url'.length), url: line.slice(sp + 1) }
    })
  }

  async config(key: string): Promise<string | null> {
    try {
      return (await this.text(['config', '--get', key])).trim()
    } catch (err) {
      if (isGitError(err) && err.exitCode === 1) return null
      throw err
    }
  }

  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const r = await this.run(['merge-base', '--is-ancestor', ancestor, descendant], { okExitCodes: [1] })
    return r.exitCode === 0
  }

  async mergeBases(a: string, b: string): Promise<string[]> {
    const r = await this.run(['merge-base', '--all', a, b], { okExitCodes: [1] })
    return r.stdout.toString('utf8').split('\n').filter(Boolean)
  }

  /** Fichiers différents entre deux arbres-ish (`null` = arbre vide). */
  async diffNames(a: string | null, b: string | null, opts: { prefixes?: string[]; renames?: boolean } = {}): Promise<NameStatus[]> {
    const EMPTY = '4b825dc642cb6eb9a060e54bf8d69288fbee4904' // arbre vide (sha-1)
    const args = ['diff-tree', '-r', '-z', '--name-status', opts.renames ? '-M' : '--no-renames', a ?? EMPTY, b ?? EMPTY]
    if (opts.prefixes?.length) args.push('--', ...opts.prefixes)
    return parseNameStatus(splitZ((await this.run(args)).stdout))
  }

  /** **Seule définition de « modification locale »** (GH336 C) : statut du working directory et de l'index. */
  async status(opts: { prefixes?: string[]; ignored?: boolean } = {}): Promise<StatusEntry[]> {
    const args = ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--no-renames']
    if (opts.ignored) args.push('--ignored=matching')
    if (opts.prefixes?.length) args.push('--', ...opts.prefixes)
    const entries = parseStatusV2((await this.run(args)).stdout)
    const suspects = entries.filter(e => e.index === '.' && e.worktree === 'M').map(e => e.path)
    if (suspects.length === 0) return entries
    const statOnly = new Set(await this.statOnlyChanges(suspects))
    if (statOnly.size === 0) return entries
    // Contenu identique à l'index une fois les filtres appliqués (fins de ligne, GH296/GH335/#336 ;
    // taille sur disque différente de celle notée dans l'index) : rafraîchir l'entrée d'index, sans
    // toucher au disque ni créer de modification (design §9).
    await this.add([...statOnly])
    return entries.filter(e => !statOnly.has(e.path))
  }

  /** Chemins dont le contenu filtré (`.gitattributes`) est identique au blob de l'index. */
  private async statOnlyChanges(paths: string[]): Promise<string[]> {
    const staged = splitZ((await this.run(['ls-files', '-s', '-z', '--', ...paths])).stdout)
    const indexOid = new Map<string, string>()
    for (const line of staged) {
      const tab = line.indexOf('\t')
      indexOid.set(line.slice(tab + 1), line.slice(0, tab).split(' ')[1])
    }
    const candidates = paths.filter(p => indexOid.has(p) && fs.existsSync(path.join(this.dir, p)))
    if (candidates.length === 0) return []
    const hashes = (await this.text(['hash-object', '--stdin-paths'], { stdin: candidates.join('\n') + '\n' }))
      .split('\n').filter(Boolean)
    return candidates.filter((p, i) => hashes[i] === indexOid.get(p))
  }

  async checkIgnore(paths: string[]): Promise<Set<string>> {
    if (paths.length === 0) return new Set()
    const r = await this.run(['check-ignore', '--stdin', '-z'], { stdin: paths.join('\0') + '\0', okExitCodes: [1] })
    return new Set(splitZ(r.stdout))
  }

  async lsFiles(prefixes: string[] = []): Promise<string[]> {
    return splitZ((await this.run(['ls-files', '-z', '--', ...prefixes])).stdout)
  }

  // ─── Écritures locales ───────────────────────────────────────────────────────

  private w(args: string[], opts: RunOptions = {}) { return this.run(args, { ...opts, write: true }) }

  async init(initialBranch = 'main'): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true })
    await this.w(['init', '-q', '-b', initialBranch])
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.w(['remote', 'add', name, url])
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    await this.w(['remote', 'set-url', name, url])
  }

  async setConfig(key: string, value: string): Promise<void> {
    await this.w(['config', key, value])
  }

  async add(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    await this.w(['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { stdin: paths.join('\0') })
  }

  async addAll(): Promise<void> {
    await this.w(['add', '-A'])
  }

  async remove(paths: string[], opts: { cached?: boolean } = {}): Promise<void> {
    if (paths.length === 0) return
    const args = ['rm', '-q', '-r', '--ignore-unmatch']
    if (opts.cached) args.push('--cached')
    await this.w([...args, '--pathspec-from-file=-', '--pathspec-file-nul'], { stdin: paths.join('\0') })
  }

  /** Retire de l'index (unstage) sans toucher au disque. */
  async resetPaths(paths?: string[]): Promise<void> {
    const hasHead = (await this.resolve('HEAD')) !== null
    if (!hasHead) {
      await this.w(['rm', '-q', '-r', '--cached', '--ignore-unmatch', '--', ...(paths ?? ['.'])])
      return
    }
    if (!paths) { await this.w(['reset', '-q']); return }
    if (paths.length === 0) return
    await this.w(['reset', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'], { stdin: paths.join('\0') })
  }

  /** Abandonne les modifications (index et disque) des chemins suivis ; supprime les non suivis listés. */
  async restore(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    const tracked = new Set(await this.lsFilesAtHead(paths))
    const inHead = paths.filter(p => tracked.has(p))
    const notInHead = paths.filter(p => !tracked.has(p))
    if (inHead.length) {
      await this.w(['restore', '--source=HEAD', '--staged', '--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'], { stdin: inHead.join('\0') })
    }
    if (notInHead.length) {
      await this.w(['rm', '-q', '-r', '--cached', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul'], { stdin: notInHead.join('\0') })
      for (const p of notInHead) fs.rmSync(path.join(this.dir, p), { force: true, recursive: true })
    }
  }

  private async lsFilesAtHead(paths: string[]): Promise<string[]> {
    if ((await this.resolve('HEAD')) === null) return []
    const entries = await this.lsTree('HEAD')
    const want = new Set(paths)
    return entries.filter(e => want.has(e.path)).map(e => e.path)
  }

  /**
   * Commit de l'index (ou des seuls `paths`, `--only` : le reste de l'index est conservé).
   * Hooks, signature et config locale neutralisés ; auteur = committer = `author`.
   */
  async commit(opts: { message: string; author: GitAuthor & { timestamp?: number }; allowEmpty?: boolean; paths?: string[] }): Promise<string> {
    const args = [...commitConfig(opts.author), 'commit', '-q', '--no-verify', '--cleanup=verbatim', '-F', '-']
    if (opts.allowEmpty) args.push('--allow-empty')
    if (opts.paths?.length) args.push('--only', '--', ...opts.paths)
    await this.w(args, {
      stdin: opts.message,
      env: { extra: { ...personEnv('AUTHOR', opts.author), ...personEnv('COMMITTER', opts.author) } },
    })
    return this.resolveOrThrow('HEAD')
  }

  async writeTree(): Promise<string> {
    return (await this.text(['write-tree'], { write: true })).trim()
  }

  async commitTree(tree: string, parents: string[], message: string, author: GitAuthor & { timestamp?: number }): Promise<string> {
    const args = [...commitConfig(author), 'commit-tree', tree]
    for (const p of parents) args.push('-p', p)
    const out = await this.text(args, {
      stdin: message,
      env: { extra: { ...personEnv('AUTHOR', author), ...personEnv('COMMITTER', author) } },
    })
    return out.trim()
  }

  /** Transaction de refs : tout ou rien. `newOid: null` supprime ; `oldOid` vérifie la valeur courante. */
  async updateRefs(ops: { ref: string; newOid: string | null; oldOid?: string | null }[]): Promise<void> {
    if (ops.length === 0) return
    const lines = ['start']
    for (const op of ops) {
      if (op.newOid === null) lines.push(`delete ${op.ref}${op.oldOid ? ` ${op.oldOid}` : ''}`)
      else lines.push(`update ${op.ref} ${op.newOid}${op.oldOid !== undefined ? ` ${op.oldOid ?? NULL_OID}` : ''}`)
    }
    lines.push('prepare', 'commit')
    await this.w(['update-ref', '--stdin'], { stdin: lines.join('\n') + '\n' })
  }

  async createBranch(name: string, start = 'HEAD', opts: { force?: boolean } = {}): Promise<void> {
    await this.w(['branch', ...(opts.force ? ['-f'] : []), '--', name, start])
  }

  async deleteBranch(name: string): Promise<void> {
    await this.w(['branch', '-D', '--', name])
  }

  async tag(name: string, target = 'HEAD'): Promise<void> {
    await this.w(['tag', '--', name, target])
  }

  async annotatedTag(name: string, target: string, message: string, tagger: GitAuthor): Promise<void> {
    await this.w([...commitConfig(tagger), 'tag', '-a', '--no-sign', '-F', '-', '--', name, target], {
      stdin: message, env: { extra: personEnv('COMMITTER', tagger) },
    })
  }

  async deleteTag(name: string): Promise<void> {
    await this.w(['tag', '-d', '--', name])
  }

  /**
   * Checkout : refuse (GitError `local-changes`) plutôt que d'écraser une modification locale.
   * `detach` : tête détachée sur un commit ou un tag.
   */
  async checkout(rev: string, opts: { detach?: boolean; force?: boolean } = {}): Promise<void> {
    const args = [...commitConfig(), 'checkout', '-q']
    if (opts.force) args.push('-f')
    if (opts.detach) args.push('--detach')
    args.push(rev, '--')
    await this.w(args)
  }

  async resetHard(rev: string): Promise<void> {
    await this.w(['reset', '-q', '--hard', rev])
  }

  async resetSoft(rev: string): Promise<void> {
    await this.w(['reset', '-q', '--soft', rev])
  }

  /** Avance la branche courante (et le working directory) sur `target`, en avance rapide seulement. */
  async mergeFastForward(target: string): Promise<void> {
    await this.w([...commitConfig(), 'merge', '-q', '--ff-only', '--no-edit', target])
  }

  // ─── Fusion ──────────────────────────────────────────────────────────────────

  /**
   * Fusion calculée sans toucher au working directory ni à l'index (`abortOnConflict`, T84). git gère
   * l'histoire croisée (base virtuelle récursive, GH332).
   */
  async mergeTree(ours: string, theirs: string): Promise<MergeTreeResult> {
    const r = await this.run(
      [...commitConfig(), 'merge-tree', '--write-tree', '-z', '--name-only', '--no-messages', ours, theirs],
      { okExitCodes: [1] },
    )
    const parts = splitZ(r.stdout)
    const tree = parts[0]
    const conflicts = r.exitCode === 1 ? [...new Set(parts.slice(1).filter(Boolean))] : []
    return { clean: r.exitCode === 0, tree, conflicts }
  }

  // ─── Réseau ──────────────────────────────────────────────────────────────────

  private net(args: string[], opts: NetworkOptions, write = true) {
    return this.run([...(opts.config ?? []), ...args], {
      write, timeoutMs: opts.timeoutMs, onStderrLine: opts.onProgress, signal: opts.signal,
      env: { extra: opts.env },
    })
  }

  async fetch(remote: string, opts: NetworkOptions & { prune?: boolean; refspecs?: string[] } = {}): Promise<void> {
    await this.net(['fetch', '-q', ...(opts.prune ? ['--prune'] : []), remote, ...(opts.refspecs ?? [])], opts)
  }

  async push(remote: string, refspecs: string[], opts: NetworkOptions & { force?: boolean } = {}): Promise<void> {
    await this.net(['push', '-q', '--porcelain', ...(opts.force ? ['--force'] : []), remote, ...refspecs], opts)
  }

  /** Arrête les processus persistants du dépôt et attend leur fin (avant suppression ou renommage du dossier). */
  close(): Promise<void> {
    return closeRepo(this.dir)
  }
}

/** Clone (hors d'un dépôt existant). */
export async function gitClone(url: string, dest: string, opts: NetworkOptions & { branch?: string; depth?: number } = {}): Promise<void> {
  const parent = path.dirname(path.resolve(dest))
  fs.mkdirSync(parent, { recursive: true })
  const args = [...(opts.config ?? []), 'clone', '--progress', '--no-hardlinks']
  if (opts.branch) args.push('--branch', opts.branch, '--single-branch')
  if (opts.depth) args.push('--depth', String(opts.depth))
  args.push('--', url, path.resolve(dest))
  await runGit(parent, args, {
    write: true, timeoutMs: opts.timeoutMs, onStderrLine: opts.onProgress, signal: opts.signal, env: { extra: opts.env },
  })
}

/** Branches du remote (`refs/heads/*`), sans clone. */
export async function gitLsRemoteHeads(url: string, cwd: string, opts: NetworkOptions = {}): Promise<string[]> {
  const out = await runGit(cwd, [...(opts.config ?? []), 'ls-remote', '--heads', '--', url], {
    timeoutMs: opts.timeoutMs, signal: opts.signal, env: { extra: opts.env },
  })
  return out.stdout.toString('utf8').split('\n').filter(Boolean).map(l => l.split('\t')[1].replace(/^refs\/heads\//, ''))
}

/** Racine du dépôt contenant `p`, `null` hors dépôt. */
export async function gitFindRoot(p: string): Promise<string | null> {
  try {
    const dir = fs.statSync(p).isDirectory() ? p : path.dirname(p)
    return path.resolve((await gitText(dir, ['rev-parse', '--show-toplevel'])).trim())
  } catch {
    return null
  }
}

const backends = new Map<string, GitBackend>()

export function gitFor(repoPath: string): GitBackend {
  const key = repoKey(repoPath)
  let b = backends.get(key)
  if (!b) backends.set(key, (b = new GitBackend(path.resolve(repoPath))))
  return b
}
