import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { PoolFullError, UserPool } from './user-pool'
import { SessionTokenStore } from './web-host'
import { OidcTokenError, type OidcTokens } from './auth/oidc'
import { loadConfig } from './config'

let base: string
beforeAll(async () => { base = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-pool-')) })
afterAll(async () => { await fsP.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })

function pool(maxActiveUsers?: number) {
  return new UserPool({
    dataDir: base, resourcesDir: base, idleMinutes: 30, version: '0', maxActiveUsers,
    machineConfig: { hideGithub: true },
  })
}

describe('UserPool (design §5.3)', () => {
  it('S3-12 — création concurrente pour le même login : un seul conteneur', async () => {
    const p = pool()
    const [a, b, c] = await Promise.all([p.get('alice'), p.get('alice'), p.get('alice')])
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(p.activeLogins()).toEqual(['alice'])
    p.disposeAll()
  })

  it('S3-13 — plafond atteint : libère le moins récemment utilisé sans vue ouverte', async () => {
    const p = pool(2)
    const a = await p.get('alice')
    await p.get('bob')
    a.lastSeen = 0 // le plus ancien
    await p.get('carol')
    expect(p.activeLogins().sort()).toEqual(['bob', 'carol'])
    p.disposeAll()
  })

  it('S3-13 — plafond atteint et toutes les vues ouvertes : refus explicite (503)', async () => {
    const p = pool(1)
    const a = await p.get('alice')
    a.sockets.add({ send: () => {}, close: () => {} })
    await expect(p.get('bob')).rejects.toBeInstanceOf(PoolFullError)
    expect(p.activeLogins()).toEqual(['alice'])
    p.disposeAll()
  })

  it('plafond atteint : un utilisateur actif il y a moins d\'une minute n\'est pas évincé (503)', async () => {
    const p = pool(1)
    await p.get('erin') // lastSeen = maintenant, aucune vue ouverte
    await expect(p.get('frank')).rejects.toBeInstanceOf(PoolFullError)
    expect(p.activeLogins()).toEqual(['erin'])
    p.disposeAll()
  })

  it('révocation : jetons effacés, vues prévenues puis fermées, conteneur et fichiers conservés', async () => {
    const p = pool()
    const rt = await p.get('dave')
    await p.tokenStore('dave').set('forge.test', 'secret')
    const sent: string[] = []
    const closed: number[] = []
    rt.sockets.add({ send: m => sent.push(m), close: code => closed.push(code ?? 0) })
    p.revoke('dave')
    expect(await p.tokenStore('dave').get('forge.test')).toBeNull()
    expect(sent).toEqual([JSON.stringify({ channel: 'auth:session-revoked', args: [] })])
    expect(closed).toEqual([4402])
    expect(rt.sockets.size).toBe(0)
    expect(await fsP.stat(rt.dirs.workspaces).then(() => true)).toBe(true)
    p.disposeAll()
  })
})

describe('configuration oidc', () => {
  const saved = { ...process.env }
  const oidcEnv = {
    POLENTA_WEB_AUTH: 'oidc',
    POLENTA_WEB_DEFAULT_SERVER: 'https://acme.forge.example/',
    POLENTA_WEB_OIDC_CLIENT_ID: 'id',
    POLENTA_WEB_OIDC_CLIENT_SECRET: 'secret',
    POLENTA_WEB_PUBLIC_URL: 'https://web.acme.forge.example',
  }

  function load(extra: Record<string, string>) {
    process.env = { ...saved, ...oidcEnv, ...extra }
    try {
      return loadConfig(base)
    } finally {
      process.env = { ...saved }
    }
  }

  it('secret de session absent ou trop court refusé ; cookies Secure par défaut en https', () => {
    expect(() => load({})).toThrow(/POLENTA_WEB_SESSION_SECRET/)
    expect(() => load({ POLENTA_WEB_SESSION_SECRET: 'court' })).toThrow(/32 caractères/)
    const config = load({ POLENTA_WEB_SESSION_SECRET: 'x'.repeat(40), NODE_ENV: 'production' })
    expect(config.auth).toMatchObject({ mode: 'oidc', forgeUrl: 'https://acme.forge.example' })
    expect(config.secureCookies).toBe(true)
    expect(config.gitHosts).toEqual(['acme.forge.example'])
    expect(config.machineConfig.defaultServer).toBe('https://acme.forge.example')
  })
})

describe('SessionTokenStore (OIDC)', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  it('reconnexion pendant un rafraîchissement refusé : les nouveaux jetons ne sont pas révoqués', async () => {
    const pending = deferred<OidcTokens>()
    let revoked = 0
    const store = new SessionTokenStore(() => pending.promise, () => { revoked++ })
    store.setOAuth('forge.test', 'alice', { accessToken: 'OLD', refreshToken: 'R1', expiresAt: Date.now() + 10_000 })
    const inFlight = store.freshAccessToken() // rafraîchissement lancé (expire dans < 1 min)
    store.setOAuth('forge.test', 'alice', { accessToken: 'NEW', refreshToken: 'R2', expiresAt: Date.now() + 3_600_000 })
    pending.reject(new OidcTokenError(400, 'invalid_grant'))
    expect(await inFlight).toBe('NEW')
    expect(revoked).toBe(0)
    expect(await store.get('forge.test')).toBe('NEW')
    expect(store.epoch).toBe(2)
  })

  it('rafraîchissement refusé pour les jetons courants : révocation et erreur d\'accès 401', async () => {
    let revoked = 0
    const store = new SessionTokenStore(() => Promise.reject(new OidcTokenError(400, 'invalid_grant')), () => { revoked++ })
    store.setOAuth('forge.test', 'alice', { accessToken: 'A', refreshToken: 'R', expiresAt: Date.now() + 10_000 })
    await expect(store.freshAccessToken()).rejects.toThrow(/forge-access/)
    expect(revoked).toBe(1)
    expect(store.hasOAuth()).toBe(false)
  })

  it('les jetons OAuth ne sont pas recopiés dans la table générique', async () => {
    const store = new SessionTokenStore()
    store.setOAuth('forge.test', 'alice', { accessToken: 'A' })
    await store.set('forge.test', 'COPIE')
    expect(await store.get('forge.test')).toBe('A')
    store.clear()
    expect(await store.get('forge.test')).toBeNull()
  })
})
