// GH63 — routes /admin/api du serveur web (S4-3, S4-4, S4-7, S4-8, S4-9) contre un faux service.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as fsP from 'fs/promises'
import * as http from 'http'
import * as os from 'os'
import * as path from 'path'
import type { AddressInfo } from 'net'
import { buildServer, type BuiltServer } from '../app'
import { loadAdmin, type WebConfig } from '../config'
import { isExposed } from '../channel-policy'

const SERVICE_TOKEN = 'svc-0123456789-0123456789-0123456789'
let fake: http.Server
let fakeUrl = ''
const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = []

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body })
      if (req.url === '/audit.csv') {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit.csv"' })
        return res.end('ts,actor\n')
      }
      res.writeHead(req.url === '/me' ? 200 : 202, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, url: req.url }))
    })
  })
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', () => r()))
  fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>(r => fake.close(() => r())))

function config(dataDir: string, admin: WebConfig['admin']): WebConfig {
  return {
    port: 0, host: '127.0.0.1', dataDir, staticDir: null, resourcesDir: dataDir,
    sessionSecret: 'test-secret-0123456789-0123456789', sessionHours: 1, idleMinutes: 30, maxUploadMb: 1, maxActiveUsers: 50, print: false,
    secureCookies: false, gitHosts: ['git.example.org'], gitAllowHttp: false,
    auth: { mode: 'dev', login: 'alice', name: 'Alice', email: 'alice@example.org', remote: 'https://git.example.org', token: 'tok-forge-alice' },
    machineConfig: { defaultServer: 'https://git.example.org', hideGithub: true },
    admin,
  }
}

const servers: { server: BuiltServer; dir: string }[] = []
async function start(admin: WebConfig['admin']) {
  process.env['POLENTA_WEB_LOG_LEVEL'] = 'silent'
  const dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-web-admin-'))
  const server = await buildServer(config(dir, admin), '9.9.9')
  servers.push({ server, dir })
  const login = await server.app.inject({ method: 'GET', url: '/auth/login' })
  const cookies = login.cookies as Array<{ name: string; value: string }>
  return {
    app: server.app,
    server,
    cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '),
    csrf: cookies.find(c => c.name === 'polenta_csrf')!.value,
  }
}
afterEach(async () => {
  seen.length = 0
  for (const { server, dir } of servers.splice(0)) {
    await server.app.close()
    await fsP.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('relais /admin/api', () => {
  it('GET /me : jetons de service et utilisateur transmis au service, jamais au navigateur', async () => {
    const { app, cookie } = await start({ url: fakeUrl, serviceToken: SERVICE_TOKEN, dev: true })
    const res = await app.inject({ url: '/admin/api/me', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(seen[0].headers.authorization).toBe(`Bearer ${SERVICE_TOKEN}`)
    expect(seen[0].headers['x-polenta-forge-token']).toBe('tok-forge-alice')
    expect(seen[0].headers['x-polenta-actor']).toBe('alice')
    expect(res.body).not.toContain(SERVICE_TOKEN)
    expect(res.body).not.toContain('tok-forge-alice')
  })

  it('POST /jobs : CSRF exigé (S4-9), corps relayé', async () => {
    const { app, cookie, csrf } = await start({ url: fakeUrl, serviceToken: SERVICE_TOKEN, dev: true })
    const payload = { operation: 'backup.run' }
    expect((await app.inject({ method: 'POST', url: '/admin/api/jobs', headers: { cookie }, payload })).statusCode).toBe(403)
    expect(seen).toHaveLength(0)
    const ok = await app.inject({ method: 'POST', url: '/admin/api/jobs', headers: { cookie, 'x-polenta-csrf': csrf }, payload })
    expect(ok.statusCode).toBe(202)
    expect(JSON.parse(seen[0].body)).toEqual(payload)
  })

  it('sans session : 401 (S4-9)', async () => {
    const { app } = await start({ url: fakeUrl, serviceToken: SERVICE_TOKEN, dev: true })
    expect((await app.inject({ url: '/admin/api/me' })).statusCode).toBe(401)
  })

  it('chemins hors liste et paramètres non prévus : jamais relayés', async () => {
    const { app, cookie } = await start({ url: fakeUrl, serviceToken: SERVICE_TOKEN, dev: true })
    for (const url of ['/admin/api/healthz', '/admin/api/jobs/../../etc', '/admin/api/instances/a%2F..%2Fb', '/admin/api/x']) {
      expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(404)
    }
    expect(seen).toHaveLength(0)
    await app.inject({ url: '/admin/api/jobs?state=running&evil=1', headers: { cookie } })
    expect(seen[0].url).toBe('/jobs?state=running')
  })

  it('export CSV de l\'audit : type et nom de fichier relayés', async () => {
    const { app, cookie } = await start({ url: fakeUrl, serviceToken: SERVICE_TOKEN, dev: true })
    const res = await app.inject({ url: '/admin/api/audit.csv', headers: { cookie } })
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('audit.csv')
  })

  it('service injoignable : 503 propre', async () => {
    const { app, cookie } = await start({ url: 'http://127.0.0.1:1', serviceToken: SERVICE_TOKEN, dev: true })
    const res = await app.inject({ url: '/admin/api/me', headers: { cookie } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe('admin-unreachable')
  })

  it('administration non configurée (ADMIN_UI=off) : 404 ; découverte en 200 sans administration (S4-7)', async () => {
    const { app, cookie } = await start(null)
    expect((await app.inject({ url: '/admin/api/me', headers: { cookie } })).statusCode).toBe(404)
    const status = await app.inject({ url: '/admin/status', headers: { cookie } })
    expect(status.statusCode).toBe(200)
    expect(status.json()).toEqual({ available: false })
  })

  it('découverte : propriétaire → available + niveau ; service injoignable → available false, toujours 200', async () => {
    const ok = await start({ url: fakeUrl, serviceToken: SERVICE_TOKEN, dev: true })
    expect((await ok.app.inject({ url: '/admin/status', headers: { cookie: ok.cookie } })).json()).toMatchObject({ available: true, me: { ok: true } })
    const down = await start({ url: 'http://127.0.0.1:1', serviceToken: SERVICE_TOKEN, dev: true })
    const res = await down.app.inject({ url: '/admin/status', headers: { cookie: down.cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ available: false })
  })

  it("session d'impression : 403 (S4-3)", async () => {
    const { app, server } = await start({ url: fakeUrl, serviceToken: SERVICE_TOKEN, dev: true })
    const print = server.sessions.createPrint({ login: 'alice', name: 'impression', email: '' }, 60_000)
    const cookie = `polenta_sid=${app.signCookie(print.id)}`
    expect((await app.inject({ url: '/admin/api/me', headers: { cookie } })).statusCode).toBe(403)
    expect(seen).toHaveLength(0)
  })
})

describe('configuration (S4-4, S4-8)', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('mode dev : seulement avec POLENTA_WEB_ADMIN_DEV=1, refusé au démarrage en production', () => {
    process.env['POLENTA_ADMIN_URL'] = 'http://polenta-admin:8787'
    process.env['POLENTA_ADMIN_SERVICE_TOKEN'] = SERVICE_TOKEN
    delete process.env['POLENTA_WEB_ADMIN_DEV']
    expect(loadAdmin('dev')).toBeNull()
    expect(loadAdmin('oidc')).toMatchObject({ url: 'http://polenta-admin:8787', dev: false })
    process.env['POLENTA_WEB_ADMIN_DEV'] = '1'
    expect(loadAdmin('dev')).toMatchObject({ dev: true })
    process.env['NODE_ENV'] = 'production'
    expect(() => loadAdmin('dev')).toThrow(/interdit/)
  })

  it('jeton de service trop court refusé ; sans URL, administration absente', () => {
    process.env['POLENTA_ADMIN_URL'] = 'http://polenta-admin:8787'
    process.env['POLENTA_ADMIN_SERVICE_TOKEN'] = 'court'
    expect(() => loadAdmin('oidc')).toThrow(/32/)
    delete process.env['POLENTA_ADMIN_URL']
    expect(loadAdmin('oidc')).toBeNull()
  })

  it('aucun channel admin:* exposé par /rpc (critère 19)', () => {
    for (const ch of ['admin:jobs', 'admin:anything', 'admin:me']) expect(isExposed(ch)).toBe(false)
  })
})
