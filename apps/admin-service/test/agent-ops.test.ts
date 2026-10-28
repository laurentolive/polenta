// GH63 — opérations « agent » vues du service (S3-6, S3-7, S3-8, S3-9, S3-10).
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { AgentAction, AgentClient, AgentResponse } from '../src/agent-client'
import { loadConfig } from '../src/config'
import { createService } from '../src/service'
import { fakeForge, setupRoot, until } from './helpers'

const forge = fakeForge({ 'u-olga': 'olga', 'u-alice': 'alice' }, { ops: ['olga'], acme: ['alice'] })
const hdr = (svc = 'svc-ops', user = 'u-olga') => ({ authorization: `Bearer ${svc}`, 'x-polenta-forge-token': user })

function fakeAgent(opts: { up?: boolean; modules?: Record<string, boolean>; respond?: (a: AgentAction, p: Record<string, unknown>) => AgentResponse } = {}) {
  const calls: { action: AgentAction; params: Record<string, unknown>; actor: string }[] = []
  const client: AgentClient = {
    state: async () => (opts.up === false ? 'absent' : 'up'),
    modules: async () => (opts.up === false ? null : { docker: true, ...(opts.modules ?? { fail2ban: true, firewall: true }) }),
    request: async (action, params, actor, onLog) => {
      calls.push({ action, params, actor })
      onLog?.(`agent : ${action} password=secret-123456`)
      return opts.respond?.(action, params) ?? { ok: true, result: { action } }
    },
  }
  return { client, calls }
}

let app: FastifyInstance | null = null
afterEach(async () => {
  await app?.close()
  app = null
})

function start(agent: AgentClient, extra: { bootId?: () => string; rebootWaitMin?: string } = {}) {
  const env = setupRoot()
  const cfg = loadConfig({ POLENTA_ROOT: env.root, POLENTA_KIT_DIR: env.kit, POLENTA_HOST_NAME: 'hote1', REBOOT_WAIT_MIN: extra.rebootWaitMin })
  app = createService(cfg, { fetchImpl: forge.fetch, lockProbe: { held: () => false }, pollMs: 50, rebootPollMs: 50, agent, bootId: extra.bootId })
  return { a: app, env, cfg }
}

const job = async (a: FastifyInstance, id: string) => (await a.inject({ url: `/jobs/${id}`, headers: hdr() })).json()

describe('agent absent (S3-9)', () => {
  it('/me : absent ; actions agent 503 ; opérations du kit OK', async () => {
    const { a } = start(fakeAgent({ up: false }).client)
    expect((await a.inject({ url: '/me', headers: hdr() })).json()).toMatchObject({ agent: 'absent' })
    for (const operation of ['fail2ban.status', 'firewall.status', 'host.setup']) {
      expect((await a.inject({ method: 'POST', url: '/jobs', headers: hdr(), payload: { operation } })).statusCode).toBe(503)
    }
    expect((await a.inject({ method: 'POST', url: '/jobs', headers: hdr(), payload: { operation: 'host.reboot', confirm: 'hote1' } })).statusCode).toBe(503)
    expect((await a.inject({ method: 'POST', url: '/jobs', headers: hdr(), payload: { operation: 'backup.run' } })).statusCode).toBe(202)
  })
})

describe('agent présent', () => {
  it('/me : up et modules de l\'agent', async () => {
    const { a } = start(fakeAgent({ modules: { fail2ban: true, firewall: false } }).client)
    expect((await a.inject({ url: '/me', headers: hdr() })).json()).toMatchObject({ agent: 'up', modules: { fail2ban: true, firewall: false } })
  })

  it('module absent (S3-10) : 422, agent jamais appelé', async () => {
    const ag = fakeAgent({ modules: { fail2ban: false, firewall: false } })
    const { a } = start(ag.client)
    for (const payload of [{ operation: 'fail2ban.unban', params: { ip: '203.0.113.9' } }, { operation: 'firewall.status' }]) {
      const r = await a.inject({ method: 'POST', url: '/jobs', headers: hdr(), payload })
      expect(r.statusCode).toBe(422)
      expect(r.json().error.code).toBe('module-absent')
    }
    expect(ag.calls).toEqual([])
  })

  it('niveau instance : actions agent refusées', async () => {
    const ag = fakeAgent()
    const { a } = start(ag.client)
    const r = await a.inject({ method: 'POST', url: '/jobs', headers: hdr('svc-acme', 'u-alice'), payload: { operation: 'fail2ban.status' } })
    expect(r.statusCode).toBe(403)
    expect(ag.calls).toEqual([])
  })

  it('fail2ban.unban : travail réussi, journal filtré, acteur transmis', async () => {
    const ag = fakeAgent()
    const { a } = start(ag.client)
    const { jobId } = (await a.inject({ method: 'POST', url: '/jobs', headers: hdr(), payload: { operation: 'fail2ban.unban', params: { ip: '2001:db8::1' } } })).json()
    await until(async () => (await job(a, jobId)).state === 'succeeded')
    expect(ag.calls).toEqual([{ action: 'fail2ban.unban', params: { ip: '2001:db8::1' }, actor: 'olga@ops' }])
    const log = (await a.inject({ url: `/jobs/${jobId}/log`, headers: hdr() })).json()
    expect(log.lines.join('\n')).toContain('agent : fail2ban.unban')
    expect(log.lines.join('\n')).not.toContain('secret-123456')
  })

  it('host.setup refusé par l\'agent (ssh-hardening, code 3) : failed, cause confirmation (S3-8)', async () => {
    const ag = fakeAgent({ respond: (_a, p) => (p.sshHardeningConfirmed ? { ok: true, result: {} } : { ok: false, error: 'ssh-hardening-confirmation-required', code: 3 }) })
    const { a } = start(ag.client)
    const r1 = (await a.inject({ method: 'POST', url: '/jobs', headers: hdr(), payload: { operation: 'host.setup' } })).json()
    await until(async () => (await job(a, r1.jobId)).state === 'failed')
    expect((await job(a, r1.jobId)).error).toMatchObject({ code: 3, cause: 'confirmation' })
    const r2 = (await a.inject({ method: 'POST', url: '/jobs', headers: hdr(), payload: { operation: 'host.setup', params: { sshHardeningConfirmed: true } } })).json()
    await until(async () => (await job(a, r2.jobId)).state === 'succeeded')
  })
})

describe('redémarrage de l\'hôte (S3-6, S3-7)', () => {
  it('confirmation = nom d\'hôte ; rebooting puis succeeded quand le boot_id change', async () => {
    let boot = 'boot-1'
    const ag = fakeAgent()
    const { a, env } = start(ag.client, { bootId: () => boot })
    expect((await a.inject({ method: 'POST', url: '/jobs', headers: hdr(), payload: { operation: 'host.reboot', confirm: true } })).statusCode).toBe(400)
    const { jobId } = (await a.inject({ method: 'POST', url: '/jobs', headers: hdr(), payload: { operation: 'host.reboot', confirm: 'hote1' } })).json()
    expect((await job(a, jobId)).state).toBe('rebooting')
    // Travail tracé AVANT l'appel à l'agent.
    expect(JSON.parse(fs.readFileSync(path.join(env.root, 'admin', 'jobs', jobId, 'job.json'), 'utf8')).bootId).toBe('boot-1')
    // Pendant le redémarrage, aucune autre opération mutante.
    expect((await a.inject({ method: 'POST', url: '/jobs', headers: hdr(), payload: { operation: 'backup.run', instance: 'ops' } })).statusCode).toBe(409)
    boot = 'boot-2'
    await until(async () => (await job(a, jobId)).state === 'succeeded')
    expect((await job(a, jobId)).result).toMatchObject({ previousBootId: 'boot-1', bootId: 'boot-2' })
  })

  it('hôte qui ne revient pas : failed avec consigne console (KVM)', async () => {
    const ag = fakeAgent()
    const { a } = start(ag.client, { bootId: () => 'meme-boot', rebootWaitMin: '0.001' })
    const { jobId } = (await a.inject({ method: 'POST', url: '/jobs', headers: hdr(), payload: { operation: 'host.reboot', confirm: 'hote1' } })).json()
    await until(async () => (await job(a, jobId)).state === 'failed')
    expect((await job(a, jobId)).error.message).toMatch(/KVM/)
  })
})
