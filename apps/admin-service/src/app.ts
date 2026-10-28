/**
 * GH63 — API interne du service `polenta-admin` (design §5.2), joignable seulement sur le réseau
 * Docker `polenta-admin-net` (aucun port publié). Contrôles, dans l'ordre, pour toute route sauf
 * /healthz : (1) jeton de service → instance d'origine ; (2) jeton utilisateur revérifié auprès de la
 * forge de cette instance (`is_owner`) ; (3) niveau et portée de la cible ; (4) confirmation,
 * garde « instance d'exploitation », verrou. Tout refus = ligne d'audit `refused`.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { AdminLevel, AdminMe, JobView } from '@polenta/types'
import type { AgentClient } from './agent-client'
import { AuditLog, auditCsv } from './audit'
import { ForgeOwnerChecker } from './auth/forge-owner'
import { levelOf, scope } from './auth/levels'
import { FailureLimiter } from './auth/rate-limit'
import { ServiceTokens, fingerprint } from './auth/service-token'
import { hostSettings, type AdminConfig } from './config'
import { listInstances, type InstanceInfo } from './instances'
import { HostLock } from './jobs/lock'
import { REGISTRY, checkConfirm, checkParams, expectedConfirm, fdSecretsOf, pickAudit, type OperationDef } from './jobs/registry'
import { registerSensitiveRoutes, uploadPath } from './sensitive-routes'
import { JobRunner, runInline } from './jobs/runner'
import { JobStore, publicView, ulid, type JobRecord } from './jobs/store'
import { redact } from './secrets/redact'
import { v } from './validators'

export interface Principal {
  instance: string
  login: string
  level: AdminLevel
  ip?: string
  org: string
  userToken: string
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal
  }
}

export interface AppDeps {
  cfg: AdminConfig
  tokens: ServiceTokens
  owner: ForgeOwnerChecker
  lock: HostLock
  store: JobStore
  runner: JobRunner
  audit: AuditLog
  limiter: FailureLimiter
  agent: AgentClient
  instances?: () => InstanceInfo[]
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

const header = (req: FastifyRequest, name: string): string | undefined => {
  const h = req.headers[name]
  return Array.isArray(h) ? h[0] : h
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { cfg, store, audit, runner } = deps
  const instances = deps.instances ?? (() => listInstances(cfg.root))
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 })

  const refuse = (req: FastifyRequest, operation: string, target: string, reason: string) => {
    const p = req.principal
    audit.write({
      actor: p?.login ?? header(req, 'x-polenta-actor') ?? 'inconnu',
      actorInstance: p?.instance ?? 'inconnue',
      ip: p?.ip,
      origin: 'ui',
      operation,
      target,
      params: {},
      result: 'refused',
      reason,
    })
  }

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Cache-Control', 'no-store')
    return payload
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ ok: false, error: { code: err.code, message: err.message, ...err.extra } })
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500
    const message = redact(String((err as Error).message ?? 'erreur'), req.principal ? [req.principal.userToken] : [])
    return reply.status(status >= 400 && status < 600 ? status : 500).send({ ok: false, error: { code: 'internal', message } })
  })

  app.get('/healthz', async () => ({ ok: true }))

  // ── authentification ───────────────────────────────────────────────────────
  app.addHook('preHandler', async (req) => {
    if (req.routeOptions.url === '/healthz') return
    const announcedIp = header(req, 'x-polenta-client-ip')
    const ip = announcedIp && net.isIP(announcedIp) ? announcedIp : undefined
    const auth = header(req, 'authorization') ?? ''
    const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1]
    const keys = [`ip:${ip ?? req.ip}`, `tok:${bearer ? fingerprint(bearer) : 'none'}`]
    if (deps.limiter.blocked(keys)) throw new HttpError(429, 'rate-limited', 'trop de tentatives, réessayez dans une minute')
    const origin = deps.tokens.identify(bearer)
    if (!origin) {
      deps.limiter.fail(keys)
      refuse(req, `${req.method} ${req.routeOptions.url ?? req.url}`, '', 'service-token-invalid')
      throw new HttpError(401, 'unauthenticated', 'jeton de service absent ou invalide')
    }
    const userToken = header(req, 'x-polenta-forge-token')
    if (!userToken) {
      refuse(req, `${req.method} ${req.routeOptions.url}`, origin, 'user-token-missing')
      throw new HttpError(401, 'unauthenticated', 'jeton utilisateur absent')
    }
    const all = instances()
    const info = all.find((i) => i.name === origin)
    if (!info) throw new HttpError(403, 'forbidden', "instance d'origine inconnue")
    const check = await deps.owner.check({
      instance: origin,
      org: info.org,
      userToken,
      announcedLogin: header(req, 'x-polenta-actor'),
    })
    if (!check.ok) {
      if (check.status === 401) deps.limiter.fail([keys[0]])
      req.principal = undefined
      audit.write({
        actor: header(req, 'x-polenta-actor') ?? 'inconnu',
        actorInstance: origin,
        ip,
        origin: 'ui',
        operation: `${req.method} ${req.routeOptions.url}`,
        target: origin,
        params: {},
        result: 'refused',
        reason: check.reason,
      })
      if (check.status === 502) throw new HttpError(502, 'forge-unreachable', 'forge injoignable pour vérifier le droit')
      throw new HttpError(check.status, check.status === 401 ? 'unauthenticated' : 'forbidden', 'droit propriétaire non confirmé par la forge')
    }
    const settings = hostSettings(cfg)
    req.principal = {
      instance: origin,
      login: check.login,
      level: levelOf(origin, settings.adminInstance),
      ip,
      org: info.org,
      userToken,
    }
  })

  const principal = (req: FastifyRequest): Principal => req.principal!

  const visible = (p: Principal, job: { instance: string | null; actor: { instance: string } }) =>
    p.level === 'host' || job.instance === p.instance || job.actor.instance === p.instance

  const externalJob = (): JobView | null => {
    const owner = deps.lock.owner()
    if (!owner || owner.origin !== 'ssh') return null
    return {
      id: `ssh-${owner.pid}`,
      operation: owner.op,
      instance: null,
      actor: { login: owner.actor, instance: '' },
      origin: 'ssh',
      state: 'running',
      createdAt: owner.since,
      startedAt: owner.since,
      steps: [],
      cancellable: false,
      logSize: 0,
    }
  }

  /** Travail mutant en cours : lancé par l'interface (un seul à la fois), sinon verrou tenu (SSH). */
  const runningJobInfo = () => {
    const j = store
      .list()
      .find((x) => ['running', 'queued', 'rebooting'].includes(x.state) && REGISTRY.get(x.operation)?.mutating)
    if (j) return { id: j.id, operation: j.operation, actor: j.actor.login, since: j.startedAt ?? j.createdAt }
    const owner = deps.lock.owner()
    if (owner) return { id: `${owner.origin}-${owner.pid}`, operation: owner.op, actor: `${owner.actor} (${owner.origin})`, since: owner.since }
    return null
  }

  const inline = async (p: Principal, argv: string[], script: 'host' | 'admin' = 'host') => {
    const r = await runInline(runner, {
      script,
      argv,
      actor: `${p.login}@${p.instance}`,
      timeoutMs: cfg.inlineTimeoutMs,
      tmpDir: path.join(cfg.root, 'admin', 'tmp'),
    })
    if (r.code === 12) throw new HttpError(404, 'instance-not-found', 'instance introuvable')
    const why = r.stderr.trim().split('\n').pop()?.replace(/^\s*(✗|Erreur\s*:)\s*/, '')
    if (r.code === 2 || r.code === 3) throw new HttpError(400, 'invalid-param', why || 'paramètre refusé par le kit')
    if (r.code === 6) throw new HttpError(422, 'precondition', why || 'pré-condition non remplie')
    if (r.code !== 0 || !r.result) {
      throw new HttpError(502, 'kit-error', r.stderr.trim().split('\n').pop() || `commande du kit en échec (${r.code})`)
    }
    return r.result
  }

  // ── lecture ────────────────────────────────────────────────────────────────
  app.get('/me', async (req): Promise<AdminMe> => {
    const p = principal(req)
    const settings = hostSettings(cfg)
    const agent = await deps.agent.state()
    return {
      level: p.level,
      instance: p.instance,
      hostName: cfg.hostName,
      agent,
      // Modules déclarés par l'agent (état réel) ; sans agent, ceux de host.env (#62).
      modules: { ...settings.modules, ...(agent === 'up' ? ((await deps.agent.modules()) ?? {}) : {}) },
      caddyMode: settings.caddyMode,
    }
  })

  app.get('/instances', async (req) => {
    const p = principal(req)
    const r = await inline(p, ['instance', 'list'])
    const list = Array.isArray(r.instances) ? (r.instances as { name: string }[]) : []
    return { instances: p.level === 'host' ? list : list.filter((i) => i.name === p.instance) }
  })

  app.get<{ Params: { name: string } }>('/instances/:name', async (req) => {
    const p = principal(req)
    const name = req.params.name
    if (!v.instance(name)) throw new HttpError(400, 'invalid-param', 'nom d\'instance invalide')
    if (p.level !== 'host' && name !== p.instance) {
      refuse(req, 'instance.get', name, 'out-of-scope')
      throw new HttpError(403, 'forbidden', 'instance hors de votre portée')
    }
    const r = await inline(p, ['instance', 'list'])
    const row = (Array.isArray(r.instances) ? (r.instances as { name: string }[]) : []).find((i) => i.name === name)
    if (!row) throw new HttpError(404, 'instance-not-found', 'instance introuvable')
    return row
  })

  app.get<{ Params: { instance: string } }>('/backups/:instance', async (req) => {
    const p = principal(req)
    const name = req.params.instance
    if (!v.instance(name)) throw new HttpError(400, 'invalid-param', 'nom d\'instance invalide')
    if (p.level !== 'host' && name !== p.instance) {
      refuse(req, 'backup.list', name, 'out-of-scope')
      throw new HttpError(403, 'forbidden', 'instance hors de votre portée')
    }
    return inline(p, ['instance', 'snapshots', name])
  })

  app.get<{ Querystring: { domain?: string } }>('/dns', async (req) => {
    const p = principal(req)
    if (!v.domain(req.query.domain)) throw new HttpError(400, 'invalid-param', 'domaine invalide')
    return inline(p, ['dns', 'check', String(req.query.domain)])
  })

  app.get<{ Querystring: { from?: string; instance?: string } }>('/audit', async (req) => {
    const p = principal(req)
    const instance = p.level === 'host' ? req.query.instance : p.instance
    return { lines: audit.read({ from: req.query.from, instance }) }
  })

  app.get<{ Querystring: { from?: string; instance?: string } }>('/audit.csv', async (req, reply) => {
    const p = principal(req)
    const instance = p.level === 'host' ? req.query.instance : p.instance
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', 'attachment; filename="audit.csv"')
    return '﻿' + auditCsv(audit.read({ from: req.query.from, instance }))
  })

  // ── Sprint 5 : exports, stockage S3, utilisateurs (lectures et dépôt) ──────
  registerSensitiveRoutes(app, { root: cfg.root, audit, principal, inline, refuse })

  // ── travaux ────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { state?: string; instance?: string } }>('/jobs', async (req) => {
    const p = principal(req)
    const jobs: JobView[] = store
      .list()
      .filter((j) => visible(p, j))
      .filter((j) => !req.query.state || j.state === req.query.state)
      .filter((j) => !req.query.instance || j.instance === req.query.instance)
      .slice(0, 200)
      .map(publicView)
    const ext = externalJob()
    if (ext && (!req.query.state || req.query.state === 'running')) jobs.unshift(ext)
    return { jobs }
  })

  const jobFor = (req: FastifyRequest, id: string): JobRecord => {
    const job = store.get(id)
    if (!job || !visible(principal(req), job)) throw new HttpError(404, 'job-not-found', 'travail introuvable')
    return job
  }

  app.get<{ Params: { id: string } }>('/jobs/:id', async (req) => publicView(jobFor(req, req.params.id)))

  app.get<{ Params: { id: string }; Querystring: { offset?: string } }>('/jobs/:id/log', async (req) => {
    const job = jobFor(req, req.params.id)
    const offset = Math.max(0, Number.parseInt(req.query.offset ?? '0', 10) || 0)
    const ended = !['running', 'queued', 'rebooting'].includes(job.state)
    return store.readLog(job.id, offset, ended)
  })

  app.get<{ Params: { id: string } }>('/jobs/:id/secret', async (req) => {
    const p = principal(req)
    const job = jobFor(req, req.params.id)
    if (job.actor.login !== p.login || job.actor.instance !== p.instance) {
      refuse(req, `${job.operation}.secret`, job.instance ?? '', 'not-job-actor')
      throw new HttpError(403, 'forbidden', "seul l'auteur du travail peut lire ce résultat")
    }
    const secret = store.takeSecret(job.id)
    if (!secret) throw new HttpError(404, 'secret-gone', 'valeur déjà consultée ou expirée')
    audit.write({ actor: p.login, actorInstance: p.instance, ip: p.ip, origin: 'ui', operation: `${job.operation}.secret`, target: job.instance ?? '', params: {}, jobId: job.id, result: 'succeeded' })
    return { secret }
  })

  app.post<{ Params: { id: string } }>('/jobs/:id/cancel', async (req) => {
    const p = principal(req)
    const job = jobFor(req, req.params.id)
    if (!job.cancellable || job.state !== 'running') {
      refuse(req, `${job.operation}.cancel`, job.instance ?? '', 'not-cancellable')
      throw new HttpError(409, 'not-cancellable', 'ce travail ne peut pas être annulé')
    }
    if (!runner.cancel(job)) throw new HttpError(409, 'not-cancellable', 'processus du travail introuvable')
    audit.write({ actor: p.login, actorInstance: p.instance, ip: p.ip, origin: 'ui', operation: `${job.operation}.cancel`, target: job.instance ?? '', params: {}, jobId: job.id, result: 'accepted' })
    return { ok: true }
  })

  app.post<{ Body: unknown }>('/jobs', async (req, reply: FastifyReply) => {
    const p = principal(req)
    const body = (req.body ?? {}) as { operation?: unknown; instance?: unknown; params?: unknown; confirm?: unknown }
    const opName = typeof body.operation === 'string' ? body.operation : ''
    const def: OperationDef | undefined = REGISTRY.get(opName)
    if (!def) {
      refuse(req, opName || 'inconnue', '', 'unknown-operation')
      throw new HttpError(400, 'unknown-operation', 'opération inconnue ou pas encore disponible')
    }
    const requested = body.instance
    if (requested !== undefined && !v.instance(requested)) {
      refuse(req, def.id, '', 'invalid-param:instance')
      throw new HttpError(400, 'invalid-param', 'paramètre invalide : instance', { field: 'instance' })
    }
    const params = checkParams(def, body.params)
    if (!params.ok) {
      refuse(req, def.id, String(requested ?? ''), `invalid-param:${params.field}`)
      throw new HttpError(400, 'invalid-param', `paramètre invalide : ${params.field}`, { field: params.field })
    }
    const sc = scope({ level: p.level, originInstance: p.instance, opLevel: def.level, needsInstance: def.needsInstance, requested: requested as string | undefined })
    if (!sc.ok) {
      refuse(req, def.id, String(requested ?? ''), sc.reason)
      throw new HttpError(403, 'forbidden', def.level === 'host' && p.level !== 'host' ? "opération réservée au niveau hôte" : 'instance hors de votre portée')
    }
    // Cible sans instance existante : nom de la nouvelle instance (ajout) ou de l'instance purgée.
    const target = sc.target ?? (def.id === 'instance.add' || def.id === 's3.purge' ? String(params.params.name) : '')
    if (def.needsInstance && !instances().some((i) => i.name === target)) {
      refuse(req, def.id, target, 'instance-not-found')
      throw new HttpError(404, 'instance-not-found', 'instance introuvable')
    }
    const expected = expectedConfirm(def, target, cfg.hostName, params.params)
    if (!checkConfirm(def, body.confirm, expected)) {
      refuse(req, def.id, target, 'confirmation')
      throw new HttpError(400, 'confirmation-required', def.confirm === 'simple' ? 'confirmation requise' : `confirmation requise : saisissez « ${expected} »`)
    }
    const why = def.check?.(target, params.params)
    if (why) {
      refuse(req, def.id, target, why)
      throw new HttpError(403, 'forbidden', why)
    }
    // Purge : jamais une instance encore présente sur l'hôte (le kit le refuse aussi).
    if (def.id === 's3.purge' && instances().some((i) => i.name === target)) {
      refuse(req, def.id, target, 'instance-exists')
      throw new HttpError(422, 'precondition', `l'instance « ${target} » existe encore : supprimez-la avant de purger ses sauvegardes`)
    }
    let uploadFile: string | null = null
    if (def.id === 'users.import') {
      uploadFile = uploadPath(cfg.root, String(params.params.uploadId))
      if (!fs.existsSync(uploadFile)) {
        refuse(req, def.id, target, 'upload-missing')
        throw new HttpError(422, 'precondition', 'fichier déposé introuvable ou expiré : refaites l\'aperçu')
      }
    }
    const settings = hostSettings(cfg)
    if (def.selfGuard && (target === p.instance || (def.id === 'instance.remove' && target === settings.adminInstance))) {
      refuse(req, def.id, target, 'operations-instance')
      throw new HttpError(422, 'operations-instance', "refusé : opération sur l'instance d'où vous administrez (ou instance d'exploitation)", { exitCode: 18 })
    }
    if (def.destructive) {
      const fresh = await deps.owner.check({ instance: p.instance, org: p.org, userToken: p.userToken, announcedLogin: p.login, noCache: true })
      if (!fresh.ok) {
        refuse(req, def.id, target, fresh.reason)
        throw new HttpError(fresh.status === 502 ? 502 : fresh.status, 'forbidden', 'droit propriétaire non confirmé par la forge')
      }
    }
    const lockCheck = () => {
      if (!def.mutating) return
      const running = runningJobInfo()
      if (running) {
        refuse(req, def.id, target, 'locked')
        throw new HttpError(409, 'locked', 'une autre opération est en cours', { runningJob: running })
      }
    }
    lockCheck()
    if (def.agent) {
      if ((await deps.agent.state()) !== 'up') {
        refuse(req, def.id, target, 'agent-absent')
        throw new HttpError(503, 'agent-absent', "agent hôte absent : opération indisponible (polenta-host en SSH reste possible)")
      }
      if (def.module && !(await deps.agent.modules())?.[def.module]) {
        refuse(req, def.id, target, `module-absent:${def.module}`)
        throw new HttpError(422, 'module-absent', `module « ${def.module} » non actif sur cet hôte (HARDEN_HOST / HOST_MODULES) : rien n'est installé depuis l'interface`)
      }
    }
    // Revérifié sans attente avant la création : aucun autre travail ne peut s'intercaler.
    lockCheck()
    const now = new Date().toISOString()
    const auditParams = pickAudit(def, params.params)
    const job: JobRecord = {
      id: ulid(),
      operation: def.id,
      instance: def.needsInstance || def.id === 'instance.add' ? target : null,
      actor: { login: p.login, instance: p.instance, ip: p.ip },
      origin: 'ui',
      state: 'queued',
      createdAt: now,
      steps: (def.steps ?? []).map((name) => ({ name, state: 'pending' })),
      cancellable: def.cancellable,
      logSize: 0,
      argv: def.argv(sc.target, params.params).map((a) => (uploadFile && a.startsWith('@upload:') ? uploadFile : a)),
      target,
      auditParams,
    }
    store.create(job)
    audit.write({ actor: p.login, actorInstance: p.instance, ip: p.ip, origin: 'ui', operation: def.id, target, params: auditParams, jobId: job.id, result: 'accepted' })
    const actor = `${p.login}@${p.instance}`
    if (def.agent === 'host.reboot') runner.startReboot(job, { actor, agent: deps.agent })
    else if (def.agent) runner.startAgent(job, { action: def.agent, params: params.params, actor, agent: deps.agent })
    else {
      runner.start(job, {
        script: def.script,
        argv: job.argv,
        actor,
        oneTime: def.oneTime,
        fdSecrets: fdSecretsOf(def, params.params),
        cleanup: uploadFile ? [uploadFile] : undefined,
      })
    }
    return reply.status(202).send({ jobId: job.id })
  })

  app.addHook('onClose', async () => runner.stopAll())

  return app
}

/** Ligne d'audit de fin de travail. */
export function auditFinish(audit: AuditLog, job: JobRecord): void {
  const result = job.state === 'succeeded' || job.state === 'failed' || job.state === 'rolled-back' || job.state === 'cancelled' || job.state === 'interrupted' ? job.state : 'failed'
  audit.write({
    actor: job.actor.login,
    actorInstance: job.actor.instance,
    ip: job.actor.ip,
    origin: job.origin,
    operation: job.operation,
    target: job.target ?? job.instance ?? '',
    params: job.auditParams ?? {},
    jobId: job.id,
    result,
    reason: job.error?.cause,
  })
}
