/**
 * GH63 — exécution des scripts du kit (design §5.4, §5.5).
 *
 * Un travail = un processus détaché (son propre groupe), qui survit à un redémarrage du service :
 *   bash -c <enveloppe fixe> <script> <argv…>
 * L'enveloppe (texte constant, aucun paramètre interpolé) lance le script, relaie SIGTERM
 * (annulation) et écrit son code de sortie dans `exit.code`. stdout/stderr vont dans `out.raw` /
 * `err.raw` (0600, dossier du travail), relayés ligne à ligne, filtrés, vers `log.ndjson` puis
 * supprimés ; le résultat JSON arrive par `POLENTA_RESULT_FILE` (équivalent fichier du fd 3).
 * Au démarrage, un travail `running` dont le processus a disparu, ou d'un autre `boot_id`, passe à
 * `interrupted`.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { JobState } from '@polenta/types'
import { redact } from '../secrets/redact'
import type { JobRecord, JobStore } from './store'
import { writeAtomic } from './store'

const WRAPPER = [
  'script="$0"',
  'bash "$script" "$@" &',
  'child=$!',
  "trap 'kill -TERM \"$child\" 2>/dev/null' TERM",
  'while :; do wait "$child"; rc=$?; kill -0 "$child" 2>/dev/null || break; done',
  'printf "%s" "$rc" > "$POLENTA_JOB_DIR/exit.code.tmp" && mv "$POLENTA_JOB_DIR/exit.code.tmp" "$POLENTA_JOB_DIR/exit.code"',
  'exit "$rc"',
].join('\n')

/** Causes des codes de sortie du kit (design §5.5). */
export const EXIT_CAUSES: Record<number, string> = {
  1: 'general',
  2: 'usage',
  3: 'confirmation',
  4: 'permission',
  5: 'locked',
  6: 'precondition',
  10: 'cancelled',
  12: 'instance-not-found',
  13: 'instance-exists',
  14: 'version-not-found',
  15: 'dns',
  16: 's3',
  17: 'rolled-back',
  18: 'operations-instance',
  19: 'backup-check',
}

export function stateForExit(code: number): JobState {
  if (code === 0) return 'succeeded'
  if (code === 17 || code === 19) return 'rolled-back'
  if (code === 10) return 'cancelled'
  return 'failed'
}

export function bootId(): string {
  try {
    return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
  } catch {
    return `nolinux-${os.hostname()}`
  }
}

/** Heure de démarrage d'un processus (Linux), pour ne pas confondre un pid réutilisé. */
export function procStart(pid: number): string | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
  } catch {
    return undefined
  }
}

function alive(pid: number | undefined, start: string | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  return start === undefined || procStart(pid) === start
}

export interface RunnerOptions {
  kitDir: string
  root: string
  /** Appelé à la fin d'un travail (audit, libération du créneau). */
  onFinish: (job: JobRecord) => void
  pollMs?: number
  /** Valeurs à masquer en plus des motifs (jetons connus du service). */
  secretValues?: () => string[]
}

export interface StartArgs {
  script: 'host' | 'admin'
  argv: string[]
  actor: string
  oneTime?: string[][]
}

export class JobRunner {
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly partial = new Map<string, { out: string; err: string }>()

  constructor(
    private readonly store: JobStore,
    private readonly opts: RunnerOptions,
  ) {}

  scriptPath(script: 'host' | 'admin'): string {
    return path.join(this.opts.kitDir, script === 'host' ? 'polenta-host.sh' : 'polenta-admin.sh')
  }

  scriptEnv(actor: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      PATH: process.env.PATH,
      HOME: process.env.HOME || '/tmp',
      LANG: process.env.LANG || 'C.UTF-8',
      DOCKER_HOST: process.env.DOCKER_HOST,
      POLENTA_ROOT: this.opts.root,
      POLENTA_ADMIN_MODE: '1',
      POLENTA_ORIGIN: 'ui',
      POLENTA_ACTOR: actor,
      ...extra,
    }
  }

  start(job: JobRecord, args: StartArgs): void {
    const dir = this.store.jobDir(job.id)
    const out = fs.openSync(path.join(dir, 'out.raw'), 'a', 0o600)
    const err = fs.openSync(path.join(dir, 'err.raw'), 'a', 0o600)
    const child = spawn(
      'bash',
      ['-c', WRAPPER, this.scriptPath(args.script), ...args.argv, '--json', '--non-interactive'],
      {
        detached: true,
        stdio: ['ignore', out, err],
        env: this.scriptEnv(args.actor, {
          POLENTA_JOB_DIR: dir,
          POLENTA_JOB_ID: job.id,
          POLENTA_RESULT_FILE: path.join(dir, 'result.raw.json'),
        }),
      },
    )
    fs.closeSync(out)
    fs.closeSync(err)
    child.unref()
    child.on('error', () => {
      writeAtomic(path.join(dir, 'exit.code'), '127')
    })
    job.pid = child.pid
    job.procStart = child.pid ? procStart(child.pid) : undefined
    job.bootId = bootId()
    job.state = 'running'
    job.startedAt = new Date().toISOString()
    job.rawOffsets = { out: 0, err: 0 }
    if (job.steps[0]) job.steps[0].state = 'running'
    this.store.save(job)
    this.follow(job.id, args.oneTime)
  }

  /** Reprise au démarrage du service (design §5.4). */
  recover(oneTimeFor: (job: JobRecord) => string[][] | undefined): void {
    const boot = bootId()
    for (const job of this.store.list()) {
      if (job.state !== 'running' && job.state !== 'queued') continue
      const done = fs.existsSync(path.join(this.store.jobDir(job.id), 'exit.code'))
      if (job.state === 'running' && (done || (job.bootId === boot && alive(job.pid, job.procStart)))) {
        this.follow(job.id, oneTimeFor(job))
        continue
      }
      this.pump(job)
      job.state = 'interrupted'
      job.endedAt = new Date().toISOString()
      job.cancellable = false
      job.error = { code: -1, cause: 'interrupted', message: 'travail interrompu (service ou hôte redémarré)' }
      this.store.save(job)
      this.cleanupRaw(job.id)
      this.opts.onFinish(job)
    }
  }

  cancel(job: JobRecord): boolean {
    if (job.state !== 'running' || !job.cancellable || !alive(job.pid, job.procStart)) return false
    try {
      process.kill(job.pid!, 'SIGTERM')
      return true
    } catch {
      return false
    }
  }

  running(id: string): boolean {
    return this.timers.has(id)
  }

  stopAll(): void {
    for (const t of this.timers.values()) clearInterval(t)
    this.timers.clear()
  }

  private follow(id: string, oneTime: string[][] | undefined): void {
    const tick = () => {
      const job = this.store.get(id)
      if (!job) return this.unfollow(id)
      this.pump(job)
      const exitFile = path.join(this.store.jobDir(id), 'exit.code')
      let code: number | null = null
      if (fs.existsSync(exitFile)) code = Number(fs.readFileSync(exitFile, 'utf8').trim() || 1)
      else if (!alive(job.pid, job.procStart)) code = -1
      if (code === null) return this.store.save(job)
      this.unfollow(id)
      this.pump(job, true)
      this.finish(job, code, oneTime)
    }
    this.timers.set(id, setInterval(tick, this.opts.pollMs ?? 300))
  }

  private unfollow(id: string): void {
    const t = this.timers.get(id)
    if (t) clearInterval(t)
    this.timers.delete(id)
  }

  /** Relaie les nouvelles lignes des sorties brutes vers le journal filtré. */
  private pump(job: JobRecord, flush = false): void {
    const dir = this.store.jobDir(job.id)
    const offsets = job.rawOffsets ?? { out: 0, err: 0 }
    const buf = this.partial.get(job.id) ?? { out: '', err: '' }
    const secrets = this.opts.secretValues?.() ?? []
    for (const s of ['out', 'err'] as const) {
      const file = path.join(dir, `${s}.raw`)
      let chunk = ''
      try {
        const fd = fs.openSync(file, 'r')
        try {
          const size = fs.fstatSync(fd).size
          if (size > offsets[s]) {
            const b = Buffer.alloc(size - offsets[s])
            fs.readSync(fd, b, 0, b.length, offsets[s])
            offsets[s] = size
            chunk = b.toString('utf8')
          }
        } finally {
          fs.closeSync(fd)
        }
      } catch {
        continue
      }
      const text = buf[s] + chunk
      const parts = text.split('\n')
      buf[s] = flush ? '' : parts.pop() ?? ''
      // Codes de couleur du kit retirés du journal relayé.
      const lines = parts
        .map((m) => m.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r$/, ''))
        .filter((m, i, a) => m !== '' || i < a.length - 1)
        .map((m) => ({ s, m: redact(m, secrets) }))
      job.logSize += this.store.appendLog(job.id, lines)
    }
    job.rawOffsets = offsets
    this.partial.set(job.id, buf)
  }

  private finish(job: JobRecord, code: number, oneTime: string[][] | undefined): void {
    const dir = this.store.jobDir(job.id)
    let result: Record<string, unknown> | undefined
    try {
      result = JSON.parse(fs.readFileSync(path.join(dir, 'result.raw.json'), 'utf8'))
    } catch {
      result = undefined
    }
    if (result && oneTime?.length) {
      const secret: Record<string, unknown> = {}
      for (const p of oneTime) {
        const value = takePath(result, p)
        if (value !== undefined && value !== null) secret[p.join('.')] = value
      }
      if (Object.keys(secret).length) {
        this.store.writeSecret(job.id, secret)
        result.oneTime = true
      }
    }
    if (result) {
      this.store.writeResult(job.id, result)
      job.result = result
    }
    job.state = code === -1 ? 'interrupted' : stateForExit(code)
    job.endedAt = new Date().toISOString()
    job.cancellable = false
    for (const step of job.steps) {
      if (job.state === 'succeeded') step.state = 'done'
      else if (step.state === 'running') step.state = 'failed'
    }
    if (job.state !== 'succeeded') {
      const last = this.store.readLog(job.id, Math.max(0, job.logSize - 5), true).lines.filter(Boolean).pop() ?? ''
      job.error = {
        code,
        cause: code === -1 ? 'interrupted' : EXIT_CAUSES[code] ?? 'general',
        message: last.replace(/^\s*(✗|Erreur\s*:)\s*/, '') || 'échec sans message',
      }
    }
    this.store.save(job)
    this.cleanupRaw(job.id)
    this.partial.delete(job.id)
    this.opts.onFinish(job)
  }

  private cleanupRaw(id: string): void {
    const dir = this.store.jobDir(id)
    for (const f of ['out.raw', 'err.raw', 'result.raw.json', 'exit.code']) fs.rmSync(path.join(dir, f), { force: true })
  }
}

/** Retire et rend la valeur au chemin `p` de `obj`. */
function takePath(obj: Record<string, unknown>, p: string[]): unknown {
  let cur: unknown = obj
  for (let i = 0; i < p.length - 1; i++) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p[i]]
  }
  if (!cur || typeof cur !== 'object') return undefined
  const last = p[p.length - 1]
  const value = (cur as Record<string, unknown>)[last]
  if (value !== undefined) (cur as Record<string, unknown>)[last] = null
  return value
}

/** Lecture exécutée en direct (liste, instantanés, DNS) : pas de verrou, pas de travail persisté. */
export function runInline(
  runner: JobRunner,
  args: { script: 'host' | 'admin'; argv: string[]; actor: string; timeoutMs: number; tmpDir: string },
): Promise<{ code: number; result: Record<string, unknown> | null; stderr: string }> {
  fs.mkdirSync(args.tmpDir, { recursive: true, mode: 0o700 })
  const resultFile = path.join(args.tmpDir, `inline-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  return new Promise((resolve) => {
    const child = spawn('bash', [runner.scriptPath(args.script), ...args.argv, '--json', '--non-interactive'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: runner.scriptEnv(args.actor, { POLENTA_RESULT_FILE: resultFile }),
      timeout: args.timeoutMs,
    })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 64_000) stderr += d.toString('utf8')
    })
    const done = (code: number) => {
      let result: Record<string, unknown> | null = null
      try {
        result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
      } catch {
        result = null
      }
      fs.rmSync(resultFile, { force: true })
      resolve({ code, result, stderr: redact(stderr.replace(/\x1b\[[0-9;]*m/g, '')) })
    }
    child.on('error', () => done(127))
    child.on('close', (code) => done(code ?? 1))
  })
}
