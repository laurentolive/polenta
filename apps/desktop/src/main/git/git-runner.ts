import { execFile, spawn } from 'child_process'
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
 * depuis plus de 10 s : processus git (pid, appelant dans le code, temps CPU et état des threads
 * Windows), file d'écriture, requête cat-file. Une commande git de plus de 5 s est consignée à sa
 * fin, avec le délai entre la fin de git et la fermeture de ses tuyaux. C'est ce journal qui a montré
 * les tuyaux hérités entre threads de test (cat-file-batch.ts, IDLE_MS).
 */
interface PendingEntry { what: () => string; since: number; pid?: () => number | undefined; inspecting: boolean }
const pending = new Map<number, PendingEntry>()
let pendingSeq = 0
const hangLog = process.env.POLENTA_GIT_HANG_LOG
const stamp = (): string => new Date().toISOString()

/** Premier appelant hors de `git/` (services, tests) : ` appelé depuis fichier:ligne`. */
function callerSite(): string {
  const caller = (new Error().stack ?? '').split('\n').slice(2)
    .find(l => !/[\\/]git[\\/](git-|cat-file|node-checkout)/.test(l) && /\.ts:\d+/.test(l))
  const where = caller?.match(/([\w.-]+\.ts):(\d+)/)
  return where ? ` appelé depuis ${where[1]}:${where[2]}` : ''
}

/** État Windows d'un processus : temps CPU et état de chaque thread (diagnostic seul). */
function snapshotProcess(pid: number): Promise<string> {
  const script = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (-not $p) { 'absent' } else { 'cpu=' + [math]::Round($p.CPU, 2) + ' threads=' + (($p.Threads | ForEach-Object { $_.ThreadState.ToString() + '/' + $_.WaitReason.ToString() }) -join ' ') }`
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15_000 },
      (err, stdout) => resolve(err ? `indisponible (${err.message.split('\n')[0].slice(0, 100)})` : String(stdout).trim()))
  })
}

if (hangLog) {
  setInterval(() => {
    const now = Date.now()
    for (const p of pending.values()) {
      const age = now - p.since
      if (age <= 10_000) continue
      const pid = p.pid?.()
      appendFileSync(hangLog, `${stamp()} ${Math.round(age / 1000)}s ${p.what()}\n`)
      if (pid && !p.inspecting) {
        p.inspecting = true
        void snapshotProcess(pid).then(s => {
          appendFileSync(hangLog, `${stamp()}   pid=${pid} : ${s}\n`)
          p.inspecting = false
        })
      }
    }
  }, 5000).unref()
}

/** Commande git lente : consignée à sa fin (durée totale et délai fin de git → fermeture des tuyaux). */
function logSlowExit(label: string, pid: number | undefined, spawnedAt: number, exitedAt: number, code: number | null): void {
  if (!hangLog) return
  const total = Date.now() - spawnedAt
  if (total > 5_000) {
    appendFileSync(hangLog, `${stamp()} LENT ${total} ms, code ${code}, pid=${pid}, fermeture ${exitedAt ? Date.now() - exitedAt : '?'} ms après la fin de git : ${label}\n`)
  }
}

export function trackPending(what: string | (() => string), pid?: () => number | undefined): () => void {
  if (!hangLog) return () => undefined
  const id = ++pendingSeq
  pending.set(id, { what: typeof what === 'string' ? () => what : what, since: Date.now(), pid, inspecting: false })
  return () => { pending.delete(id) }
}

/** Délai après la fin de git au-delà duquel ses tuyaux, tenus par un autre processus, sont fermés. */
const EXIT_DRAIN_MS = 500

function spawnGit(cwd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  countGitSpawn(args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-c') ?? '?')
  const label = `processus git ${args.join(' ').slice(0, 120)} (${cwd})${hangLog ? callerSite() : ''}`
  let pid: number | undefined
  let untrack = trackPending(() => `${label}${pid ? ` pid=${pid}` : ''}`, () => pid)
  const spawnedAt = Date.now()
  let exitedAt = 0
  const { gitExe } = gitInstall()
  const env = gitEnv({ readOnly: !opts.write, ...opts.env })
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(gitExe, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...groupSpawnOptions() })
    track(child, cwd)
    pid = child.pid
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
    //
    // GH337 P7 — risque accepté par l'humain (décision du 2026-11-19) : si les tuyaux ne sont pas vidés
    // dans les 500 ms après la fin de git, la sortie (`stdout`/`stderr`) est PARTIELLE et l'appel se
    // résout quand même. Le vidage n'est pas changé. Cause : héritage des tuyaux par un autre processus
    // sous Windows (tasks/lessons.md, 2026-11-18). À réouvrir si un bug de données tronquées est observé.
    child.on('exit', code => {
      exitedAt = Date.now()
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
      logSlowExit(label, pid, spawnedAt, exitedAt, code)
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
