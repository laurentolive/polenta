import { spawn } from 'child_process'

import { gitInstall } from './git-binary'
import { gitEnv, type GitEnvOptions } from './git-config'
import { classifyGitError, GitError } from './git-errors'
import { killTree, repoKey, track } from './process-registry'

/**
 * GH337 — exécution des processus git ponctuels (design §3) : sans shell, fenêtre cachée, sortie
 * binaire, écritures mises en file par dépôt (remplace `git-lock-limits`, GH335/GH336).
 */

export interface RunOptions {
  /** Entrée standard (texte UTF-8 ou binaire). */
  stdin?: string | Buffer
  /** Prend `index.lock` ou écrit des refs : sérialisé avec les autres écritures du dépôt. */
  write?: boolean
  /** Délai au-delà duquel l'arbre de processus est arrêté (`GitError timeout`). */
  timeoutMs?: number
  /** Codes de sortie qui ne sont pas des erreurs (ex. 1 pour `merge-tree` en conflit). */
  okExitCodes?: number[]
  env?: GitEnvOptions
  /** Ligne de stderr reçue au fil de l'eau (progression du clone). */
  onStderrLine?: (line: string) => void
  signal?: AbortSignal
}

export interface RunResult {
  stdout: Buffer
  stderr: string
  exitCode: number
}

const writeQueues = new Map<string, Promise<unknown>>()

export { repoKey }

/** Sérialise `fn` derrière les écritures en cours sur `repo`. */
export function withRepoWriteLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const key = repoKey(repo)
  const prev = writeQueues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  const tail = next.catch(() => undefined)
  writeQueues.set(key, tail)
  void tail.then(() => { if (writeQueues.get(key) === tail) writeQueues.delete(key) })
  return next
}

/** Lance `git <args>` dans `cwd` (dossier du dépôt, ou dossier quelconque pour clone/ls-remote). */
export function runGit(cwd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const exec = (): Promise<RunResult> => spawnGit(cwd, args, opts)
  return opts.write ? withRepoWriteLock(cwd, exec) : exec()
}

/** Raccourci : sortie standard en texte UTF-8. */
export async function gitText(cwd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return (await runGit(cwd, args, opts)).stdout.toString('utf8')
}

function spawnGit(cwd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const { gitExe } = gitInstall()
  const env = gitEnv({ readOnly: !opts.write, ...opts.env })
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(gitExe, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    track(child, cwd)
    const out: Buffer[] = []
    const err: Buffer[] = []
    let errLine = ''
    let timedOut = false
    let settled = false
    const timer = opts.timeoutMs
      ? setTimeout(() => { timedOut = true; killTree(child) }, opts.timeoutMs)
      : null
    const onAbort = (): void => killTree(child)
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const done = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => {
      err.push(d)
      if (opts.onStderrLine) {
        errLine += d.toString('utf8')
        const parts = errLine.split(/[\r\n]/)
        errLine = parts.pop() ?? ''
        for (const l of parts) if (l) opts.onStderrLine(l)
      }
    })
    child.on('error', e => done(() => reject(new GitError('other', args, null, e.message, (e as NodeJS.ErrnoException).code))))
    child.on('close', code => done(() => {
      const stderr = Buffer.concat(err).toString('utf8')
      const exitCode = code ?? -1
      if (timedOut) return reject(new GitError('timeout', args, exitCode, stderr, 'ETIMEDOUT'))
      if (exitCode !== 0 && !(opts.okExitCodes ?? []).includes(exitCode)) {
        return reject(new GitError(classifyGitError(stderr), args, exitCode, stderr))
      }
      resolve({ stdout: Buffer.concat(out), stderr, exitCode })
    }))
    child.stdin.on('error', () => { /* processus terminé avant la fin de l'écriture : l'erreur vient par close */ })
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin)
    else child.stdin.end()
  })
}

/** Découpe une sortie `-z`. */
export function splitZ(buf: Buffer | string): string[] {
  const s = typeof buf === 'string' ? buf : buf.toString('utf8')
  const parts = s.split('\0')
  if (parts.length && parts[parts.length - 1] === '') parts.pop()
  return parts
}
