/**
 * GH63 — assemblage du service : stockage, runner (reprise des travaux au démarrage), audit de fin
 * de travail, rétention quotidienne, expiration des secrets à usage unique.
 */
import type { FastifyInstance } from 'fastify'
import { SocketAgent, type AgentClient } from './agent-client'
import { buildApp, auditFinish } from './app'
import { AuditLog } from './audit'
import { ForgeOwnerChecker } from './auth/forge-owner'
import { FailureLimiter } from './auth/rate-limit'
import { ServiceTokens } from './auth/service-token'
import type { AdminConfig } from './config'
import type { InstanceInfo } from './instances'
import { FlockProbe, HostLock, type LockProbe } from './jobs/lock'
import { REGISTRY } from './jobs/registry'
import { JobRunner } from './jobs/runner'
import { JobStore } from './jobs/store'
import { purgeUploads } from './sensitive-routes'

export interface ServiceOverrides {
  fetchImpl?: typeof fetch
  lockProbe?: LockProbe
  agent?: AgentClient
  instances?: () => InstanceInfo[]
  pollMs?: number
  rebootPollMs?: number
  bootId?: () => string
  now?: () => number
}

export function createService(cfg: AdminConfig, o: ServiceOverrides = {}): FastifyInstance {
  const store = new JobStore(cfg.root)
  const audit = new AuditLog(cfg.root)
  const runner = new JobRunner(store, {
    kitDir: cfg.kitDir,
    root: cfg.root,
    pollMs: o.pollMs,
    onFinish: (job) => auditFinish(audit, job),
    rebootWaitMs: cfg.rebootWaitMs,
    rebootPollMs: o.rebootPollMs,
    bootId: o.bootId,
  })
  const agent = o.agent ?? new SocketAgent(cfg.agentSocket)
  runner.recover((job) => REGISTRY.get(job.operation)?.oneTime)
  const app = buildApp({
    cfg,
    store,
    audit,
    runner,
    tokens: new ServiceTokens(cfg.root),
    owner: new ForgeOwnerChecker({
      forgeUrl: (instance) => cfg.forgeUrlTemplate.replace('{instance}', instance),
      cacheMs: cfg.ownerCacheMs,
      fetchImpl: o.fetchImpl,
      now: o.now,
    }),
    lock: new HostLock(cfg.root, o.lockProbe ?? new FlockProbe(cfg.root)),
    limiter: new FailureLimiter(10, 60_000, o.now),
    agent,
    instances: o.instances,
  })
  store.purge(Date.now(), cfg.retentionDays, cfg.retentionCount)
  const daily = setInterval(() => store.purge(Date.now(), cfg.retentionDays, cfg.retentionCount), 86_400_000)
  const minutely = setInterval(() => {
    store.expireSecrets()
    purgeUploads(cfg.root)
  }, 60_000)
  daily.unref()
  minutely.unref()
  app.addHook('onClose', async () => {
    clearInterval(daily)
    clearInterval(minutely)
  })
  return app
}
