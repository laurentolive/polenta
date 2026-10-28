/**
 * GH63 — persistance des travaux en fichiers (design D6, §5.4) :
 *   /opt/polenta/admin/jobs/<ULID>/job.json      vue du travail + champs internes (argv, pid, boot_id)
 *                                  log.ndjson    journal filtré, une ligne {t, s, m}
 *                                  result.json   résultat sans secret
 *                                  secret.json   valeur à usage unique (0600, supprimée à la lecture / 10 min)
 * Écritures atomiques (fichier temporaire + rename). Rétention : un travail est purgé s'il a plus
 * de 90 jours ET n'est pas parmi les 200 plus récents ; audit.log n'est jamais touché.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { JobLogChunk, JobView } from '@polenta/types'

export interface JobRecord extends JobView {
  /** argv expurgé (jamais de secret : les secrets ne passent pas en argument). */
  argv: string[]
  pid?: number
  /** Heure de démarrage du processus (champ 22 de /proc/<pid>/stat), contre la réutilisation de pid. */
  procStart?: string
  bootId?: string
  /** Octets déjà relayés des sorties brutes du script (out.raw, err.raw). */
  rawOffsets?: { out: number; err: number }
  /** Cible et paramètres recopiés dans l'audit à la fin du travail (liste blanche du registre). */
  target?: string
  auditParams?: Record<string, unknown>
}

/** Vue publique : sans les champs internes. */
export function publicView(job: JobRecord): JobView {
  const { argv: _a, pid: _p, procStart: _s, bootId: _b, rawOffsets: _r, target: _t, auditParams: _ap, ...view } = job
  return view
}

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function ulid(now = Date.now()): string {
  let t = now
  let time = ''
  for (let i = 0; i < 10; i++) {
    time = ULID_ALPHABET[t % 32] + time
    t = Math.floor(t / 32)
  }
  const bytes = crypto.randomBytes(16)
  let rand = ''
  for (let i = 0; i < 16; i++) rand += ULID_ALPHABET[bytes[i] % 32]
  return time + rand
}

const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

export function writeAtomic(file: string, data: string, mode = 0o600): void {
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`
  fs.writeFileSync(tmp, data, { mode })
  fs.renameSync(tmp, file)
}

export class JobStore {
  readonly dir: string

  constructor(root: string) {
    this.dir = path.join(root, 'admin', 'jobs')
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 })
  }

  jobDir(id: string): string {
    if (!ID_RE.test(id)) throw new Error('identifiant de travail invalide')
    return path.join(this.dir, id)
  }

  create(record: JobRecord): void {
    fs.mkdirSync(this.jobDir(record.id), { mode: 0o700 })
    fs.writeFileSync(path.join(this.jobDir(record.id), 'log.ndjson'), '', { mode: 0o600 })
    this.save(record)
  }

  save(record: JobRecord): void {
    writeAtomic(path.join(this.jobDir(record.id), 'job.json'), JSON.stringify(record, null, 2))
  }

  get(id: string): JobRecord | null {
    if (!ID_RE.test(id)) return null
    try {
      return JSON.parse(fs.readFileSync(path.join(this.jobDir(id), 'job.json'), 'utf8'))
    } catch {
      return null
    }
  }

  /** Tous les travaux, du plus récent au plus ancien (l'ULID est ordonné dans le temps). */
  list(): JobRecord[] {
    let names: string[]
    try {
      names = fs.readdirSync(this.dir)
    } catch {
      return []
    }
    return names
      .filter((n) => ID_RE.test(n))
      .sort()
      .reverse()
      .map((n) => this.get(n))
      .filter((j): j is JobRecord => j !== null)
  }

  appendLog(id: string, lines: { s: 'out' | 'err'; m: string }[]): number {
    if (!lines.length) return 0
    const t = new Date().toISOString()
    fs.appendFileSync(
      path.join(this.jobDir(id), 'log.ndjson'),
      lines.map((l) => JSON.stringify({ t, s: l.s, m: l.m })).join('\n') + '\n',
    )
    return lines.length
  }

  readLog(id: string, offset: number, eof: boolean, max = 1000): JobLogChunk {
    let text = ''
    try {
      text = fs.readFileSync(path.join(this.jobDir(id), 'log.ndjson'), 'utf8')
    } catch {
      return { offset, lines: [], eof }
    }
    const all = text.split('\n').filter(Boolean)
    const start = Math.max(0, Math.min(offset, all.length))
    const slice = all.slice(start, start + max)
    const lines = slice.map((l) => {
      try {
        return String((JSON.parse(l) as { m: unknown }).m)
      } catch {
        return ''
      }
    })
    return { offset: start + slice.length, lines, eof: eof && start + slice.length >= all.length }
  }

  writeResult(id: string, result: Record<string, unknown>): void {
    writeAtomic(path.join(this.jobDir(id), 'result.json'), JSON.stringify(result))
  }

  writeSecret(id: string, secret: Record<string, unknown>): void {
    writeAtomic(path.join(this.jobDir(id), 'secret.json'), JSON.stringify({ at: Date.now(), secret }))
  }

  /** Lit et supprime la valeur à usage unique ; `null` si absente ou expirée (10 min). */
  takeSecret(id: string, now = Date.now(), ttlMs = 10 * 60_000): Record<string, unknown> | null {
    const file = path.join(this.jobDir(id), 'secret.json')
    let data: { at: number; secret: Record<string, unknown> }
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      return null
    }
    fs.rmSync(file, { force: true })
    return now - data.at <= ttlMs ? data.secret : null
  }

  /** Supprime les secrets à usage unique expirés. */
  expireSecrets(now = Date.now(), ttlMs = 10 * 60_000): void {
    for (const job of this.list()) {
      const file = path.join(this.jobDir(job.id), 'secret.json')
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { at: number }
        if (now - data.at > ttlMs) fs.rmSync(file, { force: true })
      } catch {
        /* pas de secret */
      }
    }
  }

  purge(now = Date.now(), maxAgeDays = 90, keep = 200): string[] {
    const removed: string[] = []
    this.list().forEach((job, rank) => {
      const age = now - Date.parse(job.createdAt)
      const active = job.state === 'running' || job.state === 'queued' || job.state === 'rebooting'
      if (!active && rank >= keep && age > maxAgeDays * 86_400_000) {
        fs.rmSync(this.jobDir(job.id), { recursive: true, force: true })
        removed.push(job.id)
      }
    })
    return removed
  }
}
