import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import { buildServer, type BuiltServer } from './app'
import { loadConfig, type WebConfig } from './config'

let base: string
let server: BuiltServer
let app: FastifyInstance
let cookie = ''
let csrf = ''

function config(dataDir: string): WebConfig {
  return {
    port: 0, host: '127.0.0.1', dataDir, staticDir: null, resourcesDir: dataDir,
    sessionSecret: 'test-secret-0123456789-0123456789', sessionHours: 1, idleMinutes: 30, maxUploadMb: 1, maxActiveUsers: 50,
    secureCookies: false, gitHosts: ['git.example.org'], gitAllowHttp: false,
    auth: { mode: 'dev', login: 'alice', name: 'Alice', email: 'alice@example.org', remote: 'https://git.example.org', token: 'tok-secret' },
    machineConfig: { defaultServer: 'https://git.example.org', hideGithub: true },
  }
}

async function rpc(channel: string, args: unknown[], opts: { csrf?: string | null; cookie?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', cookie: opts.cookie ?? cookie }
  const token = opts.csrf === undefined ? csrf : opts.csrf
  if (token !== null) headers['x-polenta-csrf'] = token
  return app.inject({ method: 'POST', url: `/rpc/${channel}`, headers, payload: { args } })
}

beforeAll(async () => {
  process.env['POLENTA_WEB_LOG_LEVEL'] = 'silent'
  base = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-web-'))
  server = await buildServer(config(base), '9.9.9')
  app = server.app
  const login = await app.inject({ method: 'GET', url: '/auth/login' })
  expect(login.statusCode).toBe(302)
  const cookies = login.cookies as Array<{ name: string; value: string }>
  cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  csrf = cookies.find(c => c.name === 'polenta_csrf')!.value
})

afterAll(async () => {
  await app.close()
  await fsP.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('session et RPC', () => {
  it('cookie de session HttpOnly, jeton forge jamais exposé (AC 1)', async () => {
    const login = await app.inject({ method: 'GET', url: '/auth/login' })
    const sid = (login.cookies as Array<{ name: string; httpOnly?: boolean; value: string }>).find(c => c.name === 'polenta_sid')!
    expect(sid.httpOnly).toBe(true)
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })
    expect(me.json()).toMatchObject({ login: 'alice', name: 'Alice' })
    expect(me.body).not.toContain('tok-secret')
    const accounts = await fsP.readFile(path.join(base, 'users', 'alice', 'userData', 'auth.json'), 'utf-8')
    expect(accounts).not.toContain('tok-secret')
  })

  it('appel nominal', async () => {
    const res = await rpc('web:workspaces-root', [])
    expect(res.statusCode).toBe(200)
    expect(res.json().value).toBe(path.join(base, 'users', 'alice', 'workspaces'))
    expect((await rpc('app:get-version', [])).json().value).toBe('9.9.9')
  })

  it('channels masqués, desktop-only ou inconnus → 404 (S2-13)', async () => {
    for (const ch of ['auth:get-token', 'dialog:pick-folder', 'update:install', 'export:open-file', 'nope:x']) {
      expect((await rpc(ch, ['https://git.example.org'])).statusCode).toBe(404)
    }
  })

  it('sans session → 401, sans CSRF ou CSRF erroné → 403 (S2-14)', async () => {
    expect((await rpc('web:workspaces-root', [], { cookie: '' })).statusCode).toBe(401)
    expect((await rpc('web:workspaces-root', [], { csrf: null })).statusCode).toBe(403)
    expect((await rpc('web:workspaces-root', [], { csrf: 'faux' })).statusCode).toBe(403)
  })

  it('chemin hors de l\'espace → 403 sans appel du handler (AC 5)', async () => {
    const res = await rpc('web:delete-workspace', [path.join(base, 'users', 'bob', 'workspaces', 'x'), true])
    expect(res.statusCode).toBe(403)
  })

  it('erreur métier : message seul, sans pile (S2-15)', async () => {
    const outside = path.join(base, 'users', 'alice', 'workspaces')
    const res = await rpc('web:delete-workspace', [outside])
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(false)
    expect(typeof body.error.message).toBe('string')
    expect(JSON.stringify(body)).not.toMatch(/\bat .+:\d+:\d+/)
  })

  it('arguments undefined restaurés (paramètres par défaut), null conservé', async () => {
    const rt = await server.pool.get('alice')
    const original = rt.handlers.get('web:workspaces-root')!
    rt.handlers.set('web:workspaces-root', (_e, a: unknown, b: unknown) => [a === undefined, b === null])
    try {
      const res = await app.inject({
        method: 'POST', url: '/rpc/web:workspaces-root',
        headers: { 'content-type': 'application/json', cookie, 'x-polenta-csrf': csrf },
        payload: { args: [null, null], undefinedArgs: [0] },
      })
      expect(res.json().value).toEqual([true, true])
    } finally {
      rt.handlers.set('web:workspaces-root', original)
    }
  })

  it('nouveau dossier de projet puis liste « Mes projets »', async () => {
    const dir = (await rpc('web:new-workspace-dir', ['Mon Projet é'])).json().value as string
    expect(path.dirname(dir)).toBe(path.join(base, 'users', 'alice', 'workspaces'))
    expect(path.basename(dir)).toBe('Mon-Projet-e')
    const dir2 = (await rpc('web:new-workspace-dir', ['Mon Projet é'])).json().value as string
    expect(dir2).not.toBe(dir)
    expect((await rpc('web:list-workspaces', [])).json().value).toEqual([]) // dossiers vides : pas des workspaces
    expect((await rpc('web:delete-workspace', [dir, true])).json().value).toEqual({ status: 'deleted' })
  })
})

describe('upload et download', () => {
  async function upload(name: string, content: Buffer) {
    const boundary = '----polenta'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    return app.inject({
      method: 'POST', url: '/upload', payload: body,
      headers: { cookie, 'x-polenta-csrf': csrf, 'content-type': `multipart/form-data; boundary=${boundary}` },
    })
  }

  it('upload accepté puis import d\'image dans un repo de l\'utilisateur', async () => {
    const res = await upload('logo.png', Buffer.from('png'))
    expect(res.statusCode).toBe(200)
    const { uploadId, fileName } = res.json().value
    expect(fileName).toBe('logo.png')
    const repo = path.join(base, 'users', 'alice', 'workspaces', 'p', 'repo')
    await fsP.mkdir(repo, { recursive: true })
    const imported = (await rpc('web:image-import', [repo, uploadId])).json().value
    expect(imported).toEqual({ status: 'ok', path: 'images/logo.png', copied: true })
  })

  it('extension refusée → 415, trop gros → 413 (S2-16)', async () => {
    expect((await upload('script.exe', Buffer.from('x'))).statusCode).toBe(415)
    expect((await upload('big.png', Buffer.alloc(1024 * 1024 + 10))).statusCode).toBe(413)
  })

  it('upload sans CSRF → 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/upload', payload: '--b\r\n\r\n--b--\r\n',
      headers: { cookie, 'content-type': 'multipart/form-data; boundary=b' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('download à usage unique, réservé à son utilisateur (S2-17)', async () => {
    const rt = await server.pool.get('alice')
    const target = await rt.downloads.create('rapport été.xlsx')
    await fsP.writeFile(target.filePath, 'data')
    const res = await app.inject({ method: 'GET', url: `/download/${target.id}`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''rapport%20%C3%A9t%C3%A9.xlsx")
    const quoted = await rt.downloads.create("Matrice d'exigences (v2).xlsx")
    await fsP.writeFile(quoted.filePath, 'x')
    const res2 = await app.inject({ method: 'GET', url: `/download/${quoted.id}`, headers: { cookie } })
    expect(res2.headers['content-disposition']).toContain("filename*=UTF-8''Matrice%20d%27exigences%20%28v2%29.xlsx")
    expect(res.body).toBe('data')
    await new Promise(r => setTimeout(r, 50))
    expect((await app.inject({ method: 'GET', url: `/download/${target.id}`, headers: { cookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/download/${target.id}` })).statusCode).toBe(401)
  })
})

describe('configuration', () => {
  it('mode dev refusé en production (S2-19)', () => {
    const saved = { ...process.env }
    process.env['NODE_ENV'] = 'production'
    process.env['POLENTA_WEB_DEV_LOGIN'] = 'alice'
    try {
      expect(() => loadConfig(base)).toThrow(/production/)
    } finally {
      process.env = saved
    }
  })
})
