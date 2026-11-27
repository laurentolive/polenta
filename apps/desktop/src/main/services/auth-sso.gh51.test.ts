import { createHash } from 'crypto'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MachineConfig } from '@polenta/types'
import { AuthService } from './auth.service'
import type { HostContext, TokenStore } from '../host/host-context'
import { SIGNED_IN_ONLY, startFakeForge, type FakeForge, type FakeRequest } from './forge/fake-forge.test-util'
import { SsoLoginError } from './forge/forgejo-sso'

class MapTokenStore implements TokenStore {
  readonly map = new Map<string, string>()
  async get(k: string) { return this.map.get(k) ?? null }
  async set(k: string, v: string) { this.map.set(k, v) }
  async delete(k: string) { return this.map.delete(k) }
}

/** Ce que le faux serveur de forge accepte : l'état de l'échange en cours. */
const flow = { challenge: '', refreshStatus: 200, omitRefresh: false, identityOk: true, refreshCount: 0 }
const VALID_ACCESS = new Set(['sso-access-1', 'sso-access-2', 'pat-xyz'])

let dir: string
let tokens: MapTokenStore
let forge: FakeForge
let machine: MachineConfig
let open: (url: string) => Promise<void>
let opened: URL[]

function sha256Base64url(s: string): string {
  return createHash('sha256').update(s).digest('base64url')
}

/** Navigateur simulé : enregistre l'URL d'autorisation, puis renvoie le retour choisi par le test. */
function browserReturns(back: (auth: URL) => Record<string, string>): (url: string) => Promise<void> {
  return async (url: string) => {
    const auth = new URL(url)
    opened.push(auth)
    flow.challenge = auth.searchParams.get('code_challenge') ?? ''
    const target = new URL(auth.searchParams.get('redirect_uri') ?? '')
    target.search = new URLSearchParams(back(auth)).toString()
    void fetch(target).catch(() => undefined)
  }
}

const goodReturn = (auth: URL) => ({ code: 'good-code', state: auth.searchParams.get('state') ?? '' })

/** Routes d'une forge Forgejo : détection, échange, renouvellement, identité. */
function installForgejo(): void {
  forge.route('GET', '/api/v1/version', () => SIGNED_IN_ONLY)
  forge.route('GET', '/api/forgejo/v1/version', () => SIGNED_IN_ONLY)
  forge.route('POST', '/login/oauth/access_token', req => {
    const form = new URLSearchParams(req.body)
    if (form.get('grant_type') === 'authorization_code') {
      const pkceOk = form.has('code_verifier') && sha256Base64url(form.get('code_verifier') ?? '') === flow.challenge
      if (form.get('code') !== 'good-code' || !pkceOk) return { status: 400, json: { error: 'invalid_grant' } }
      return { status: 200, json: { access_token: 'sso-access-1', refresh_token: 'sso-refresh-1', expires_in: 3600, token_type: 'bearer' } }
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (flow.refreshStatus !== 200) {
        return flow.refreshStatus < 500 ? { status: flow.refreshStatus, json: { error: 'invalid_grant' } } : { status: flow.refreshStatus, json: { message: 'erreur' } }
      }
      if (form.get('refresh_token') !== 'sso-refresh-1' && form.get('refresh_token') !== 'sso-refresh-2') return { status: 400, json: { error: 'invalid_grant' } }
      flow.refreshCount++
      return { status: 200, json: { access_token: 'sso-access-2', ...(flow.omitRefresh ? {} : { refresh_token: 'sso-refresh-2' }), expires_in: 3600 } }
    }
    return { status: 400, json: { error: 'unsupported_grant_type' } }
  })
  forge.route('GET', '/api/v1/user', req => {
    const token = (req.headers.authorization ?? '').replace(/^token /, '')
    if (!flow.identityOk || !VALID_ACCESS.has(token)) return { status: 401, json: { message: 'invalid token' } }
    return { status: 200, json: { login: 'bob', full_name: 'Bob Martin', email: 'bob@acme.fr' } }
  })
}

function makeAuth(): AuthService {
  const host: HostContext = {
    userDataDir: dir,
    tokenStore: tokens,
    machineConfig: machine,
    deviceLabel: 'PC-Test 01',
    openExternal: url => open(url),
  }
  return new AuthService(host)
}

const forgeHost = () => new URL(forge.baseUrl).hostname
const isTokenRequest = (r: FakeRequest) => r.path === '/login/oauth/access_token'

async function waitUntil(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('délai dépassé')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-sso-'))
  tokens = new MapTokenStore()
  forge = await startFakeForge()
  machine = { hideGithub: false, defaultServer: forge.baseUrl, forgeSsoClientId: 'polenta-client' }
  flow.challenge = ''
  flow.refreshStatus = 200
  flow.omitRefresh = false
  flow.identityOk = true
  flow.refreshCount = 0
  opened = []
  open = browserReturns(goodReturn)
  installForgejo()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await forge.close()
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('connexion au navigateur (GH51)', () => {
  it('ouvre la page d’autorisation : PKCE S256, redirection loopback, sans scope', async () => {
    await makeAuth().ssoLogin(forge.baseUrl)
    expect(opened).toHaveLength(1)
    const auth = opened[0]
    expect(auth.origin + auth.pathname).toBe(`${forge.baseUrl}/login/oauth/authorize`)
    expect(auth.searchParams.get('response_type')).toBe('code')
    expect(auth.searchParams.get('client_id')).toBe('polenta-client')
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    expect(auth.searchParams.get('code_challenge')).toHaveLength(43)
    expect(auth.searchParams.get('state')!.length).toBeGreaterThanOrEqual(16)
    expect(auth.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(auth.searchParams.has('scope')).toBe(false)
  })

  it('enregistre le compte : jetons, renouvellement, identité vérifiée ; rien de secret dans auth.json', async () => {
    const account = await makeAuth().ssoLogin(forge.baseUrl)
    const h = forgeHost()
    expect(account).toEqual({
      key: `${h}:bob`, provider: 'forgejo', baseUrl: forge.baseUrl, host: h, login: 'bob', name: 'Bob Martin', email: 'bob@acme.fr',
    })
    expect(tokens.map.get(`${h}:bob`)).toBe('sso-access-1')
    expect(tokens.map.get(h)).toBe('sso-access-1')
    expect(JSON.parse(tokens.map.get(`${h}:bob#sso`)!)).toEqual({
      clientId: 'polenta-client', refreshToken: 'sso-refresh-1', expiresAt: expect.any(Number),
    })
    const authJson = await fsP.readFile(path.join(dir, 'auth.json'), 'utf-8')
    expect(authJson).not.toMatch(/sso-/)
  })

  it('échange : verifier, client public, pas de secret ; port de retour fermé ensuite', async () => {
    const redirect = { uri: '' }
    open = browserReturns(auth => { redirect.uri = auth.searchParams.get('redirect_uri') ?? ''; return goodReturn(auth) })
    await makeAuth().ssoLogin(forge.baseUrl)
    const exchange = forge.requests.find(isTokenRequest)!
    const form = new URLSearchParams(exchange.body)
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('client_id')).toBe('polenta-client')
    expect(form.get('redirect_uri')).toBe(redirect.uri)
    expect(form.has('code_verifier')).toBe(true)
    expect(form.has('client_secret')).toBe(false)
    await expect(fetch(redirect.uri)).rejects.toThrow()
  })

  it('état absent ou différent : refusé avant tout échange, rien enregistré', async () => {
    for (const back of [
      () => ({ code: 'good-code', state: 'autre' }),
      () => ({ code: 'good-code' }),
    ]) {
      open = browserReturns(back)
      await expect(makeAuth().ssoLogin(forge.baseUrl)).rejects.toMatchObject({ code: 'state' })
    }
    expect(forge.requests.some(isTokenRequest)).toBe(false)
    expect(tokens.map.size).toBe(0)
  })

  it('accès refusé dans le navigateur : denied, aucun compte', async () => {
    open = browserReturns(auth => ({ error: 'access_denied', state: auth.searchParams.get('state') ?? '' }))
    await expect(makeAuth().ssoLogin(forge.baseUrl)).rejects.toMatchObject({ code: 'denied' })
    expect(tokens.map.size).toBe(0)
  })

  it('retour sans code : no-code, aucun compte', async () => {
    open = browserReturns(auth => ({ state: auth.searchParams.get('state') ?? '' }))
    await expect(makeAuth().ssoLogin(forge.baseUrl)).rejects.toMatchObject({ code: 'no-code' })
    expect(tokens.map.size).toBe(0)
  })

  it('code refusé par la forge : exchange, aucun compte', async () => {
    open = browserReturns(auth => ({ code: 'bad-code', state: auth.searchParams.get('state') ?? '' }))
    await expect(makeAuth().ssoLogin(forge.baseUrl)).rejects.toMatchObject({ code: 'exchange' })
    expect(forge.requests.some(isTokenRequest)).toBe(true)
    expect(tokens.map.size).toBe(0)
  })

  it('identité non vérifiable : identity, rien n’est enregistré', async () => {
    flow.identityOk = false
    const auth = makeAuth()
    await expect(auth.ssoLogin(forge.baseUrl)).rejects.toMatchObject({ code: 'identity' })
    expect(tokens.map.size).toBe(0)
    expect(await auth.forgeAccounts()).toEqual([])
  })

  it('sans client configuré : not-configured, aucun navigateur ouvert', async () => {
    machine = { hideGithub: false, defaultServer: forge.baseUrl }
    await expect(makeAuth().ssoLogin(forge.baseUrl)).rejects.toMatchObject({ code: 'not-configured' })
    expect(opened).toHaveLength(0)
  })

  it('serveur différent de defaultServer : not-configured', async () => {
    await expect(makeAuth().ssoLogin('https://autre.exemple.fr')).rejects.toMatchObject({ code: 'not-configured' })
    expect(opened).toHaveLength(0)
  })

  it('serveur qui n’est pas Forgejo : not-a-forge, aucun navigateur ouvert', async () => {
    await forge.close()
    forge = await startFakeForge()
    machine = { hideGithub: false, defaultServer: forge.baseUrl, forgeSsoClientId: 'polenta-client' }
    await expect(makeAuth().ssoLogin(forge.baseUrl)).rejects.toMatchObject({ code: 'not-a-forge' })
    expect(opened).toHaveLength(0)
  })

  it('annulation pendant l’attente : cancelled, aucun compte', async () => {
    open = async url => { opened.push(new URL(url)) }
    const auth = makeAuth()
    const login = auth.ssoLogin(forge.baseUrl)
    await waitUntil(() => opened.length === 1)
    auth.ssoCancel()
    await expect(login).rejects.toMatchObject({ code: 'cancelled' })
    expect(tokens.map.size).toBe(0)
  })

  it('une deuxième connexion annule la première', async () => {
    open = async url => { opened.push(new URL(url)) }
    const auth = makeAuth()
    const first = auth.ssoLogin(forge.baseUrl)
    await waitUntil(() => opened.length === 1)
    open = browserReturns(goodReturn)
    const second = auth.ssoLogin(forge.baseUrl)
    await expect(first).rejects.toMatchObject({ code: 'cancelled' })
    await expect(second).resolves.toMatchObject({ login: 'bob' })
  })

  it('erreur de connexion : message fixe, sans code, state ni verifier', async () => {
    open = browserReturns(auth => ({ code: 'bad-code', state: auth.searchParams.get('state') ?? '' }))
    const err = await makeAuth().ssoLogin(forge.baseUrl).then(
      () => { throw new Error('la connexion devait échouer') },
      (e: unknown) => e as SsoLoginError,
    )
    expect(err).toBeInstanceOf(SsoLoginError)
    const verifier = new URLSearchParams(forge.requests.find(isTokenRequest)!.body).get('code_verifier') ?? ''
    expect(err.message).not.toContain('bad-code')
    expect(err.message).not.toContain(verifier)
    expect(err.message).not.toContain(opened[0].searchParams.get('state') ?? '~')
  })

  it('connexion par jeton d’accès après une connexion SSO : le renouvellement est retiré', async () => {
    const auth = makeAuth()
    await auth.ssoLogin(forge.baseUrl)
    expect(tokens.map.has(`${forgeHost()}:bob#sso`)).toBe(true)
    await auth.setup(forge.baseUrl, 'pat-xyz')
    expect(tokens.map.has(`${forgeHost()}:bob#sso`)).toBe(false)
    expect(tokens.map.get(`${forgeHost()}:bob`)).toBe('pat-xyz')
  })

  it('déconnexion : jeton, renouvellement et compte effacés ; auth.json sans trace', async () => {
    const auth = makeAuth()
    const account = await auth.ssoLogin(forge.baseUrl)
    await auth.logout(account.key)
    expect([...tokens.map.keys()].filter(k => k.includes('bob'))).toEqual([])
    expect(tokens.map.has(forgeHost())).toBe(false)
    expect(await auth.forgeAccounts()).toEqual([])
    const authJson = await fsP.readFile(path.join(dir, 'auth.json'), 'utf-8')
    expect(authJson).not.toMatch(/sso-|bob@/)
  })
})

describe('renouvellement du jeton (GH51, AC9, D5)', () => {
  async function loggedIn(): Promise<{ auth: AuthService; key: string; h: string }> {
    const auth = makeAuth()
    const account = await auth.ssoLogin(forge.baseUrl)
    return { auth, key: account.key, h: forgeHost() }
  }

  /** Force l'expiration proche du jeton (dans la marge de 60 s). */
  function expireSoon(h: string, refreshToken = 'sso-refresh-1'): void {
    tokens.map.set(`${h}:bob#sso`, JSON.stringify({ clientId: 'polenta-client', refreshToken, expiresAt: Date.now() + 10_000 }))
  }

  it('jeton proche de l’expiration : renouvelé avant d’être rendu', async () => {
    const { auth, h } = await loggedIn()
    expireSoon(h)
    const current = await auth.accountWithTokenForUrl(forge.baseUrl)
    expect(current?.token).toBe('sso-access-2')
    expect(tokens.map.get(`${h}:bob`)).toBe('sso-access-2')
    expect(tokens.map.get(h)).toBe('sso-access-2')
    expect(JSON.parse(tokens.map.get(`${h}:bob#sso`)!)).toMatchObject({ refreshToken: 'sso-refresh-2' })
    const refresh = forge.requests.filter(isTokenRequest).at(-1)!
    expect(Object.fromEntries(new URLSearchParams(refresh.body))).toEqual({
      grant_type: 'refresh_token', refresh_token: 'sso-refresh-1', client_id: 'polenta-client',
    })
  })

  it('appels concurrents : un seul renouvellement', async () => {
    const { auth, h } = await loggedIn()
    expireSoon(h)
    const results = await Promise.all([1, 2, 3].map(() => auth.accountWithTokenForUrl(forge.baseUrl)))
    expect(results.map(r => r?.token)).toEqual(['sso-access-2', 'sso-access-2', 'sso-access-2'])
    expect(flow.refreshCount).toBe(1)
  })

  it('renouvellement sans nouveau refresh token : l’ancien est conservé', async () => {
    const { auth, h } = await loggedIn()
    flow.omitRefresh = true
    expireSoon(h)
    await auth.accountWithTokenForUrl(forge.baseUrl)
    expect(JSON.parse(tokens.map.get(`${h}:bob#sso`)!)).toMatchObject({ refreshToken: 'sso-refresh-1' })
  })

  it('renouvellement refusé (400) : renouvellement retiré, hôte à reconnecter, jeton périmé rendu', async () => {
    const { auth, h } = await loggedIn()
    flow.refreshStatus = 400
    expireSoon(h)
    const current = await auth.accountWithTokenForUrl(forge.baseUrl)
    expect(current?.token).toBe('sso-access-1')
    expect(tokens.map.has(`${h}:bob#sso`)).toBe(false)
    expect(auth.isAccessRevoked(h)).toBe(true)
  })

  it('erreur 500 de la forge : jeton courant conservé, renouvellement gardé, pas de révocation', async () => {
    const { auth, h } = await loggedIn()
    flow.refreshStatus = 500
    expireSoon(h)
    const current = await auth.accountWithTokenForUrl(forge.baseUrl)
    expect(current?.token).toBe('sso-access-1')
    expect(JSON.parse(tokens.map.get(`${h}:bob#sso`)!)).toMatchObject({ refreshToken: 'sso-refresh-1' })
    expect(auth.isAccessRevoked(h)).toBe(false)
  })

  it('jeton expiré sans refresh token : rendu tel quel, aucun renouvellement tenté', async () => {
    const { auth, h } = await loggedIn()
    tokens.map.delete(`${h}:bob#sso`)
    const current = await auth.accountWithTokenForUrl(forge.baseUrl)
    expect(current?.token).toBe('sso-access-1')
    expect(flow.refreshCount).toBe(0)
  })

  it('après un 401 : renouvellement forcé, nouveau jeton rendu', async () => {
    const { auth, key, h } = await loggedIn()
    const account = (await auth.forgeAccounts())[0]
    expect(account.key).toBe(key)
    expect(await auth.refreshAfterUnauthorized(account)).toBe(true)
    expect(tokens.map.get(`${h}:bob`)).toBe('sso-access-2')
    expect(await auth.freshTokenFor(account)).toBe('sso-access-2')
    expect(flow.refreshCount).toBe(1)
  })

  it('après un 401 sans refresh token : false, pas de renouvellement', async () => {
    const { auth, h } = await loggedIn()
    tokens.map.delete(`${h}:bob#sso`)
    const account = (await auth.forgeAccounts())[0]
    expect(await auth.refreshAfterUnauthorized(account)).toBe(false)
    expect(flow.refreshCount).toBe(0)
  })

  it('après un 401 avec renouvellement refusé : false, hôte à reconnecter', async () => {
    const { auth, h } = await loggedIn()
    flow.refreshStatus = 400
    const account = (await auth.forgeAccounts())[0]
    expect(await auth.refreshAfterUnauthorized(account)).toBe(false)
    expect(auth.isAccessRevoked(h)).toBe(true)
  })
})

describe('journaux (GH51, AC11)', () => {
  it('aucun code, state, verifier ni jeton dans les journaux pendant un flux complet', async () => {
    const logs: unknown[][] = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args) })
    }
    const auth = makeAuth()
    await auth.ssoLogin(forge.baseUrl)
    const verifier = new URLSearchParams(forge.requests.find(isTokenRequest)!.body).get('code_verifier') ?? ''
    const secrets = [verifier, opened[0].searchParams.get('state') ?? '', 'good-code', 'sso-access-1', 'sso-refresh-1']
    const text = JSON.stringify(logs)
    for (const secret of secrets) expect(text).not.toContain(secret)
  })
})
