import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { gitInstall } from './git-binary'
import { gitEnv } from './git-config'
import { GitError } from './git-errors'
import { countGitSpawn, gitText, repoKey } from './git-runner'
import { killTree, onRepoClose, track } from './process-registry'

/**
 * GH337 — `git cat-file --batch-command`, un processus persistant par dépôt (design §3.1).
 * Lecture d'objets et résolution de révisions sans payer ~35 ms de lancement par appel (mesure
 * Windows, commentaire de l'issue du 2026-11-10). Requêtes traitées une à une ; relance d'un
 * processus mort avec rejeu de la requête en cours (une fois) ; arrêt après inactivité.
 */

export interface ObjectInfo { oid: string; type: 'blob' | 'tree' | 'commit' | 'tag'; size: number }
export interface ObjectData extends ObjectInfo { data: Buffer }

interface Request {
  cmd: 'info' | 'contents'
  rev: string
  resolve: (v: ObjectInfo | ObjectData | null) => void
  reject: (e: Error) => void
  attempts: number
}

const IDLE_MS = 60_000

/**
 * Dossier git de `repo` : `.git` (dossier, ou fichier `gitdir:` d'un worktree), ou `repo` lui-même
 * pour un dépôt nu. `null` si `repo` n'est pas la racine d'un dépôt (git cherchera alors vers le haut
 * depuis `repo`).
 */
export function resolveGitDir(repo: string): string | null {
  const dotGit = path.join(repo, '.git')
  try {
    const st = fs.statSync(dotGit)
    if (st.isDirectory()) return dotGit
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'))
    return m ? path.resolve(repo, m[1]) : null
  } catch { /* pas de .git */ }
  try {
    if (fs.statSync(path.join(repo, 'objects')).isDirectory() && fs.existsSync(path.join(repo, 'HEAD'))) return repo
  } catch { /* pas un dépôt nu */ }
  return null
}

/** Fin de stdin : cat-file s'arrête de lui-même ; arrêt forcé s'il traîne. */
function stopGracefully(child: ChildProcessWithoutNullStreams): void {
  child.stdin.end()
  const t = setTimeout(() => killTree(child), 2000)
  t.unref?.()
  child.once('exit', () => clearTimeout(t))
}

class CatFileBatch {
  private child: ChildProcessWithoutNullStreams | null = null
  private queue: Request[] = []
  private current: Request | null = null
  private buf: Buffer = Buffer.alloc(0)
  private header: ObjectInfo | null = null
  private idle: NodeJS.Timeout | null = null
  private closed = false
  private readonly unregister: () => void

  constructor(private readonly repo: string, private readonly onClosed: () => void) {
    this.unregister = onRepoClose(repo, () => this.close())
  }

  request(cmd: 'info' | 'contents', rev: string): Promise<ObjectInfo | ObjectData | null> {
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, rev, resolve, reject, attempts: 0 })
      this.pump()
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.unregister()
    if (this.idle) clearTimeout(this.idle)
    const pending = [...(this.current ? [this.current] : []), ...this.queue]
    this.current = null
    this.queue = []
    if (this.child) {
      stopGracefully(this.child)
      this.child = null
    }
    for (const r of pending) r.reject(new GitError('other', ['cat-file'], null, 'dépôt fermé'))
    this.onClosed()
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    // Hors du dossier du dépôt : sous Windows, le dossier courant d'un processus vivant ne peut pas
    // être supprimé (EBUSY/EPERM au retrait d'un dépôt, pendant les 60 s d'inactivité). Les packs
    // ouverts, eux, n'empêchent pas la suppression (Git for Windows ouvre en partage de suppression).
    const gitDir = resolveGitDir(this.repo)
    countGitSpawn('cat-file(persistant)')
    const child = spawn(gitInstall().gitExe, [...(gitDir ? [`--git-dir=${gitDir}`] : []), 'cat-file', '--batch-command'], {
      cwd: gitDir ? os.tmpdir() : this.repo, env: gitEnv({ readOnly: true }), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    track(child, this.repo, true)
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-4000) })
    child.stdout.on('data', (d: Buffer) => this.onData(d))
    child.stdin.on('error', () => { /* géré par exit */ })
    const onGone = (): void => {
      if (this.child !== child) return
      this.child = null
      this.buf = Buffer.alloc(0)
      this.header = null
      const req = this.current
      this.current = null
      if (req) {
        if (req.attempts < 2 && !this.closed) this.queue.unshift(req)
        else req.reject(new GitError('other', ['cat-file', '--batch-command'], child.exitCode, stderr || 'cat-file arrêté'))
      }
      if (!this.closed) this.pump()
    }
    child.on('exit', onGone)
    child.on('error', onGone)
    this.child = child
    return child
  }

  private pump(): void {
    if (this.closed || this.current || this.queue.length === 0) {
      if (!this.current && this.queue.length === 0) this.armIdle()
      return
    }
    if (this.idle) { clearTimeout(this.idle); this.idle = null }
    const req = this.queue.shift()!
    req.attempts++
    this.current = req
    try {
      this.ensureChild().stdin.write(`${req.cmd} ${req.rev}\n`)
    } catch (e) {
      this.current = null
      req.reject(e as Error)
      this.pump()
    }
  }

  private armIdle(): void {
    if (this.idle || !this.child) return
    this.idle = setTimeout(() => {
      this.idle = null
      if (!this.current && this.queue.length === 0 && this.child) {
        const c = this.child
        this.child = null
        stopGracefully(c)
      }
    }, IDLE_MS)
    this.idle.unref?.()
  }

  private onData(d: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d
    for (;;) {
      const req = this.current
      if (!req) return
      if (!this.header) {
        const nl = this.buf.indexOf(0x0a)
        if (nl < 0) return
        const line = this.buf.subarray(0, nl).toString('utf8')
        this.buf = this.buf.subarray(nl + 1)
        if (line.endsWith(' missing') || line.endsWith(' ambiguous')) {
          this.finish(null)
          continue
        }
        const [oid, type, size] = line.split(' ')
        const info: ObjectInfo = { oid, type: type as ObjectInfo['type'], size: Number(size) }
        if (req.cmd === 'info') {
          this.finish(info)
          continue
        }
        this.header = info
      }
      const need = this.header.size + 1 // contenu + saut de ligne final
      if (this.buf.length < need) return
      const data = Buffer.from(this.buf.subarray(0, this.header.size))
      this.buf = this.buf.subarray(need)
      const h = this.header
      this.header = null
      this.finish({ ...h, data })
    }
  }

  private finish(v: ObjectInfo | ObjectData | null): void {
    const req = this.current!
    this.current = null
    req.resolve(v)
    this.pump()
  }
}

const batches = new Map<string, CatFileBatch>()

function batchFor(repo: string): CatFileBatch {
  const key = repoKey(repo)
  let b = batches.get(key)
  if (!b) {
    b = new CatFileBatch(repo, () => { if (batches.get(key) === b) batches.delete(key) })
    batches.set(key, b)
  }
  return b
}

/** Une révision avec un retour ligne ne passe pas par le protocole ligne à ligne. */
function needsOneShot(rev: string): boolean {
  return /[\r\n]/.test(rev)
}

/** `oid`, type et taille de `rev` (oid, ref, `rev:chemin`, `rev^{tree}`…), `null` si absent. */
export async function objectInfo(repo: string, rev: string): Promise<ObjectInfo | null> {
  if (needsOneShot(rev)) {
    try {
      const out = (await gitText(repo, ['cat-file', '--batch-check'], { stdin: rev + '\n' })).trim()
      if (out.endsWith('missing') || out.endsWith('ambiguous')) return null
      const [oid, type, size] = out.split(' ')
      return { oid, type: type as ObjectInfo['type'], size: Number(size) }
    } catch { return null }
  }
  return (await batchFor(repo).request('info', rev)) as ObjectInfo | null
}

/** Contenu de `rev`, `null` si absent. */
export async function objectData(repo: string, rev: string): Promise<ObjectData | null> {
  if (needsOneShot(rev)) return null
  return (await batchFor(repo).request('contents', rev)) as ObjectData | null
}
