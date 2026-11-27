import { describe, expect, it } from 'vitest'

import { forgeRequest } from './forge-http'
import { startFakeForge } from './fake-forge.test-util'

describe('forgeRequest — corps de formulaire (GH51)', () => {
  it('option form : corps application/x-www-form-urlencoded, valeurs encodées', async () => {
    const forge = await startFakeForge()
    try {
      forge.route('POST', '/login/oauth/access_token', () => ({ status: 200, json: { ok: true } }))
      await forgeRequest(`${forge.baseUrl}/login/oauth/access_token`, {
        method: 'POST', form: { code_verifier: 'a b&c=d', grant_type: 'authorization_code' },
      })
      const req = forge.requests.at(-1)!
      expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded')
      expect(new URLSearchParams(req.body).get('code_verifier')).toBe('a b&c=d')
      expect(req.body).toBe('code_verifier=a+b%26c%3Dd&grant_type=authorization_code')
    } finally {
      await forge.close()
    }
  })

  it('sans form ni json : aucun Content-Type de formulaire', async () => {
    const forge = await startFakeForge()
    try {
      forge.route('GET', '/api/v1/user', () => ({ status: 200, json: { login: 'bob' } }))
      await forgeRequest(`${forge.baseUrl}/api/v1/user`, { token: 't' })
      expect(forge.requests.at(-1)!.headers['content-type']).toBeUndefined()
    } finally {
      await forge.close()
    }
  })
})
