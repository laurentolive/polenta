import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as zlib from 'zlib'
import { pathToFileURL } from 'url'

import { objectData, objectInfo, resolveGitDir, type ObjectInfo } from './cat-file-batch'
import { GitError, isGitError, MergeConflictError } from './git-errors'
import { gitText, isRepoWriteBusy, repoKey, runGit, splitZ, withRepoFetchLock, withRepoWriteLock, type RunOptions, type RunResult } from './git-runner'
import { closeRepo } from './process-registry'
import { gitInstall } from './git-binary'
import { gitHooksDir } from './git-config'
import { isSafeTreePath, nodeCheckout } from './node-checkout'
import { openAskpassSession, type CredentialResolver } from './askpass'
import { checkRemote } from '../services/forge/remote-guard'
import { resolveProxyUrl } from '../services/net-proxy'
import { CONNECT_TIMEOUT_BASE_MS, GIT_IO_TIMEOUT_BASE_MS, scaledTimeout } from '../services/net-timeouts'

/**
 * Checkout écrit par Polenta (`nodeCheckout`) : Windows seulement (Defender n'existe que là), avec un
 * git qui connaît `check-attr --source` (≥ 2.40 ; le git 2.39 de Debian bookworm ne l'a pas).
 * `POLENTA_NODE_CHECKOUT=0` le désactive (comparaisons, diagnostic).
 */
export function useNodeCheckout(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32' || process.env.POLENTA_NODE_CHECKOUT === '0') return false
  const [maj, min] = gitInstall().version.split('.').map(Number)
  return maj > 2 || (maj === 2 && min >= 40)
}

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

/**
 * GH337 P5 — budget de la ligne de commande par lot de chemins (Windows : ~32 Ko, `ENAMETOOLONG` au-delà).
 * Marge de guillemets et d'espaces par chemin comprise.
 */
const ARGV_PATHS_BUDGET = 24_000

/** Découpe `paths` en lots dont la longueur de ligne de commande reste sous `budget`. `[]` → un lot vide. */
export function chunkPaths(paths: string[], budget = ARGV_PATHS_BUDGET): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let size = 0
  for (const p of paths) {
    const cost = p.length + 3
    if (current.length > 0 && size + cost > budget) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(p)
    size += cost
  }
  batches.push(current)
  return batches
}

/** Auteur des commits de base virtuelle : jamais référencés, seul leur arbre compte. */
const VIRTUAL_AUTHOR: GitAuthor = { name: 'Polenta', email: 'polenta@localhost' }

/** `refs/heads/x` ou `refs/remotes/o/x` → `x` / `o/x` (message de fusion). */
function shortRef(ref: string): string {
  return ref.replace(/^refs\/(heads|remotes)\//, '')
}

/** Options `-c` qui neutralisent la config locale d'un dépôt pour un commit ou une fusion de Polenta. */
function commitConfig(author?: GitAuthor): string[] {
  const c = ['-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', `core.hooksPath=${emptyHooksDir()}`]
  if (author) c.push('-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`)
  return c
}

/** GH337 P4 — dossier vide des hooks, privé (userData/git/hooks, `0700`), même que la config globale. */
function emptyHooksDir(): string {
  return gitHooksDir()
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

/**
 * `remote.<nom>.url` d'une config git au format simple, dans l'ordre du fichier (comme `git config
 * --get-regexp`). `null` (→ `git config`) dès que le fichier sort de ce format : `include`, ligne
 * continuée, guillemet ou barre oblique inverse dans une valeur, section mal formée.
 */
export function parseRemoteUrls(text: string): { name: string; url: string }[] | null {
  const out: { name: string; url: string }[] = []
  let remote: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    if (line.startsWith('[')) {
      const m = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"([^"\\]*)")?\s*\]$/.exec(line)
      if (!m) return null
      const section = m[1].toLowerCase()
      if (section === 'include' || section === 'includeif' || section.startsWith('remote.')) return null
      remote = section === 'remote' && m[2] !== undefined ? m[2] : null
      continue
    }
    if (/\\\s*$/.test(line)) return null
    const eq = line.indexOf('=')
    const name = (eq < 0 ? line : line.slice(0, eq)).trim().toLowerCase()
    if (!/^[a-z][a-z0-9-]*$/.test(name)) return null
    if (remote === null || name !== 'url') continue
    let value = eq < 0 ? '' : line.slice(eq + 1).trim()
    if (/["\\]/.test(value)) return null
    value = value.replace(/\s+[#;].*$/, '')
    out.push({ name: remote, url: value })
  }
  return out
}

/**
 * Objet arbre brut (`<mode> <nom>\0<oid binaire>` répété) → entrées, chemins préfixés par `base`.
 * Modes affichés comme `ls-tree` (`040000` pour un dossier).
 */
export function parseTreeObject(data: Buffer, base: string, oidBytes = 20): TreeEntry[] {
  const out: TreeEntry[] = []
  let pos = 0
  while (pos < data.length) {
    const sp = data.indexOf(0x20, pos)
    const nul = data.indexOf(0, sp)
    const mode = data.subarray(pos, sp).toString('latin1').padStart(6, '0')
    const name = data.subarray(sp + 1, nul).toString('utf8')
    const oid = data.subarray(nul + 1, nul + 1 + oidBytes).toString('hex')
    const type: TreeEntry['type'] = mode === '040000' ? 'tree' : mode === '160000' ? 'commit' : 'blob'
    out.push({ mode, type, oid, path: base + name })
    pos = nul + 1 + oidBytes
  }
  return out
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

/** `fileHistories` : dates de commit (secondes) et auteurs de la création et de la dernière modification d'un fichier. */
export interface PathDates { created: number; createdBy: string; updated: number; updatedBy: string }

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

/** Objet arbre (format git) d'entrées d'un niveau, triées comme git (un dossier se compare avec `/`). */
export function serializeTree(entries: TreeEntry[]): Buffer {
  const key = (e: TreeEntry) => Buffer.from(e.type === 'tree' ? `${e.path}/` : e.path, 'utf8')
  const sorted = [...entries].sort((a, b) => Buffer.compare(key(a), key(b)))
  return Buffer.concat(sorted.flatMap(e => [
    Buffer.from(`${parseInt(e.mode, 8).toString(8)} ${e.path}\0`, 'utf8'),
    Buffer.from(e.oid, 'hex'),
  ]))
}

/**
 * Écrit un objet libre sans lancer git (chemin chaud : `commitSingleFile`, à chaque enregistrement
 * d'une version ou d'une validation — 5 processus évités). Même format et même écriture atomique que
 * git (fichier temporaire puis renommage) ; un objet déjà présent n'est pas réécrit. `null` quand le
 * dépôt sort du cas simple (dossier git introuvable, objets sha256) : l'appelant passe par git.
 */
export async function writeLooseObject(repo: string, type: 'blob' | 'tree', data: Buffer): Promise<string | null> {
  const gitDir = resolveGitDir(repo)
  if (!gitDir) return null
  const commonFile = await fs.promises.readFile(path.join(gitDir, 'commondir'), 'utf8').catch(() => null)
  const common = commonFile ? path.resolve(gitDir, commonFile.trim()) : gitDir
  const config = await fs.promises.readFile(path.join(common, 'config'), 'utf8').catch(() => '')
  if (/objectformat\s*=\s*sha256/i.test(config)) return null
  const raw = Buffer.concat([Buffer.from(`${type} ${data.length}\0`, 'utf8'), data])
  const oid = crypto.createHash('sha1').update(raw).digest('hex')
  const dir = path.join(common, 'objects', oid.slice(0, 2))
  const file = path.join(dir, oid.slice(2))
  if (fs.existsSync(file)) return oid
  await fs.promises.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `tmp_obj_${process.pid}_${crypto.randomBytes(6).toString('hex')}`)
  await fs.promises.writeFile(tmp, zlib.deflateSync(raw))
  try {
    await fs.promises.rename(tmp, file)
  } catch (err) {
    await fs.promises.rm(tmp, { force: true })
    if (!fs.existsSync(file)) throw err // déjà écrit en parallèle : rien à faire
  }
  return oid
}

export interface NetworkOptions {
  /** Identifiants de l'opération (§6) : lus à l'invite de git, jamais placés dans son environnement. */
  credentials?: CredentialResolver
  /** Délai de l'opération ; par défaut 300 s × facteur GH15. */
  timeoutMs?: number
  /** Ligne de progression ou d'information reçue sur stderr. */
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
    // Chemin chaud (vérification de lecture seule à chaque écriture) : le fichier HEAD se lit sans
    // lancer de processus. `symbolic-ref` en repli (hors dépôt, reftable `refs/heads/.invalid`).
    const gitDir = resolveGitDir(this.dir)
    if (gitDir) {
      const head = await fs.promises.readFile(path.join(gitDir, 'HEAD'), 'utf8').catch(() => null)
      const m = head === null ? null : /^ref: refs\/heads\/(.+?)\s*$/.exec(head)
      if (m && m[1] !== '.invalid') return m[1]
      if (head !== null && /^[0-9a-f]{40,64}\s*$/.test(head)) return null
    }
    try {
      // Pas `--short` : il rend `heads/x` quand un tag porte le même nom que la branche.
      return (await this.text(['symbolic-ref', '-q', 'HEAD'])).trim().replace(/^refs\/heads\//, '') || null
    } catch (err) {
      // `symbolic-ref -q` : 1 = tête détachée. Hors dépôt (128), on lève :
      // `GitService.currentBranch` traduirait sinon un dossier quelconque en « détaché » (lecture seule).
      if (isGitError(err) && err.exitCode === 1) return null
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
    // Par le `cat-file` persistant : pas de processus par appel (chemin chaud des listes d'exigences
    // et de tests ; ~180 `ls-tree` par fichier de test). Même résultat que `ls-tree -z --full-tree`.
    return this.lsTreeBatch(rev, opts)
  }

  /** `ls-tree` en processus ponctuel : référence de `lsTreeBatch` (test d'équivalence). */
  async lsTreeProcess(rev: string, opts: { prefix?: string; recursive?: boolean; trees?: boolean } = {}): Promise<TreeEntry[]> {
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

  private async lsTreeBatch(rev: string, opts: { prefix?: string; recursive?: boolean; trees?: boolean }): Promise<TreeEntry[]> {
    const recursive = opts.recursive !== false
    const root = await objectInfo(this.dir, `${rev}^{tree}`)
    if (!root) return []
    const readTree = async (oid: string, base: string): Promise<TreeEntry[]> => {
      const o = await objectData(this.dir, oid)
      return o && o.type === 'tree' ? parseTreeObject(o.data, base, oid.length / 2) : []
    }
    const out: TreeEntry[] = []
    // Pathspec `ls-tree` : `prefix` (sans `/`) vise l'entrée de ce nom ; en non récursif, `prefix/`
    // liste son contenu.
    const prefix = (opts.prefix ?? '').replace(/\/$/, '')
    const walk = async (entries: TreeEntry[]): Promise<void> => {
      for (const e of entries) {
        if (e.type !== 'tree') { out.push(e); continue }
        if (!recursive) { out.push(e); continue }
        if (opts.trees) out.push(e)
        await walk(await readTree(e.oid, `${e.path}/`))
      }
    }
    if (!prefix) {
      await walk(await readTree(root.oid, ''))
      return out
    }
    // Descente jusqu'au dossier parent de `prefix`.
    const parts = prefix.split('/')
    let entries = await readTree(root.oid, '')
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = entries.find(e => e.type === 'tree' && e.path === parts.slice(0, i + 1).join('/'))
      if (!dir) return out
      if (opts.trees) out.push(dir) // `-t` : dossiers traversés pour atteindre le préfixe
      entries = await readTree(dir.oid, `${dir.path}/`)
    }
    const target = entries.find(e => e.path === prefix)
    if (!target) return out
    // Non récursif : le pathspec est `prefix/`, qu'un fichier de ce nom ne satisfait pas.
    if (target.type !== 'tree') return recursive ? [...out, target] : out
    if (!recursive) {
      if (opts.trees) out.push(target)
      return [...out, ...await readTree(target.oid, `${target.path}/`)]
    }
    await walk([target])
    return out
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

  /** Dernier résultat de `remotes()`, valable tant que `.git/config` garde sa date et sa taille. */
  private remotesCache: { key: string; value: { name: string; url: string }[] } | null = null

  async remotes(): Promise<{ name: string; url: string }[]> {
    // Chemin chaud (identifiants, URL du remote à chaque opération) : pas de processus tant que la
    // config du dépôt n'a pas changé. Les écritures (addRemote, setRemoteUrl) changent sa date.
    const gitDir = resolveGitDir(this.dir)
    const st = gitDir ? await fs.promises.stat(path.join(gitDir, 'config'), { bigint: true }).catch(() => null) : null
    const key = st ? `${st.mtimeNs}:${st.ctimeNs}:${st.size}` : null
    if (key && this.remotesCache?.key === key) return this.remotesCache.value.map(r => ({ ...r }))
    // Première lecture : la config locale lue directement (un processus de moins par dépôt à
    // l'ouverture du workspace), `git config` dès qu'elle sort du format simple.
    const text = gitDir ? await fs.promises.readFile(path.join(gitDir, 'config'), 'utf8').catch(() => null) : null
    const value = (text !== null ? parseRemoteUrls(text) : null) ?? await this.remotesProcess()
    if (key) this.remotesCache = { key, value }
    return value.map(r => ({ ...r }))
  }

  private async remotesProcess(): Promise<{ name: string; url: string }[]> {
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

  /**
   * Commits accessibles depuis `tip` qu'aucune branche `refs/remotes/<remote>/*` ne contient (GH41 :
   * `git log <b> --not --remotes`), les `limit` plus récents au plus. Un seul processus, quel que soit
   * le nombre de branches distantes.
   */
  async notOnRemotes(tip: string, remote = 'origin', limit?: number): Promise<string[]> {
    const args = ['rev-list', ...(limit ? [`--max-count=${limit}`] : []), tip, '--not', `--remotes=${remote}`]
    return (await this.text(args)).split('\n').filter(Boolean)
  }

  /** `[avance, retard]` de `local` sur `remote` (commits de l'un absents de l'autre), en un processus. */
  async aheadBehind(local: string, remote: string): Promise<[number, number]> {
    const out = (await this.text(['rev-list', '--left-right', '--count', `${local}...${remote}`])).trim()
    const [ahead, behind] = out.split(/\s+/).map(Number)
    return [ahead || 0, behind || 0]
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
    const entries = await this.statusByBatches(args, opts.prefixes ?? [])
    const suspects = entries.filter(e => e.index === '.' && e.worktree === 'M').map(e => e.path)
    if (suspects.length === 0) return entries
    const statOnly = new Set(await this.statOnlyChanges(suspects))
    if (statOnly.size === 0) return entries
    // Contenu identique à l'index une fois les filtres appliqués (fins de ligne, GH296/GH335/#336 ;
    // taille sur disque différente de celle notée dans l'index) : rafraîchir l'entrée d'index, sans
    // toucher au disque ni créer de modification (design §9).
    await this.refreshStatOnly([...statOnly])
    return entries.filter(e => !statOnly.has(e.path))
  }

  /**
   * Rafraîchit l'entrée d'index de fichiers dont le contenu filtré est déjà celui de l'index. Au mieux,
   * le statut renvoyé étant juste sans lui : sauté si une écriture de Polenta est en file (un fetch
   * long ne bloque pas le statut), sans effet si l'index est verrouillé par un autre processus
   * (terminal). Un fichier réenregistré entre le hachage et `add` n'est pas laissé indexé : son entrée
   * reprend l'ancien blob (il apparaîtra modifié).
   */
  private async refreshStatOnly(paths: string[]): Promise<void> {
    if (isRepoWriteBusy(this.dir)) return
    await withRepoWriteLock(this.dir, () => this.refreshStatOnlyNow(paths))
  }

  private async refreshStatOnlyNow(paths: string[]): Promise<void> {
    const expected = new Map<string, { mode: string; oid: string }>()
    for (const line of await this.lsStaged(paths)) {
      const tab = line.indexOf('\t')
      const [mode, oid] = line.slice(0, tab).split(' ')
      expected.set(line.slice(tab + 1), { mode, oid })
    }
    try {
      for (const batch of chunkPaths(paths)) await runGit(this.dir, ['add', '--', ...batch])
    } catch (err) {
      if (isGitError(err)) return
      throw err
    }
    const raced: string[] = []
    for (const line of await this.lsStaged(paths)) {
      const tab = line.indexOf('\t')
      const p = line.slice(tab + 1)
      const e = expected.get(p)
      if (e && line.slice(0, tab).split(' ')[1] !== e.oid) raced.push(`${e.mode},${e.oid},${p}`)
    }
    for (const info of raced) {
      await runGit(this.dir, ['update-index', '--cacheinfo', info]).catch(() => undefined)
    }
  }

  /**
   * GH337 P5 — statut par lots de `prefixes` (ligne de commande bornée) : l'union des lots est le statut
   * demandé ; un fichier qui matche deux préfixes est pris une fois. Sans préfixe : un seul lancement.
   */
  private async statusByBatches(args: string[], prefixes: string[]): Promise<StatusEntry[]> {
    const batches = chunkPaths(prefixes)
    if (batches.length === 1) {
      return parseStatusV2((await this.run(prefixes.length ? [...args, '--', ...batches[0]] : args)).stdout)
    }
    const byPath = new Map<string, StatusEntry>()
    for (const batch of batches) {
      for (const e of parseStatusV2((await this.run([...args, '--', ...batch])).stdout)) {
        if (!byPath.has(e.path)) byPath.set(e.path, e)
      }
    }
    return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  /** `ls-files -s` des chemins, par lots (GH337 P5). */
  private async lsStaged(paths: string[]): Promise<string[]> {
    if (paths.length === 0) return [] // sans chemin, `ls-files` listerait tout l'index
    const lines: string[] = []
    for (const batch of chunkPaths(paths)) {
      for (const line of splitZ((await this.run(['ls-files', '-s', '-z', '--', ...batch])).stdout)) lines.push(line)
    }
    return lines
  }

  /** Chemins dont le contenu filtré (`.gitattributes`) est identique au blob de l'index. */
  private async statOnlyChanges(paths: string[]): Promise<string[]> {
    const staged = await this.lsStaged(paths)
    const indexOid = new Map<string, string>()
    for (const line of staged) {
      const tab = line.indexOf('\t')
      indexOid.set(line.slice(tab + 1), line.slice(0, tab).split(' ')[1])
    }
    const candidates = paths.filter(p => indexOid.has(p) && fs.existsSync(path.join(this.dir, p)))
    if (candidates.length === 0) return []
    const hashes = await this.hashFiles(candidates)
    return candidates.filter((p, i) => hashes[i] === indexOid.get(p))
  }

  /**
   * Oid qu'auraient les fichiers `paths` (relatifs, existants) une fois ajoutés : contenu filtré par
   * `.gitattributes`, rien n'est écrit. Un seul processus, dans l'ordre de `paths`.
   */
  async hashFiles(paths: string[]): Promise<string[]> {
    if (paths.length === 0) return []
    if (paths.some(p => /[\r\n]/.test(p))) throw new GitError('other', ['hash-object'], null, 'chemin avec retour ligne')
    return (await this.text(['hash-object', '--stdin-paths'], { stdin: paths.join('\n') + '\n' })).split('\n').filter(Boolean)
  }

  async checkIgnore(paths: string[]): Promise<Set<string>> {
    if (paths.length === 0) return new Set()
    // `check-ignore` prend des noms de fichiers et refuse `GIT_LITERAL_PATHSPECS` (« pathspec magic not
    // supported by this command: 'literal' »).
    const r = await this.run(['check-ignore', '--stdin', '-z'], {
      stdin: paths.join('\0') + '\0', okExitCodes: [1], env: { extra: { GIT_LITERAL_PATHSPECS: '0' } },
    })
    return new Set(splitZ(r.stdout))
  }

  async lsFiles(prefixes: string[] = []): Promise<string[]> {
    // GH337 P5 — par lots de chemins (ligne de commande bornée) ; sans préfixe, un seul lancement (tout l'index).
    const files: string[] = []
    for (const batch of chunkPaths(prefixes)) {
      for (const f of splitZ((await this.run(['ls-files', '-z', '--', ...batch])).stdout)) files.push(f)
    }
    return [...new Set(files)]
  }

  /**
   * Fins de ligne des fichiers suivis (`ls-files --eol`) : `index` et `worktree` valent `lf`, `crlf`,
   * `mixed`, `none`, `-text` ou `''` (fichier absent du disque). Un seul processus.
   */
  async lsFilesEol(): Promise<{ path: string; index: string; worktree: string }[]> {
    return splitZ((await this.run(['ls-files', '--eol', '-z'])).stdout).map(line => {
      const tab = line.indexOf('\t')
      const [i = '', w = ''] = line.slice(0, tab).trim().split(/\s+/)
      return { path: line.slice(tab + 1), index: i.replace(/^i\//, ''), worktree: w.replace(/^w\//, '') }
    })
  }

  /**
   * Noms des refs sous `prefix` (`refs/heads`, `refs/tags`, `refs/remotes/origin`), préfixe retiré,
   * triés par nom (`for-each-ref`). Une branche distante `HEAD` (symref) figure dans la liste.
   */
  async refNames(prefix: string): Promise<string[]> {
    const base = prefix.replace(/\/+$/, '') + '/'
    return (await this.refs([base])).map(r => r.ref.slice(base.length))
  }

  /**
   * Commits atteignables depuis `rev` qui modifient un chemin sous `paths`, avec ces changements
   * (`--name-status`, sans renommages ; une fusion est comparée à son premier parent ; commit racine
   * ou greffé d'un dépôt superficiel : tous ses fichiers). Pas de simplification d'historique
   * (`--full-history --sparse`) : une fusion identique à l'un de ses parents est quand même examinée.
   * Enfants avant parents (`--topo-order`). `firstParent` : chaîne des premiers parents seulement.
   * `[]` si `rev` est absente ou si `paths` est vide.
   */
  async pathCommits(rev: string, paths: string[], opts: { firstParent?: boolean; stopAt?: string } = {}): Promise<LogEntry[]> {
    if (paths.length === 0) return []
    const args = ['--literal-pathspecs', 'log', '-z', `--format=${LOG_FORMAT}`, '--date=raw', '--full-history', '--sparse',
      '--topo-order', '--name-status', '--no-renames', '--diff-merges=first-parent']
    if (opts.firstParent) args.push('--first-parent')
    // `stopAt` et la chaîne de ses premiers parents sont exclus (git ≥ 2.38) ; absent : ignoré.
    const stop = opts.stopAt ? await this.resolve(opts.stopAt) : null
    if (stop) args.push('--exclude-first-parent-only', `^${stop}`)
    args.push(rev, '--', ...paths.map(p => p.replace(/\/+$/, '')))
    try {
      return parseLog((await this.run(args)).stdout, true).filter(e => e.changes!.length > 0)
    } catch (err) {
      if (isGitError(err, 'not-found') || (isGitError(err) && /does not have any commits/.test(err.stderr))) return []
      throw err
    }
  }

  /**
   * GH340 (design §4) — dates de création / modification de chaque fichier sous `prefixes`, en un seul
   * `git log` sur tous les commits atteignables depuis `rev` : création = plus ancien commit qui touche
   * le fichier, modification = plus récent, par **date de commit** ; auteur = auteur du commit. Les
   * fusions ne comptent que pour un fichier qu'aucun autre commit n'a touché (résolution de conflit).
   * À date égale, le commit le plus loin de `rev` crée, le plus proche modifie. Renommages non suivis.
   */
  async fileHistories(rev: string, prefixes: string[]): Promise<Map<string, PathDates>> {
    const direct = new Map<string, PathDates>()
    const viaMerge = new Map<string, PathDates>()
    // Enfants avant parents : à date égale, le commit vu plus tard est le plus ancien.
    for (const c of await this.pathCommits(rev, prefixes)) {
      const into = c.parents.length > 1 ? viaMerge : direct
      const at = c.committer.timestamp
      const by = c.author.name
      for (const { path: file } of c.changes!) {
        const cur = into.get(file)
        if (!cur) { into.set(file, { created: at, createdBy: by, updated: at, updatedBy: by }); continue }
        if (at <= cur.created) { cur.created = at; cur.createdBy = by }
        if (at > cur.updated) { cur.updated = at; cur.updatedBy = by }
      }
    }
    for (const [file, d] of viaMerge) if (!direct.has(file)) direct.set(file, d)
    return direct
  }

  /**
   * Refs selon les motifs, avec le **commit** visé : la cible elle-même, ou celle d'un tag annoté
   * (déréférencé d'un niveau) ; `null` quand la ref ne vise pas un commit (tag d'un blob ou d'un arbre,
   * tag de tag). Sert à lire le commit d'un tag.
   */
  async refCommits(patterns: string[] = []): Promise<{ ref: string; oid: string; commit: string | null }[]> {
    const fmt = '%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)'
    const out = await this.text(['for-each-ref', `--format=${fmt}`, ...patterns])
    return out.split('\n').filter(Boolean).map(line => {
      const [ref, oid, type, peeled, peeledType] = line.split('\0')
      const commit = type === 'commit' ? oid : peeledType === 'commit' ? peeled : null
      return { ref, oid, commit }
    })
  }

  // ─── Écritures locales ───────────────────────────────────────────────────────

  private w(args: string[], opts: RunOptions = {}) { return this.run(args, { ...opts, write: true }) }

  async init(initialBranch = 'main'): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true })
    await this.w(['init', '-q', '-b', initialBranch])
  }

  async addRemote(name: string, url: string): Promise<void> {
    this.remotesCache = null
    await this.w(['remote', 'add', name, url])
  }

  async removeRemote(name: string): Promise<void> {
    this.remotesCache = null
    await this.w(['remote', 'remove', name])
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    this.remotesCache = null
    await this.w(['remote', 'set-url', name, url])
  }

  async setConfig(key: string, value: string): Promise<void> {
    this.remotesCache = null
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
    // GH337 revue — un chemin non suivi n'est supprimé du disque qu'une fois vérifié comme chemin sûr du dépôt
    // (`..`, absolu, `.git`…) : refus avant toute écriture, git n'est pas appelé.
    const unsafe = notInHead.find(p => !isSafeTreePath(p))
    if (unsafe !== undefined) throw new Error(`Chemin refusé hors du dépôt : ${JSON.stringify(unsafe)}`)
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

  /** Écrit `data` tel quel comme blob (aucun filtre `.gitattributes`) et renvoie son oid. */
  async writeBlob(data: Buffer | string): Promise<string> {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    const oid = await writeLooseObject(this.dir, 'blob', buf)
    if (oid) return oid
    return (await this.text(['hash-object', '-w', '--no-filters', '--stdin'], { stdin: buf })).trim()
  }

  /** Écrit un arbre d'un niveau ; `path` de chaque entrée = son nom dans l'arbre (ordre indifférent). */
  async mktree(entries: TreeEntry[]): Promise<string> {
    const oid = await writeLooseObject(this.dir, 'tree', serializeTree(entries))
    if (oid) return oid
    const stdin = entries.map(e => `${e.mode} ${e.type} ${e.oid}\t${e.path}\0`).join('')
    return (await this.text(['mktree', '-z'], { stdin })).trim()
  }

  /** Pose des entrées d'index (`update-index --index-info`), sans toucher au disque. */
  async setIndexEntries(entries: { mode: string; oid: string; path: string }[]): Promise<void> {
    if (entries.length === 0) return
    const stdin = entries.map(e => `${e.mode} ${e.oid}\t${e.path}\0`).join('')
    await this.w(['update-index', '-z', '--index-info'], { stdin })
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

  /** HEAD devient `refs/heads/<name>` (symbolique), sans toucher à l'index ni au disque ; la branche peut ne pas exister (dépôt vide). */
  async setHeadBranch(name: string): Promise<void> {
    await this.w(['symbolic-ref', 'HEAD', `refs/heads/${name}`])
  }

  /** Détache HEAD sur `oid` (`update-ref --no-deref`), sans toucher à l'index ni au disque ni à la branche courante. */
  async detachHead(oid: string): Promise<void> {
    await this.w(['update-ref', '--no-deref', 'HEAD', oid])
  }

  async tag(name: string, target = 'HEAD'): Promise<void> {
    await this.w(['tag', '--', name, target])
  }

  async annotatedTag(name: string, target: string, message: string, tagger: GitAuthor): Promise<void> {
    await this.w([...commitConfig(tagger), 'tag', '-a', '--no-sign', '--cleanup=whitespace', '-F', '-', '--', name, target], {
      stdin: message, env: { extra: personEnv('COMMITTER', tagger) },
    })
  }

  async deleteTag(name: string): Promise<void> {
    await this.w(['tag', '-d', '--', name])
  }

  /**
   * Checkout : refuse (GitError `local-changes`) plutôt que d'écraser une modification locale.
   * `detach` : tête détachée sur un commit ou un tag.
   * Sous Windows (git ≥ 2.40, `check-attr --source`), les fichiers sont écrits par Polenta
   * (`nodeCheckout`, épargné par Defender, GH337-sprint0.md § Essai) ; `git checkout` hors du chemin
   * simple (modification locale, filtre, sous-module…) et pour `force`.
   */
  async checkout(rev: string, opts: { detach?: boolean; force?: boolean } = {}): Promise<void> {
    if (!opts.force && useNodeCheckout()) {
      if (await nodeCheckout(this.dir, rev, { detach: opts.detach })) return
    }
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

  /** Rebase de la branche courante sur `onto` ; les commits réécrits portent l'identité de Polenta. */
  async rebase(onto: string, author: GitAuthor): Promise<void> {
    await this.w([...commitConfig(author), 'rebase', onto], {
      env: { extra: { ...personEnv('AUTHOR', author), ...personEnv('COMMITTER', author) } },
    })
  }

  async rebaseAbort(): Promise<void> {
    await this.w(['rebase', '--abort'])
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

  /**
   * Fusion de `theirs` dans `ours` (branche ou oid) : déjà fusionné → rien ; avance rapide quand
   * `ours` est un ancêtre ; sinon fusion à trois (base virtuelle récursive de git, GH332) puis commit
   * à deux parents. La ref de `ours` n'avance qu'à la fin (`updateRefs` avec ancienne valeur) ; index
   * et disque ne sont pas touchés : l'appelant réaligne la branche courante (`checkout --force`).
   * Un conflit lève `MergeConflictError` (chemins) et ne modifie rien.
   */
  async mergeBranches(ours: string, theirs: string, opts: {
    author: GitAuthor & { timestamp?: number }; message?: string; fastForwardOnly?: boolean; dryRun?: boolean
  }): Promise<{ oid: string; tree: string; mergeCommit: boolean }> {
    const ourOid = await this.resolveOrThrow(ours)
    const theirOid = await this.resolveOrThrow(theirs)
    const ref = ours.startsWith('refs/') ? ours : `refs/heads/${ours}`
    // Un oid n'a pas de ref à faire avancer : seul un nom de branche (ou ref complète) est mis à jour.
    const canMove = !opts.dryRun && !OID_RE.test(ours)
    if (await this.isAncestor(theirOid, ourOid)) {
      return { oid: ourOid, tree: (await this.readCommit(ourOid))!.tree, mergeCommit: false }
    }
    if (await this.isAncestor(ourOid, theirOid)) {
      if (canMove) await this.updateRefs([{ ref, newOid: theirOid, oldOid: ourOid }])
      return { oid: theirOid, tree: (await this.readCommit(theirOid))!.tree, mergeCommit: false }
    }
    if (opts.fastForwardOnly) {
      throw new GitError('non-fast-forward', ['merge', '--ff-only', theirs], null, 'Not possible to fast-forward, aborting.')
    }
    const merged = await this.mergeTree(ourOid, theirOid)
    if (!merged.clean) throw new MergeConflictError(merged.conflicts)
    if (opts.dryRun) return { oid: '', tree: merged.tree, mergeCommit: true }
    const message = opts.message ?? `Merge branch '${shortRef(theirs)}' into ${shortRef(ours)}`
    const oid = await this.commitTree(merged.tree, [ourOid, theirOid], message, opts.author)
    if (canMove) await this.updateRefs([{ ref, newOid: oid, oldOid: ourOid }])
    return { oid, tree: merged.tree, mergeCommit: true }
  }

  /**
   * Ancêtre commun à afficher dans l'éditeur de fusion (GH37) : l'unique base s'il n'y en a qu'une ;
   * sinon une base virtuelle, pliée deux à deux. Un pli en conflit garde le premier ancêtre
   * (`singleMergeBase` d'avant). `null` si les historiques n'ont rien en commun.
   */
  async displayBase(a: string, b: string): Promise<string | null> {
    const bases = await this.mergeBases(a, b)
    if (bases.length === 0) return null
    if (bases.length === 1) return bases[0]
    let acc = bases[0]
    for (const next of bases.slice(1)) {
      const inner = await this.displayBase(acc, next)
      if (inner === null) continue
      const r = await this.mergeTree(acc, next)
      acc = r.clean ? await this.commitTree(r.tree, [acc, next], 'virtual merge base', VIRTUAL_AUTHOR) : inner
    }
    return acc
  }

  // ─── Réseau ──────────────────────────────────────────────────────────────────

  /** URL de la remote `name`, `null` si elle n'est pas configurée. */
  async remoteUrl(name: string): Promise<string | null> {
    return (await this.remotes()).find(r => r.name === name)?.url ?? null
  }

  /**
   * `fetch` de tous les tags (GH268) ; un tag local déjà présent n'est pas écrasé (git le refuse :
   * seul ce refus est ignoré, le reste du fetch est fait). `url` : remote non configurée (repli de
   * `urlFallback`), avec les branches suivies dans `refs/remotes/<remote>/*`.
   */
  async fetch(remote: string, opts: NetworkOptions & { prune?: boolean; refspecs?: string[]; url?: string } = {}): Promise<void> {
    const url = opts.url ?? await this.remoteUrl(remote)
    const args = opts.url
      ? ['fetch', '--tags', opts.url, `+refs/heads/*:refs/remotes/${remote}/*`]
      : ['fetch', '--tags', ...(opts.prune ? ['--prune'] : []), remote, ...(opts.refspecs ?? [])]
    // GH337 P6 — pas de file d'écriture : le réseau ne doit pas figer les commits locaux (file dédiée aux fetch).
    try {
      await withRepoFetchLock(this.dir, () => netRun(this.dir, url, args, opts, false))
    } catch (err) {
      if (!(isGitError(err) && /would clobber existing tag/.test(err.stderr))) throw err
    }
  }

  /** Pousse `refspecs` (`src:dst`, ou `:dst` pour supprimer). Le classement des refus lit le stderr. */
  async push(remote: string, refspecs: string[], opts: NetworkOptions & { force?: boolean } = {}): Promise<void> {
    const url = await this.remoteUrl(remote)
    await netRun(this.dir, url, ['push', ...(opts.force ? ['--force'] : []), remote, ...refspecs], opts, true)
  }

  /** Arrête les processus persistants du dépôt et attend leur fin (avant suppression ou renommage du dossier). */
  close(): Promise<void> {
    return closeRepo(this.dir)
  }
}

/** Schémas de remote acceptés ; tout autre schéma est refusé avant de lancer git. */
const REMOTE_SCHEMES = new Set(['https', 'http', 'ssh', 'file'])

/**
 * GH337 — garde des URL de remote avant tout processus git. La garde du serveur web (`checkRemote`)
 * ne voit que les URL à schéma : on ramène chaque forme à une URL qu'elle sait évaluer.
 * - `transport::commande` (helper git, ex. `ext::`) : refusé dans tous les cas, sans lancer git ;
 * - `schéma://` hors https, http, ssh, file : refusé ;
 * - `[user@]hôte:chemin` (scp) : contrôlé comme `ssh://hôte/` (même garde d'hôte que ssh) ; hôte commençant
 *   par `-` refusé (option ssh injectée) ;
 * - tout autre valeur (chemin local, `C:\…`) : contrôlé comme `file://`.
 */
export function checkRemoteUrl(url: string): void {
  if (/^[^/\\]*::/.test(url)) throw new Error('Transport git refusé (forme transport::commande)')
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)
  if (scheme) {
    if (!REMOTE_SCHEMES.has(scheme[1].toLowerCase())) throw new Error(`Schéma de remote refusé : ${scheme[1]}://`)
    checkRemote(url)
    return
  }
  const colon = url.indexOf(':')
  const slash = url.search(/[/\\]/)
  const isDrive = /^[a-z]:[\\/]/i.test(url)
  if (!isDrive && colon > 0 && (slash === -1 || colon < slash)) {
    const host = url.slice(0, colon)
    const hostPart = host.slice(host.lastIndexOf('@') + 1)
    if (!hostPart || hostPart.startsWith('-')) throw new Error('Hôte de remote refusé')
    checkRemote(new URL(`ssh://${host}/`))
    return
  }
  checkRemote(pathToFileURL(path.resolve(url)))
}

/**
 * SSH sans invite (`BatchMode`) : `ssh` est celui de Git for Windows, en tête du PATH (gitEnv), comme
 * la commande de `git` lui-même (design §6). Le délai de connexion suit le réglage GH15.
 */
function sshCommand(): string {
  const seconds = Math.max(1, Math.round(scaledTimeout(CONNECT_TIMEOUT_BASE_MS) / 1000))
  return `ssh -o BatchMode=yes -o ConnectTimeout=${seconds}`
}

/**
 * Opération réseau de git (design §4) : garde du serveur web (GH44) sur l'URL, proxy résolu par
 * Chromium quand il n'est pas dans l'environnement, identifiants par jeton askpass (§6), délai GH15.
 */
export async function netRun(
  cwd: string, url: string | null, args: string[], opts: NetworkOptions, write: boolean,
): Promise<RunResult> {
  if (url) checkRemoteUrl(url)
  const config: string[] = []
  if (url && /^https?:\/\//i.test(url)) {
    const proxy = await resolveProxyUrl(url)
    if (proxy) config.push('-c', `http.proxy=${proxy}`)
  }
  const session = await openAskpassSession(opts.credentials ?? (async () => null))
  try {
    return await runGit(cwd, [...config, ...args], {
      write,
      timeoutMs: opts.timeoutMs ?? scaledTimeout(GIT_IO_TIMEOUT_BASE_MS),
      onStderrLine: opts.onProgress,
      signal: opts.signal,
      env: { extra: { ...session.env, GIT_SSH_COMMAND: sshCommand() } },
    })
  } finally {
    session.revoke()
  }
}

/** Clone (hors d'un dépôt existant). Progression de git sur `onProgress` (`Receiving objects: 45%`). */
export async function gitClone(url: string, dest: string, opts: NetworkOptions & { branch?: string; depth?: number; noTags?: boolean } = {}): Promise<void> {
  const parent = path.dirname(path.resolve(dest))
  fs.mkdirSync(parent, { recursive: true })
  const args = ['clone', '--progress', '--no-hardlinks']
  if (opts.noTags) args.push('--no-tags')
  if (opts.branch) args.push('--branch', opts.branch, '--single-branch')
  if (opts.depth) args.push('--depth', String(opts.depth))
  args.push('--', url, path.resolve(dest))
  await netRun(parent, url, args, opts, true)
}

/** Branches du remote (`refs/heads/*`), sans clone. */
export async function gitLsRemoteHeads(url: string, opts: NetworkOptions = {}): Promise<string[]> {
  return [...(await gitLsRemoteHeadOids(url, opts)).keys()]
}

/** Têtes des branches du remote : nom (sans `refs/heads/`) → oid. Sert aux contrôles de push (smoke). */
export async function gitLsRemoteHeadOids(url: string, opts: NetworkOptions = {}): Promise<Map<string, string>> {
  const out = await netRun(os.tmpdir(), url, ['ls-remote', '--heads', '--', url], opts, false)
  const heads = new Map<string, string>()
  for (const line of out.stdout.toString('utf8').split('\n').filter(Boolean)) {
    const [oid, ref] = line.split('\t')
    heads.set(ref.replace(/^refs\/heads\//, ''), oid)
  }
  return heads
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
