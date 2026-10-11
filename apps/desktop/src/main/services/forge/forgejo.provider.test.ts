import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAccessToken, detectForge, forgejoProvider, passwordChangeUrl, probeAccess, POLENTA_TOKEN_SCOPES } from './forgejo.provider'
import { ForgeHttpError } from './forge-http'
import { setRemoteGuard } from './remote-guard'
import { startFakeForge, SIGNED_IN_ONLY, type FakeForge } from './fake-forge.test-util'

let forge: FakeForge

beforeEach(async () => { forge = await startFakeForge() })
afterEach(async () => { setRemoteGuard(null); await forge.close() })

const PASSWORD = 'S3cret-Passw0rd!'

describe('detectForge', () => {
  it('Forgejo exigeant la connexion : 403 JSON « signed in » + route /api/forgejo existante', async () => {
    forge.route('GET', '/api/v1/version', () => SIGNED_IN_ONLY)
    forge.route('GET', '/api/forgejo/v1/version', () => SIGNED_IN_ONLY)
    expect(await detectForge(forge.baseUrl)).toEqual({ provider: 'forgejo', flavor: 'forgejo', baseUrl: forge.baseUrl })
  })

  it('Gitea : /api/forgejo/v1/version en 404', async () => {
    forge.route('GET', '/api/v1/version', () => SIGNED_IN_ONLY)
    expect(await detectForge(`${forge.baseUrl}/`)).toMatchObject({ provider: 'forgejo', flavor: 'gitea' })
  })

  it('forge publique : 200 {version}', async () => {
    forge.route('GET', '/api/v1/version', () => ({ status: 200, json: { version: '15.0.9+gitea-1.22.0' } }))
    forge.route('GET', '/api/forgejo/v1/version', () => ({ status: 200, json: { version: '15.0.9' } }))
    expect((await detectForge(forge.baseUrl)).provider).toBe('forgejo')
  })

  it('serveur quelconque (page HTML, 404) → generic', async () => {
    forge.route('GET', '/api/v1/version', () => ({ status: 200, text: '<html></html>', contentType: 'text/html' }))
    expect((await detectForge(forge.baseUrl)).provider).toBe('generic')
  })

  it('github.com → github, sans aucun appel réseau', async () => {
    expect(await detectForge('https://github.com/org/repo')).toEqual({ provider: 'github', baseUrl: 'https://github.com' })
  })
})

describe('createAccessToken (réponses mesurées §6.3)', () => {
  const route = (status: number, message: string) =>
    forge.route('POST', '/api/v1/users/bob/tokens', () => ({ status, json: { message, url: `${forge.baseUrl}/api/swagger` } }))

  it('succès : jeton, Basic Auth, scopes minimaux, nom du jeton', async () => {
    forge.route('POST', '/api/v1/users/bob/tokens', () => ({ status: 201, json: { id: 6, name: 't', sha1: 'abc123', scopes: [] } }))
    expect(await createAccessToken(forge.baseUrl, 'bob', PASSWORD, undefined, 'polenta-poste-20261010-1200'))
      .toEqual({ status: 'ok', token: 'abc123' })
    const req = forge.requests.at(-1)!
    expect(req.headers.authorization).toBe(`Basic ${Buffer.from(`bob:${PASSWORD}`).toString('base64')}`)
    expect(req.headers['x-gitea-otp']).toBeUndefined()
    expect(JSON.parse(req.body)).toEqual({ name: 'polenta-poste-20261010-1200', scopes: [...POLENTA_TOKEN_SCOPES] })
    expect(POLENTA_TOKEN_SCOPES).toContain('write:organization')
  })

  it('code 2FA transmis dans X-Gitea-OTP', async () => {
    forge.route('POST', '/api/v1/users/bob/tokens', () => ({ status: 201, json: { sha1: 'x' } }))
    await createAccessToken(forge.baseUrl, 'bob', PASSWORD, '123456', 'n')
    expect(forge.requests.at(-1)!.headers['x-gitea-otp']).toBe('123456')
  })

  it.each([
    ["user's password is invalid [uid: 18, name: bob]", undefined, 'invalid-credentials'],
    ['user does not exist [uid: 0, name: bob]', undefined, 'invalid-credentials'],
    ['invalid provided OTP', undefined, 'otp-required'],
    ['invalid provided OTP', '000000', 'invalid-otp'],
    ['user is not allowed login [uid: 18, name: bob]', undefined, 'account-disabled'],
    ['invalid username, password or token', undefined, 'invalid-credentials'],   // Gitea : générique
  ])('401 « %s » (code %s) → %s', async (message, otp, expected) => {
    route(401, message)
    expect((await createAccessToken(forge.baseUrl, 'bob', PASSWORD, otp, 'n')).status).toBe(expected)
  })

  it('compte neuf (mot de passe temporaire) : 403 « must change » → URL de la forge, chemins normalisés', async () => {
    forge.route('POST', '/api/v1/users/bob/tokens', () => ({
      status: 403, json: { message: `You must change your password. Change it at: ${forge.baseUrl}//user/change_password` },
    }))
    expect(await createAccessToken(forge.baseUrl, 'bob', PASSWORD, undefined, 'n'))
      .toEqual({ status: 'password-change-required', url: `${forge.baseUrl}/user/change_password` })
  })

  it('URL de changement de mot de passe : Gitea accepté, autre hôte refusé (repli sur la connexion)', () => {
    const base = 'https://gitea.example.fr'
    expect(passwordChangeUrl(`You must change your password. Change it at: ${base}/user/settings/change_password`, base))
      .toBe(`${base}/user/settings/change_password`)
    expect(passwordChangeUrl('You must change your password. Change it at: https://evil.example/x', base))
      .toBe(`${base}/user/login`)
    expect(passwordChangeUrl('no url', base)).toBe(`${base}/user/login`)
  })

  it('le mot de passe n’apparaît dans aucun résultat ni message d’erreur', async () => {
    route(500, 'boom')
    const result = await createAccessToken(forge.baseUrl, 'bob', PASSWORD, undefined, 'n')
    expect(result.status).toBe('network')
    expect(JSON.stringify(result)).not.toContain(PASSWORD)
    expect(JSON.stringify(result)).not.toContain(Buffer.from(`bob:${PASSWORD}`).toString('base64'))
  })

  it('serveur injoignable → network', async () => {
    const url = forge.baseUrl
    await forge.close()
    forge = await startFakeForge()
    expect((await createAccessToken(url, 'bob', PASSWORD, undefined, 'n')).status).toBe('network')
  })
})

describe('identité et sonde d’accès', () => {
  it('identité : full_name, sinon login ; e-mail tel quel', async () => {
    forge.route('GET', '/api/v1/user', () => ({ status: 200, json: { login: 'bob', full_name: 'Bob Martin', email: 'bob@noreply.forge' } }))
    expect(await forgejoProvider.resolveIdentity(forge.baseUrl, 't')).toEqual({ login: 'bob', name: 'Bob Martin', email: 'bob@noreply.forge' })
    expect(forge.requests.at(-1)!.headers.authorization).toBe('token t')
    forge.route('GET', '/api/v1/user', () => ({ status: 200, json: { login: 'bob', full_name: '', email: '' } }))
    expect((await forgejoProvider.resolveIdentity(forge.baseUrl, 't')).name).toBe('bob')
  })

  it('compte désactivé : 403 « prohibited » → revoked ; 401 → revoked ; 200 → ok ; 500 → unknown', async () => {
    forge.route('GET', '/api/v1/user', () => ({ status: 403, json: { message: 'This account is prohibited from signing in, please contact your site administrator.' } }))
    expect(await probeAccess(forge.baseUrl, 't')).toBe('revoked')
    forge.route('GET', '/api/v1/user', () => ({ status: 401, json: { message: 'token is required' } }))
    expect(await probeAccess(forge.baseUrl, 't')).toBe('revoked')
    forge.route('GET', '/api/v1/user', () => ({ status: 200, json: { login: 'bob' } }))
    expect(await probeAccess(forge.baseUrl, 't')).toBe('ok')
    forge.route('GET', '/api/v1/user', () => ({ status: 500, text: 'oops' }))
    expect(await probeAccess(forge.baseUrl, 't')).toBe('unknown')
  })
})

describe('forge-http', () => {
  it('redirection suivie (http → https, hôte canonique) : base = origine finale', async () => {
    const target = await startFakeForge()
    try {
      target.route('GET', '/api/v1/version', () => SIGNED_IN_ONLY)
      target.route('GET', '/api/forgejo/v1/version', () => SIGNED_IN_ONLY)
      forge.route('GET', '/api/v1/version', () => ({ status: 301, text: '', contentType: 'text/html', location: `${target.baseUrl}/api/v1/version` }))
      expect(await detectForge(forge.baseUrl)).toEqual({ provider: 'forgejo', flavor: 'forgejo', baseUrl: target.baseUrl })
    } finally {
      await target.close()
    }
  })

  it('le garde d’URL (web, anti-SSRF) s’applique aussi aux appels d’API', async () => {
    setRemoteGuard(url => { if (url.hostname === '127.0.0.1') throw new Error('hôte non autorisé') })
    await expect(forgejoProvider.resolveIdentity(forge.baseUrl, 't')).rejects.toThrow('hôte non autorisé')
    expect(forge.requests).toHaveLength(0)
  })

  it('ForgeHttpError ne contient ni jeton ni en-têtes', async () => {
    forge.route('GET', '/api/v1/user', () => ({ status: 401, json: { message: 'bad token' } }))
    const err = await forgejoProvider.resolveIdentity(forge.baseUrl, 'tok-SECRET').catch(e => e)
    expect(err).toBeInstanceOf(ForgeHttpError)
    expect(String(err.message)).not.toContain('tok-SECRET')
    expect(err.forgeMessage).toBe('bad token')
  })
})
