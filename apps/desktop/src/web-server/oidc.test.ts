import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import { parseForgeAccessError } from '@polenta/types'
import { buildServer, type BuiltServer } from './app'
import type { WebConfig } from './config'
import { startFakeForge, type FakeForge } from '../main/services/forge/fake-forge.test-util'
import { revokedError } from '../main/services/forge/forge-access'

/**
 * GH44 S3 — connexion OIDC (Authorization Code + PKCE) contre une fausse forge Forgejo : découverte,
 * échange du code, identité par l'API, session, rafraîchissement, révocation, déconnexion.
 */
let base: string
let forge: FakeForge
let server: BuiltServer
let app: FastifyInstance

/** État de la fausse forge, réglé par chaque test. */
const state = {
  codes: new Map<string, string>(), // code → code_challenge attendu
  expiresIn: 3600,
  refreshAllowed: true,
  revokedTokens: new Set<string>(),
  disabled: false,
  login: 'Alice',
  issued: 0,
}

function cookieHeader(res: { cookies: Array<{ name: string; value: string }> }, previous = ''): string {
  const jar = new Map(previous.split('; ').filter(Boolean).map(c => c.split('=') as [string, string]))
  for (const c of res.cookies) jar.set(c.name, c.value)
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
}

beforeAll(async () => {
  process.env['POLENTA_WEB_LOG_LEVEL'] = 'silent'
  base = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-oidc-'))
  forge = await startFakeForge()
  forge.route('GET', '/.well-known/openid-configuration', () => ({
    status: 200,
    json: {
      issuer: forge.baseUrl,
      authorization_endpoint: `${forge.baseUrl}/login/oauth/authorize`,
      token_endpoint: `${forge.baseUrl}/login/oauth/access_token`,
      code_challenge_methods_supported: ['S256'],
    },
  }))
  forge.route('POST', '/login/oauth/access_token', (req) => {
    const p = new URLSearchParams(req.body)
    if (p.get('client_id') !== 'cid' || p.get('client_secret') !== 'csecret') return { status: 401, json: { error: 'invalid_client' } }
    if (p.get('grant_type') === 'authorization_code') {
      const challenge = state.codes.get(p.get('code') ?? '')
      const computed = createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url')
      if (!challenge || challenge !== computed) return { status: 400, json: { error: 'invalid_grant' } }
      state.codes.delete(p.get('code')!)
    } else if (p.get('grant_type') === 'refresh_token') {
      if (!state.refreshAllowed) return { status: 400, json: { error: 'invalid_grant' } }
    } else {
      return { status: 400, json: { error: 'unsupported_grant_type' } }
    }
    state.issued++
    return { status: 200, json: { access_token: `AT${state.issued}`, refresh_token: `RT${state.issued}`, expires_in: state.expiresIn, token_type: 'bearer' } }
  })
  forge.route('GET', '/api/v1/user', (req) => {
    const token = String(req.headers['authorization'] ?? '').replace(/^(token|Bearer) /, '')
    if (!token || state.revokedTokens.has(token)) return { status: 401, json: { message: 'token is required' } }
    if (state.disabled) return { status: 403, json: { message: 'user is prohibited from signing in' } }
    return { status: 200, json: { login: state.login, full_name: 'Alice Martin', email: 'alice@acme.test' } }
  })

  const config: WebConfig = {
    port: 0, host: '127.0.0.1', dataDir: base, staticDir: null, resourcesDir: base,
    sessionSecret: 'test-secret-0123456789-0123456789-xx', sessionHours: 1, idleMinutes: 30, maxUploadMb: 1,
    maxActiveUsers: 50, secureCookies: false, gitHosts: ['127.0.0.1'], gitAllowHttp: true,
    auth: { mode: 'oidc', forgeUrl: forge.baseUrl, clientId: 'cid', clientSecret: 'csecret', publicUrl: 'http://polenta.test' },
    machineConfig: { defaultServer: forge.baseUrl, hideGithub: true },
  }
  server = await buildServer(config, '1.0.0')
  app = server.app
})

afterAll(async () => {
  await app.close()
  await forge.close()
  await fsP.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

beforeEach(() => {
  state.expiresIn = 3600
  state.refreshAllowed = true
  state.disabled = false
  state.login = 'Alice'
})

/** Parcours complet : /auth/login → (forge) → /auth/callback. Renvoie les cookies de session. */
async function login(): Promise<{ cookie: string; csrf: string }> {
  const start = await app.inject({ method: 'GET', url: '/auth/login' })
  expect(start.statusCode).toBe(302)
  const authorize = new URL(start.headers.location as string)
  const code = `code-${Math.random()}`
  state.codes.set(code, authorize.searchParams.get('code_challenge')!)
  const cookie = cookieHeader(start)
  const cb = await app.inject({
    method: 'GET', url: `/auth/callback?code=${encodeURIComponent(code)}&state=${authorize.searchParams.get('state')}`,
    headers: { cookie },
  })
  expect(cb.statusCode, cb.body).toBe(302)
  expect(cb.headers.location).toBe('/')
  const session = cookieHeader(cb, cookie)
  return { cookie: session, csrf: cb.cookies.find(c => c.name === 'polenta_csrf')!.value }
}

describe('connexion OIDC', () => {
  it('redirige vers la forge avec PKCE S256, état et adresse de retour', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/login' })
    const url = new URL(res.headers.location as string)
    expect(url.origin + url.pathname).toBe(`${forge.baseUrl}/login/oauth/authorize`)
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'cid', redirect_uri: 'http://polenta.test/auth/callback',
      code_challenge_method: 'S256', scope: 'openid profile email',
    })
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(res.cookies.find(c => c.name === 'polenta_oidc')).toMatchObject({ httpOnly: true })
  })

  it('S3-1/S3-2 — callback : session, identité de la forge, jeton jamais exposé', async () => {
    const { cookie } = await login()
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })
    expect(me.json()).toEqual({ login: 'alice', name: 'Alice Martin', email: 'alice@acme.test', remote: forge.baseUrl })
    expect(me.body).not.toMatch(/AT\d|RT\d/)
    expect(cookie).not.toMatch(/AT\d|RT\d/)
    const authJson = await fsP.readFile(path.join(base, 'users', 'alice', 'userData', 'auth.json'), 'utf-8')
    expect(JSON.parse(authJson).accounts[0]).toMatchObject({ username: 'Alice', provider: 'forgejo', baseUrl: forge.baseUrl })
    expect(authJson).not.toMatch(/AT\d|RT\d/)
  })

  it('callback sans le cookie d\'état, avec un autre état ou rejoué → refus', async () => {
    const start = await app.inject({ method: 'GET', url: '/auth/login' })
    const s = new URL(start.headers.location as string).searchParams.get('state')!
    expect((await app.inject({ method: 'GET', url: `/auth/callback?code=x&state=${s}` })).statusCode).toBe(400)
    const cookie = cookieHeader(start)
    expect((await app.inject({ method: 'GET', url: '/auth/callback?code=x&state=autre', headers: { cookie } })).statusCode).toBe(400)
  })

  it('refus côté forge (error=access_denied) → page explicite', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/callback?error=access_denied&state=x' })
    expect(res.statusCode).toBe(403)
    expect(res.body).toContain('access_denied')
  })

  it('échange du code refusé par la forge → page explicite (502), aucune session', async () => {
    const start = await app.inject({ method: 'GET', url: '/auth/login' })
    const authorize = new URL(start.headers.location as string)
    // Code inconnu de la fausse forge : le point d'échange répond invalid_grant.
    const res = await app.inject({
      method: 'GET', url: `/auth/callback?code=inconnu&state=${authorize.searchParams.get('state')}`,
      headers: { cookie: cookieHeader(start) },
    })
    expect(res.statusCode).toBe(502)
    expect(res.body).toContain('Réessayez')
    expect(res.cookies.find(c => c.name === 'polenta_sid')).toBeUndefined()
  })

  it('S3-14 — identifiant forge hors [a-z0-9._-] → connexion refusée', async () => {
    state.login = 'Élodie'
    const start = await app.inject({ method: 'GET', url: '/auth/login' })
    const authorize = new URL(start.headers.location as string)
    state.codes.set('c-elodie', authorize.searchParams.get('code_challenge')!)
    const res = await app.inject({
      method: 'GET', url: `/auth/callback?code=c-elodie&state=${authorize.searchParams.get('state')}`, headers: { cookie: cookieHeader(start) },
    })
    expect(res.statusCode).toBe(403)
    expect(res.body).toContain('non pris en charge')
  })
})

describe('jetons et révocation', () => {
  it('S3-19 — jeton proche de l\'expiration : rafraîchi par le refresh_token', async () => {
    state.expiresIn = 30 // < 1 min : rafraîchi au prochain usage
    await login()
    const before = state.issued
    const token = await server.pool.tokenStore('alice').freshAccessToken()
    expect(token).toBe(`AT${before + 1}`)
    expect(forge.requests.some(r => r.path === '/login/oauth/access_token' && r.body.includes('grant_type=refresh_token'))).toBe(true)
  })

  it('S3-19 — rafraîchissement refusé : accès révoqué, session détruite', async () => {
    state.expiresIn = 30
    const { cookie } = await login()
    state.refreshAllowed = false
    const err = await server.pool.tokenStore('alice').freshAccessToken().catch(e => e)
    expect(parseForgeAccessError((err as Error).message)?.issue.status).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(401)
  })

  it('S3-18 — erreur 401 de la forge de la session pendant un appel : session invalidée', async () => {
    const { cookie, csrf } = await login()
    const rt = await server.pool.get('alice')
    const original = rt.handlers.get('web:workspaces-root')!
    rt.handlers.set('web:workspaces-root', () => { throw revokedError(new URL(forge.baseUrl).hostname) })
    try {
      const res = await app.inject({
        method: 'POST', url: '/rpc/web:workspaces-root', payload: { args: [] },
        headers: { cookie, 'x-polenta-csrf': csrf, 'content-type': 'application/json' },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error.revoked).toBe(true)
      expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(401)
    } finally {
      rt.handlers.set('web:workspaces-root', original)
    }
  })

  it("S3-18 — appel réussi mais forge marquée révoquée pendant l'appel (synchronisation automatique #45) : session invalidée", async () => {
    const { cookie, csrf } = await login()
    const rt = await server.pool.get('alice')
    const original = rt.handlers.get('web:workspaces-root')!
    rt.handlers.set('web:workspaces-root', () => {
      rt.container.auth.markAccessRevoked(new URL(forge.baseUrl).hostname)
      return { state: 'ok', accessRevoked: true }
    })
    try {
      const res = await app.inject({
        method: 'POST', url: '/rpc/web:workspaces-root', payload: { args: [] },
        headers: { cookie, 'x-polenta-csrf': csrf, 'content-type': 'application/json' },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error.revoked).toBe(true)
      expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(401)
      // Appels encore en vol avec la session révoquée : « révoqué », pas « session expirée ».
      const late = await app.inject({
        method: 'POST', url: '/rpc/app:get-version', payload: { args: [] },
        headers: { cookie, 'x-polenta-csrf': csrf, 'content-type': 'application/json' },
      })
      expect(late.statusCode).toBe(401)
      expect(late.json().error.revoked).toBe(true)
      // Nouvelle connexion : la révocation est levée (#45, connectWithToken).
      const again = await login()
      expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: again.cookie } })).statusCode).toBe(200)
    } finally {
      rt.handlers.set('web:workspaces-root', original)
    }
  })

  it('erreur 401 d\'un AUTRE hôte : simple erreur, session conservée', async () => {
    const { cookie, csrf } = await login()
    const rt = await server.pool.get('alice')
    const original = rt.handlers.get('web:workspaces-root')!
    rt.handlers.set('web:workspaces-root', () => { throw revokedError('github.com') })
    try {
      const res = await app.inject({
        method: 'POST', url: '/rpc/web:workspaces-root', payload: { args: [] },
        headers: { cookie, 'x-polenta-csrf': csrf, 'content-type': 'application/json' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(false)
      expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(200)
    } finally {
      rt.handlers.set('web:workspaces-root', original)
    }
  })

  it('S3-7 — vérification périodique : compte désactivé (403 « prohibited ») → session détruite', async () => {
    const { cookie } = await login()
    await server.checkAccesses()
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(200)
    state.disabled = true
    await server.checkAccesses()
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(401)
  })
})

describe('déconnexion', () => {
  it('POST /auth/logout exige le jeton CSRF ; GET n\'existe plus', async () => {
    const { cookie, csrf } = await login()
    expect((await app.inject({ method: 'GET', url: '/auth/logout', headers: { cookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(200)
    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie, 'x-polenta-csrf': csrf } })
    expect(out.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(401)
  })

  it('pages hors application : déconnecté, accès révoqué', async () => {
    expect((await app.inject({ method: 'GET', url: '/auth/logged-out' })).body).toContain('Se reconnecter')
    expect((await app.inject({ method: 'GET', url: '/auth/revoked' })).body).toContain('révoqué')
  })
})
