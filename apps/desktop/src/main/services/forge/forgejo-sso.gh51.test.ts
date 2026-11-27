import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'

import {
  authorizeUrl, exchangeCode, newPkcePair, newState, OAuthTokenError, refreshTokens, SSO_TIMEOUT_MS,
} from './forgejo-sso'
import { startFakeForge } from './fake-forge.test-util'

describe('PKCE et état (GH51)', () => {
  it('vecteur RFC 7636 : challenge S256 du verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('verifier de 43 caractères, challenge S256 cohérent, états distincts', () => {
    const a = newPkcePair()
    const b = newPkcePair()
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.challenge).toBe(createHash('sha256').update(a.verifier).digest('base64url'))
    expect(a.verifier).not.toBe(b.verifier)
    expect(newState()).not.toBe(newState())
    expect(newState().length).toBeGreaterThanOrEqual(16)
  })

  it('délai de connexion au navigateur : 5 minutes (D6)', () => {
    expect(SSO_TIMEOUT_MS).toBe(5 * 60_000)
  })
})

describe('URL d’autorisation', () => {
  it('porte les paramètres PKCE et la redirection loopback, sans scope ni secret', () => {
    const url = new URL(authorizeUrl({
      baseUrl: 'https://forge.acme.fr', clientId: 'polenta-client', redirectUri: 'http://127.0.0.1:51234/callback',
      state: 'etat-1', challenge: 'defi-1',
    }))
    expect(url.origin + url.pathname).toBe('https://forge.acme.fr/login/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'polenta-client',
      redirect_uri: 'http://127.0.0.1:51234/callback',
      state: 'etat-1',
      code_challenge: 'defi-1',
      code_challenge_method: 'S256',
    })
  })
})

describe('échanges avec la forge', () => {
  it('échange du code : grant, verifier, client public, pas de secret ; jetons et expiration lus', async () => {
    const forge = await startFakeForge()
    try {
      forge.route('POST', '/login/oauth/access_token', () => ({
        status: 200, json: { access_token: 'a-1', refresh_token: 'r-1', expires_in: 3600, token_type: 'bearer' },
      }))
      const before = Date.now()
      const tokens = await exchangeCode({
        baseUrl: forge.baseUrl, clientId: 'polenta-client', redirectUri: 'http://127.0.0.1:51234/callback',
        code: 'code-1', verifier: 'verif-1',
      })
      expect(tokens.accessToken).toBe('a-1')
      expect(tokens.refreshToken).toBe('r-1')
      expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600_000)
      expect(tokens.expiresAt).toBeLessThanOrEqual(Date.now() + 3600_000)

      const req = forge.requests.at(-1)!
      expect(req.method).toBe('POST')
      expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded')
      const form = new URLSearchParams(req.body)
      expect(Object.fromEntries(form)).toEqual({
        grant_type: 'authorization_code', code: 'code-1', client_id: 'polenta-client',
        redirect_uri: 'http://127.0.0.1:51234/callback', code_verifier: 'verif-1',
      })
      expect(form.has('client_secret')).toBe(false)
    } finally {
      await forge.close()
    }
  })

  it('renouvellement : grant refresh_token, sans refresh token renvoyé → pas de refreshToken', async () => {
    const forge = await startFakeForge()
    try {
      forge.route('POST', '/login/oauth/access_token', () => ({ status: 200, json: { access_token: 'a-2' } }))
      const tokens = await refreshTokens({ baseUrl: forge.baseUrl, clientId: 'polenta-client', refreshToken: 'r-1' })
      expect(tokens).toEqual({ accessToken: 'a-2' })
      expect(Object.fromEntries(new URLSearchParams(forge.requests.at(-1)!.body))).toEqual({
        grant_type: 'refresh_token', refresh_token: 'r-1', client_id: 'polenta-client',
      })
    } finally {
      await forge.close()
    }
  })

  it('verifier faux (PKCE) : refus 400 → OAuthTokenError, sans jeton', async () => {
    const forge = await startFakeForge()
    try {
      forge.route('POST', '/login/oauth/access_token', () => ({
        status: 400, json: { error: 'invalid_grant', error_description: 'PKCE verification failed' },
      }))
      const err = await exchangeCode({
        baseUrl: forge.baseUrl, clientId: 'polenta-client', redirectUri: 'http://127.0.0.1:1/callback',
        code: 'code-1', verifier: 'mauvais',
      }).catch(e => e)
      expect(err).toBeInstanceOf(OAuthTokenError)
      expect(err).toMatchObject({ status: 400, oauthError: 'invalid_grant' })
    } finally {
      await forge.close()
    }
  })

  it('réponse sans access_token : OAuthTokenError', async () => {
    const forge = await startFakeForge()
    try {
      forge.route('POST', '/login/oauth/access_token', () => ({ status: 200, json: { token_type: 'bearer' } }))
      await expect(refreshTokens({ baseUrl: forge.baseUrl, clientId: 'c', refreshToken: 'r' })).rejects.toBeInstanceOf(OAuthTokenError)
    } finally {
      await forge.close()
    }
  })
})
