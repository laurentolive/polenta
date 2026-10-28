/**
 * GH63 Sprint 5 — routes de lecture et de dépôt des opérations sensibles (design §5.1) : exports
 * (liste, téléchargement en flux), stockage S3 (état, inventaire avant purge), import CSV (dépôt et
 * aperçu), rapport d'accès, message d'invitation. Les écritures passent par `POST /jobs`.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuditLog } from './audit'
import type { Principal } from './app'
import { HttpError } from './app'
import { EXPORT_FILE_RE, v } from './validators'

export interface SensitiveDeps {
  root: string
  audit: AuditLog
  principal(req: FastifyRequest): Principal
  inline(p: Principal, argv: string[], script?: 'host' | 'admin'): Promise<Record<string, unknown>>
  refuse(req: FastifyRequest, operation: string, target: string, reason: string): void
}

/** Taille et nombre de lignes maximaux d'un CSV d'import (spec §3.10, mêmes limites que le kit). */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024
const UPLOAD_TTL_MS = 60 * 60_000

export function uploadsDir(root: string): string {
  return path.join(root, 'admin', 'tmp', 'uploads')
}

export function uploadPath(root: string, id: string): string {
  return path.join(uploadsDir(root), `${id}.csv`)
}

/** Dépôts d'import abandonnés (aperçu sans import) : effacés après une heure. */
export function purgeUploads(root: string, now = Date.now()): void {
  let names: string[] = []
  try {
    names = fs.readdirSync(uploadsDir(root))
  } catch {
    return
  }
  for (const n of names) {
    const f = path.join(uploadsDir(root), n)
    try {
      if (now - fs.statSync(f).mtimeMs > UPLOAD_TTL_MS) fs.rmSync(f, { force: true })
    } catch {
      /* déjà effacé */
    }
  }
}

export function registerSensitiveRoutes(app: FastifyInstance, d: SensitiveDeps): void {
  /** Instance visée par une lecture : la sienne au niveau instance, celle demandée au niveau hôte. */
  const targetOf = (req: FastifyRequest, operation: string, requested: unknown): string => {
    const p = d.principal(req)
    if (requested === undefined || requested === '') return p.instance
    if (!v.instance(requested)) throw new HttpError(400, 'invalid-param', 'nom d\'instance invalide')
    if (p.level !== 'host' && requested !== p.instance) {
      d.refuse(req, operation, String(requested), 'out-of-scope')
      throw new HttpError(403, 'forbidden', 'instance hors de votre portée')
    }
    return String(requested)
  }
  const hostOnly = (req: FastifyRequest, operation: string) => {
    if (d.principal(req).level !== 'host') {
      d.refuse(req, operation, '', 'host-level-required')
      throw new HttpError(403, 'forbidden', 'opération réservée au niveau hôte')
    }
  }

  // ── exports de restitution ─────────────────────────────────────────────────
  app.get('/exports', async (req) => {
    const p = d.principal(req)
    const r = await d.inline(p, ['exports', 'list'])
    const list = Array.isArray(r.exports) ? (r.exports as { file: string; instance?: string }[]) : []
    return { exports: p.level === 'host' ? list : list.filter((e) => e.file.startsWith(`${p.instance}-`)) }
  })

  // Téléchargement en flux (mémoire constante), droit revérifié à chaque appel (preHandler), audité.
  app.get<{ Params: { file: string } }>('/exports/:file/download', async (req, reply: FastifyReply) => {
    const p = d.principal(req)
    const file = req.params.file
    if (!EXPORT_FILE_RE.test(file)) throw new HttpError(400, 'invalid-param', 'nom d\'archive invalide')
    if (p.level !== 'host' && !file.startsWith(`${p.instance}-`)) {
      d.refuse(req, 'export.download', file, 'out-of-scope')
      throw new HttpError(403, 'forbidden', 'archive hors de votre portée')
    }
    const full = path.join(d.root, 'exports', file)
    let size: number
    try {
      size = fs.statSync(full).size
    } catch {
      throw new HttpError(404, 'not-found', 'archive introuvable')
    }
    d.audit.write({ actor: p.login, actorInstance: p.instance, ip: p.ip, origin: 'ui', operation: 'export.download', target: file, params: {}, result: 'succeeded' })
    void reply
      .header('Content-Type', 'application/gzip')
      .header('Content-Length', String(size))
      .header('Content-Disposition', `attachment; filename="${file}"`)
    return reply.send(fs.createReadStream(full))
  })

  // ── stockage S3 (niveau hôte) ──────────────────────────────────────────────
  app.get('/host/s3', async (req) => {
    hostOnly(req, 'host.s3')
    const r = await d.inline(d.principal(req), ['status'])
    // endpoint, bucket, 4 derniers caractères de la clé, date de remplacement : jamais la clé.
    return { s3: (r.backupStorage as Record<string, unknown> | null) ?? null }
  })

  app.get<{ Querystring: { name?: string } }>('/s3/purge-preview', async (req) => {
    hostOnly(req, 's3.purge.preview')
    if (!v.instance(req.query.name)) throw new HttpError(400, 'invalid-param', 'nom d\'instance invalide')
    return d.inline(d.principal(req), ['s3-purge', String(req.query.name), '--preview'])
  })

  // ── utilisateurs ───────────────────────────────────────────────────────────
  // Dépôt du CSV (JSON {instance?, csv}) puis aperçu par le kit ; le fichier reste pour l'import
  // (`users.import` avec `uploadId`), effacé en fin de travail ou après une heure.
  app.post<{ Body: { instance?: unknown; csv?: unknown } }>(
    '/users/import/preview',
    { bodyLimit: IMPORT_MAX_BYTES * 2 + 1024 },
    async (req) => {
      const p = d.principal(req)
      const target = targetOf(req, 'users.import.preview', req.body?.instance)
      const csv = req.body?.csv
      if (typeof csv !== 'string' || !csv.length) throw new HttpError(400, 'invalid-param', 'fichier CSV vide')
      if (Buffer.byteLength(csv, 'utf8') > IMPORT_MAX_BYTES) throw new HttpError(400, 'invalid-param', 'fichier de plus de 5 Mo')
      purgeUploads(d.root)
      fs.mkdirSync(uploadsDir(d.root), { recursive: true, mode: 0o700 })
      const uploadId = crypto.randomBytes(16).toString('hex')
      const file = uploadPath(d.root, uploadId)
      fs.writeFileSync(file, csv, { mode: 0o600 })
      try {
        const r = await d.inline(p, ['--instance', target, 'user', 'import', file, '--preview'], 'admin')
        return { uploadId, instance: target, ...r }
      } catch (err) {
        fs.rmSync(file, { force: true })
        throw err
      }
    },
  )

  app.get<{ Querystring: { instance?: string } }>('/users/access-report', async (req) => {
    const target = targetOf(req, 'users.accessReport', req.query.instance)
    return d.inline(d.principal(req), ['--instance', target, 'access-report'], 'admin')
  })

  app.get<{ Querystring: { instance?: string; login?: string } }>('/users/invite', async (req) => {
    const target = targetOf(req, 'users.invite', req.query.instance)
    if (!v.login(req.query.login)) throw new HttpError(400, 'invalid-param', 'login invalide')
    return d.inline(d.principal(req), ['--instance', target, 'invite', String(req.query.login)], 'admin')
  })
}
