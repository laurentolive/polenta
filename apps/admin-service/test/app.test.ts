// GH63 — API interne du service contre un kit simulé et une forge simulée (S2-2 à S2-26).
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../src/config'
import { createService } from '../src/service'
import { JobStore, ulid } from '../src/jobs/store'
import { fakeForge, setupRoot, until } from './helpers'

const forge = fakeForge(
  { 'u-alice': 'alice', 'u-bob': 'bob', 'u-olga': 'olga', 'u-gina': 'gina' },
  { acme: ['alice'], ops: ['olga'], globex: ['gina'] },
)

let held = false
let app: FastifyInstance | null = null

function start(env: ReturnType<typeof setupRoot>) {
  fs.writeFileSync(path.join(env.root, 'calls.log'), '')
  const cfg = { ...loadConfig({ POLENTA_ROOT: env.root, POLENTA_KIT_DIR: env.kit, POLENTA_HOST_NAME: 'hote1' }) }
  app = createService(cfg, { fetchImpl: forge.fetch, lockProbe: { held: () => held }, pollMs: 50 })
  return app
}

afterEach(async () => {
  held = false
  await app?.close()
  app = null
})

const hdr = (svc: string, user?: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${svc}`,
  ...(user ? { 'x-polenta-forge-token': user } : {}),
  ...extra,
})

const post = (a: FastifyInstance, body: unknown, svc = 'svc-acme', user = 'u-alice') =>
  a.inject({ method: 'POST', url: '/jobs', headers: hdr(svc, user), payload: body as Record<string, unknown> })

const calls = (root: string) => fs.readFileSync(path.join(root, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean)
const auditLines = (root: string) =>
  fs.readFileSync(path.join(root, 'admin', 'audit.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

describe('travail nominal (S2-2)', () => {
  it('backup.run : 202, running → succeeded, journal filtré, audit', async () => {
    const env = setupRoot()
    const a = start(env)
    const res = await post(a, { operation: 'backup.run', instance: 'acme' })
    expect(res.statusCode).toBe(202)
    const { jobId } = res.json()
    await until(async () => (await a.inject({ url: `/jobs/${jobId}`, headers: hdr('svc-acme', 'u-alice') })).json().state === 'succeeded')
    const job = (await a.inject({ url: `/jobs/${jobId}`, headers: hdr('svc-acme', 'u-alice') })).json()
    expect(job.result).toMatchObject({ instance: 'acme', snapshot: 'abc' })
    expect(job).not.toHaveProperty('argv')
    const log = (await a.inject({ url: `/jobs/${jobId}/log?offset=0`, headers: hdr('svc-acme', 'u-alice') })).json()
    expect(log.eof).toBe(true)
    expect(log.lines.join('\n')).toContain('Sauvegarde de acme')
    expect(log.lines.join('\n')).not.toContain('hunter2')
    expect(fs.readFileSync(path.join(env.root, 'env.log'), 'utf8')).toContain('ui|alice@acme|1')
    expect(auditLines(env.root).map((l) => l.result)).toEqual(['accepted', 'succeeded'])
    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('authentification et cloisonnement (S2-6 à S2-10)', () => {
  it('jeton de globex visant acme : 403, rien exécuté, audit refused', async () => {
    const env = setupRoot()
    const a = start(env)
    const res = await post(a, { operation: 'backup.run', instance: 'acme' }, 'svc-globex', 'u-gina')
    expect(res.statusCode).toBe(403)
    expect(calls(env.root)).toEqual([])
    expect(auditLines(env.root).pop()).toMatchObject({ result: 'refused', reason: 'out-of-scope' })
  })

  it('niveau instance : opérations hôte refusées ; ops : niveau hôte', async () => {
    const env = setupRoot()
    const a = start(env)
    expect((await post(a, { operation: 'instance.add', params: { name: 'beta' } })).statusCode).toBe(403)
    expect((await post(a, { operation: 'host.setup' })).statusCode).toBe(403)
    const me = (await a.inject({ url: '/me', headers: hdr('svc-ops', 'u-olga') })).json()
    expect(me).toMatchObject({ level: 'host', instance: 'ops', agent: 'absent', hostName: 'hote1' })
    expect(me.modules).toMatchObject({ docker: true, fail2ban: true, firewall: false })
    expect((await post(a, { operation: 'backup.run', instance: 'acme' }, 'svc-ops', 'u-olga')).statusCode).toBe(202)
  })

  it('jetons absents, invalides, non-propriétaire, login annoncé faux', async () => {
    const env = setupRoot()
    const a = start(env)
    expect((await a.inject({ url: '/me', headers: hdr('faux', 'u-alice') })).statusCode).toBe(401)
    expect((await a.inject({ url: '/me', headers: hdr('svc-acme') })).statusCode).toBe(401)
    expect((await a.inject({ url: '/me', headers: hdr('svc-acme', 'invalide') })).statusCode).toBe(401)
    expect((await a.inject({ url: '/me', headers: hdr('svc-acme', 'u-bob') })).statusCode).toBe(403)
    expect((await a.inject({ url: '/me', headers: hdr('svc-acme', 'u-bob', { 'x-polenta-actor': 'alice' }) })).statusCode).toBe(403)
    expect((await a.inject({ url: '/healthz' })).statusCode).toBe(200)
  })

  it('limiteur : 429 après 10 échecs depuis une source, autre source acceptée (S2-12)', async () => {
    const env = setupRoot()
    const a = start(env)
    for (let i = 0; i < 10; i++) await a.inject({ url: '/me', headers: hdr(`faux-${i}`, 'u-alice', { 'x-polenta-client-ip': '203.0.113.5' }) })
    expect((await a.inject({ url: '/me', headers: hdr('svc-acme', 'u-alice', { 'x-polenta-client-ip': '203.0.113.5' }) })).statusCode).toBe(429)
    expect((await a.inject({ url: '/me', headers: hdr('svc-acme', 'u-alice', { 'x-polenta-client-ip': '203.0.113.6' }) })).statusCode).toBe(200)
  })
})

describe('verrou (S2-19 à S2-21)', () => {
  it('travail mutant en cours : 409 avec runningJob ; lectures autorisées', async () => {
    const env = setupRoot()
    env.fake('FAKE_SLEEP=30')
    const a = start(env)
    const first = await post(a, { operation: 'backup.run' })
    expect(first.statusCode).toBe(202)
    const second = await post(a, { operation: 'forge.update', params: { version: '11.0.3' } })
    expect(second.statusCode).toBe(409)
    expect(second.json().error.runningJob).toMatchObject({ operation: 'backup.run', actor: 'alice' })
    expect((await a.inject({ url: '/backups/acme', headers: hdr('svc-acme', 'u-alice') })).statusCode).toBe(200)
    expect((await a.inject({ url: '/dns?domain=acme.exemple.fr', headers: hdr('svc-acme', 'u-alice') })).json()).toMatchObject({ verdict: 'ok' })
  })

  it('verrou tenu par SSH : 409 et travail externe listé', async () => {
    const env = setupRoot()
    const a = start(env)
    held = true
    fs.writeFileSync(path.join(env.root, '.lock.owner'), JSON.stringify({ op: 'instance backup acme', actor: 'root', origin: 'ssh', pid: 4242, since: '2026-10-28T09:00:00Z' }))
    const res = await post(a, { operation: 'backup.run' })
    expect(res.statusCode).toBe(409)
    const jobs = (await a.inject({ url: '/jobs', headers: hdr('svc-acme', 'u-alice') })).json().jobs
    expect(jobs[0]).toMatchObject({ origin: 'ssh', operation: 'instance backup acme', state: 'running' })
    expect((await a.inject({ url: '/instances', headers: hdr('svc-acme', 'u-alice') })).json().instances).toEqual([{ name: 'acme', state: 'ok' }])
  })
})

describe('annulation et retour arrière (S2-22, S2-23)', () => {
  // SIGTERM n'atteint pas un bash MSYS depuis Node sous Windows : scénario vérifié sous Linux seulement.
  it.skipIf(process.platform === 'win32')('backup.run annulé → cancelled ; forge.update non annulable', async () => {
    const env = setupRoot()
    env.fake('FAKE_SLEEP=100')
    const a = start(env)
    const { jobId } = (await post(a, { operation: 'backup.run' })).json()
    await until(() => fs.existsSync(path.join(env.root, 'env.log')))
    expect((await a.inject({ method: 'POST', url: `/jobs/${jobId}/cancel`, headers: hdr('svc-acme', 'u-alice') })).statusCode).toBe(200)
    await until(async () => (await a.inject({ url: `/jobs/${jobId}`, headers: hdr('svc-acme', 'u-alice') })).json().state === 'cancelled')
    env.fake('FAKE_SLEEP=0')
    const upd = (await post(a, { operation: 'forge.update', params: { version: '11.0.3' } })).json()
    expect((await a.inject({ method: 'POST', url: `/jobs/${upd.jobId}/cancel`, headers: hdr('svc-acme', 'u-alice') })).statusCode).toBe(409)
  })

  it('mise à jour échouée : rolled-back (≠ failed)', async () => {
    const env = setupRoot()
    env.fake('FAKE_FAIL_UPDATE=1')
    const a = start(env)
    const { jobId } = (await post(a, { operation: 'forge.update', params: { version: '11.0.3' } })).json()
    await until(async () => (await a.inject({ url: `/jobs/${jobId}`, headers: hdr('svc-acme', 'u-alice') })).json().state !== 'running')
    const job = (await a.inject({ url: `/jobs/${jobId}`, headers: hdr('svc-acme', 'u-alice') })).json()
    expect(job.state).toBe('rolled-back')
    expect(job.error).toMatchObject({ code: 17, cause: 'rolled-back' })
    expect(job.result.updates[0].restoredVersion).toBe('10.0.1')
  })
})

describe('confirmations et refus (S2-25 à S2-27)', () => {
  it('instance.remove : confirmation exacte, puis 202', async () => {
    const env = setupRoot()
    const a = start(env)
    for (const confirm of [undefined, true, 'globex']) {
      expect((await post(a, { operation: 'instance.remove', instance: 'acme', confirm }, 'svc-ops', 'u-olga')).statusCode).toBe(400)
    }
    expect(calls(env.root)).toEqual([])
    const ok = await post(a, { operation: 'instance.remove', instance: 'acme', confirm: 'acme' }, 'svc-ops', 'u-olga')
    expect(ok.statusCode).toBe(202)
    await until(() => calls(env.root).length > 0)
    expect(calls(env.root)[0]).toBe('instance remove acme --confirm acme')
  })

  it("instance d'exploitation et client web courant : refus 18", async () => {
    const env = setupRoot()
    const a = start(env)
    const r1 = await post(a, { operation: 'instance.remove', instance: 'ops', confirm: 'ops' }, 'svc-ops', 'u-olga')
    expect(r1.statusCode).toBe(422)
    expect(r1.json().error).toMatchObject({ code: 'operations-instance', exitCode: 18 })
    expect((await post(a, { operation: 'web.disable' })).statusCode).toBe(422)
    expect((await post(a, { operation: 'instance.stop', confirm: true })).statusCode).toBe(422)
    expect((await post(a, { operation: 'host.reboot', confirm: 'hote1' }, 'svc-ops', 'u-olga')).statusCode).toBe(503)
    expect(calls(env.root)).toEqual([])
  })

  it('paramètres invalides : 400, rien exécuté', async () => {
    const env = setupRoot()
    const a = start(env)
    for (const body of [
      { operation: 'backup.run', instance: '../x' },
      { operation: 'backup.run', instance: 'A;rm' },
      { operation: 'dns.check', params: { domain: 'a b' } },
      { operation: 'forge.update', params: { version: 'latest' } },
      { operation: 'shell.exec' },
    ]) {
      expect((await post(a, body)).statusCode).toBe(400)
    }
    expect(calls(env.root)).toEqual([])
  })

  it('instance.add : mot de passe temporaire à usage unique', async () => {
    const env = setupRoot()
    const a = start(env)
    const { jobId } = (await post(a, { operation: 'instance.add', params: { name: 'beta' } }, 'svc-ops', 'u-olga')).json()
    await until(async () => (await a.inject({ url: `/jobs/${jobId}`, headers: hdr('svc-ops', 'u-olga') })).json().state === 'succeeded')
    const job = (await a.inject({ url: `/jobs/${jobId}`, headers: hdr('svc-ops', 'u-olga') })).json()
    expect(JSON.stringify(job)).not.toContain('Tmp-Pass')
    expect(job.result.oneTime).toBe(true)
    const s = await a.inject({ url: `/jobs/${jobId}/secret`, headers: hdr('svc-ops', 'u-olga') })
    expect(s.json().secret['clientAdmin.temporaryPassword']).toBe('Tmp-Pass-123456')
    expect((await a.inject({ url: `/jobs/${jobId}/secret`, headers: hdr('svc-ops', 'u-olga') })).statusCode).toBe(404)
    expect(fs.readFileSync(path.join(env.root, 'admin', 'audit.log'), 'utf8')).not.toContain('Tmp-Pass')
  })
})

describe('reprise au démarrage (S2-3, S2-5)', () => {
  it('travail running dont le processus a disparu → interrupted, audit', async () => {
    const env = setupRoot()
    const store = new JobStore(env.root)
    const id = ulid()
    store.create({
      id,
      operation: 'backup.run',
      instance: 'acme',
      actor: { login: 'alice', instance: 'acme' },
      origin: 'ui',
      state: 'running',
      createdAt: new Date().toISOString(),
      steps: [],
      cancellable: true,
      logSize: 0,
      argv: ['instance', 'backup', 'acme'],
      pid: 999_999,
      bootId: 'autre-demarrage',
    })
    const a = start(env)
    const job = (await a.inject({ url: `/jobs/${id}`, headers: hdr('svc-acme', 'u-alice') })).json()
    expect(job.state).toBe('interrupted')
    expect(auditLines(env.root).pop()).toMatchObject({ jobId: id, result: 'interrupted' })
    // Le créneau mutant est libre.
    expect((await post(a, { operation: 'backup.run' })).statusCode).toBe(202)
  })
})
