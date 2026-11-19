import { spawn } from 'child_process'
import { appendFileSync } from 'fs'

import { gitInstall } from './git-binary'
import { gitEnv, type GitEnvOptions } from './git-config'
import { classifyGitError, GitError } from './git-errors'
import { groupSpawnOptions, killTree, repoKey, track } from './process-registry'

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

/** Une écriture de Polenta est en cours ou en file sur `repo`. */
export function isRepoWriteBusy(repo: string): boolean {
  return writeQueues.has(repoKey(repo))
}

/** Sérialise `fn` derrière les écritures en cours sur `repo`. */
export function withRepoWriteLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const key = repoKey(repo)
  const prev = writeQueues.get(key) ?? Promise.resolve()
  const who = hangLog ? (new Error().stack ?? '').split('\n').slice(2, 6).map(l => l.trim()).join(' < ') : ''
  const untrackWait = trackPending(`file d'écriture, en attente : ${who}`)
  const run = async (): Promise<T> => {
    untrackWait()
    const untrackRun = trackPending(`file d'écriture, en cours : ${who}`)
    try { return await fn() } finally { untrackRun() }
  }
  const next = prev.then(run, run)
  const tail = next.catch(() => undefined)
  writeQueues.set(key, tail)
  void tail.then(() => { if (writeQueues.get(key) === tail) writeQueues.delete(key) })
  return next
}

/**
 * GH337 P6 — file des fetch d'un dépôt, distincte de la file d'écriture : un fetch réseau (300 s × délai
 * GH15) ne bloque pas les commits ni le statut locaux. Les fetch restent sérialisés entre eux (ils écrivent
 * les refs de suivi `refs/remotes/*` et les tags).
 */
const fetchQueues = new Map<string, Promise<unknown>>()

export function withRepoFetchLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const key = repoKey(repo)
  const prev = fetchQueues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  const tail = next.catch(() => undefined)
  fetchQueues.set(key, tail)
  void tail.then(() => { if (fetchQueues.get(key) === tail) fetchQueues.delete(key) })
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

/**
 * Nombre de processus lancés par sous-commande (mesures : chaque lancement coûte ~50 à 140 ms sous
 * Windows). `POLENTA_GIT_SPAWN_STATS=<fichier>` y ajoute une ligne par lancement (sous-commande).
 */
export const gitSpawnStats = new Map<string, number>()
const statsFile = process.env.POLENTA_GIT_SPAWN_STATS

/** Compte un lancement de git (ponctuel ici, persistant dans `cat-file-batch`). */
export function countGitSpawn(sub: string): void {
  gitSpawnStats.set(sub, (gitSpawnStats.get(sub) ?? 0) + 1)
  if (statsFile) {
    // Premier appelant hors de `git/` (services, tests) : qui lance quoi.
    const caller = (new Error().stack ?? '').split('\n').slice(2)
      .find(l => !/[\\/]git[\\/](git-|cat-file|node-checkout)/.test(l) && /\.ts:\d+/.test(l))
    const where = caller?.match(/([\w.-]+\.ts):(\d+)/)
    appendFileSync(statsFile, `${sub}\t${where ? `${where[1]}:${where[2]}` : '?'}\n`)
  }
}

/**
 * Diagnostic des blocages : `POLENTA_GIT_HANG_LOG=<fichier>` y écrit, toutes les 5 s, ce qui attend
 * depuis plus de 10 s (processus, file d'écriture, requête cat-file). C'est ce journal qui a montré
 * les tuyaux hérités entre threads de test (cat-file-batch.ts, IDLE_MS).
 */
const pending = new Map<number, { what: string; since: number }>()
let pendingSeq = 0
const hangLog = process.env.POLENTA_GIT_HANG_LOG
if (hangLog) {
  setInterval(() => {
    const now = Date.now()
    const old = [...pending.values()].filter(p => now - p.since > 10_000)
    if (old.length) appendFileSync(hangLog, old.map(p => `${Math.round((now - p.since) / 1000)}s ${p.what}\n`).join(''))
  }, 5000).unref()
}
export function trackPending(what: string): () => void {
  if (!hangLog) return () => undefined
  const id = ++pendingSeq
  pending.set(id, { what, since: Date.now() })
  return () => { pending.delete(id) }
}

/** Délai après la fin de git au-delà duquel ses tuyaux, tenus par un autre processus, sont fermés. */
const EXIT_DRAIN_MS = 500

function spawnGit(cwd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  countGitSpawn(args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-c') ?? '?')
  const label = `processus git ${args.join(' ').slice(0, 120)} (${cwd})`
  let untrack = trackPending(label)
  const { gitExe } = gitInstall()
  const env = gitEnv({ readOnly: !opts.write, ...opts.env })
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(gitExe, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...groupSpawnOptions() })
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
      untrack()
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    // Sous Windows, un processus lancé au même instant par un autre thread (fichiers de test vitest :
    // cat-file, serveur MCP, terminal…) hérite de nos tuyaux et les garde ouverts tant qu'il vit : git
    // a fini, mais la fin de sa sortie n'arrive pas (vu : 14 à 50 s). Ce qu'il a écrit est déjà lu peu
    // après sa fin : passé ce délai, les tuyaux sont fermés de notre côté, ce qui termine l'appel.
    child.on('exit', code => {
      if (settled) return
      const drain = setTimeout(() => {
        if (settled) return
        child.stdout.destroy()
        child.stderr.destroy()
      }, EXIT_DRAIN_MS)
      drain.unref?.()
      if (!hangLog) return
      untrack()
      untrack = trackPending(`${label} — terminé (code ${code}), sorties encore ouvertes`)
    })
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
