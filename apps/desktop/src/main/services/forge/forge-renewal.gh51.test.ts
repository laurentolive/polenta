import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthService } from '../auth.service'
import type { SyncService } from '../sync.service'
import type { WorkspaceService } from '../workspace.service'
import type { HostContext, TokenStore } from '../../host/host-context'
import { ForgeService } from './forge.service'
import { ForgeAccessError } from './forge-access'
import { startFakeForge, type FakeForge } from './fake-forge.test-util'

/**
 * GH51 — relance d'un appel forge après un 401 sur un compte connecté au navigateur (AC9, C6) :
 * renouvellement puis une seule relance ; sans renouvellement, la révocation est inchangée.
 */

class MapTokenStore implements TokenStore {
  readonly map = new Map<string, string>()
  async get(k: string) { return this.map.get(k) ?? null }
  async set(k: string, v: string) { this.map.set(k, v) }
  async delete(k: string) { return this.map.delete(k) }
}

const REPO = { full_name: 'bob/notes', name: 'notes', owner: { login: 'bob', username: 'bob' }, description: '', clone_url: 'x', private: false, permissions: { pull: true, push: true, admin: false } }

let dir: string
let forge: FakeForge
let host: string
let tokens: MapTokenStore
let service: ForgeService
/** Jetons acceptés par `/api/v1/user/repos` ; les autres reçoivent 401. */
let accepted: Set<string>
/** Réponse du point de renouvellement (`refresh_token`) : `null` → refus 400. */
let refreshAnswer: { access_token: string; refresh_token?: string } | null

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-renew-'))
  forge = await startFakeForge()
  host = new URL(forge.baseUrl).hostname
  tokens = new MapTokenStore()
  accepted = new Set(['new'])
  refreshAnswer = { access_token: 'new', refresh_token: 'r2' }
  await fsP.writeFile(path.join(dir, 'auth.json'), JSON.stringify({
    accounts: [{ remoteHost: host, username: 'bob', name: 'Bob', email: 'b@x', provider: 'forgejo', baseUrl: forge.baseUrl }],
    defaultAccount: `${host}:bob`,
  }))
  await tokens.set(`${host}:bob`, 'old')
  await tokens.set(host, 'old')
  forge.route('GET', '/api/v1/user/repos', req => {
    const token = (req.headers.authorization ?? '').replace(/^token /, '')
    return accepted.has(token) ? { status: 200, json: [REPO] } : { status: 401, json: { message: 'invalid token' } }
  })
  forge.route('POST', '/login/oauth/access_token', () => refreshAnswer
    ? { status: 200, json: { ...refreshAnswer, expires_in: 3600 } }
    : { status: 400, json: { error: 'invalid_grant' } })
  const ctx: HostContext = { userDataDir: dir, tokenStore: tokens, machineConfig: { hideGithub: false } }
  const auth = new AuthService(ctx)
  service = new ForgeService(auth, {} as WorkspaceService, {} as SyncService)
})

afterEach(async () => {
  await forge.close()
  await fsP.rm(dir, { recursive: true, force: true })
})

/** Compte connecté au navigateur : jeton `old` encore non expiré, refresh token `r1`. */
async function ssoAccount(): Promise<void> {
  await tokens.set(`${host}:bob#sso`, JSON.stringify({
    clientId: 'polenta-client', refreshToken: 'r1', expiresAt: Date.now() + 3600_000,
  }))
}

const repoCalls = () => forge.requests.filter(r => r.path === '/api/v1/user/repos')
const refreshCalls = () => forge.requests.filter(r => r.path === '/login/oauth/access_token')

describe('relance après 401 (GH51)', () => {
  it('compte connecté au navigateur : renouvellement, puis la requête est rejouée et réussit', async () => {
    await ssoAccount()
    const repos = await service.listRepos(`${host}:bob`)
    expect(repos.map(r => r.fullName)).toEqual(['bob/notes'])
    expect(repoCalls().map(r => r.headers.authorization)).toEqual(['token old', 'token new'])
    expect(refreshCalls()).toHaveLength(1)
    expect(tokens.map.get(`${host}:bob`)).toBe('new')
    expect(JSON.parse(tokens.map.get(`${host}:bob#sso`)!)).toMatchObject({ refreshToken: 'r2' })
  })

  it('renouvellement puis second refus : révocation, sans troisième appel', async () => {
    await ssoAccount()
    accepted = new Set()
    await expect(service.listRepos(`${host}:bob`)).rejects.toBeInstanceOf(ForgeAccessError)
    expect(repoCalls()).toHaveLength(2)
    expect(refreshCalls()).toHaveLength(1)
  })

  it('renouvellement refusé : révocation sans relance', async () => {
    await ssoAccount()
    refreshAnswer = null
    await expect(service.listRepos(`${host}:bob`)).rejects.toBeInstanceOf(ForgeAccessError)
    expect(repoCalls()).toHaveLength(1)
    expect(refreshCalls()).toHaveLength(1)
  })

  it('compte sans renouvellement (PAT) : révocation immédiate, aucun renouvellement tenté', async () => {
    await expect(service.listRepos(`${host}:bob`)).rejects.toBeInstanceOf(ForgeAccessError)
    expect(repoCalls()).toHaveLength(1)
    expect(refreshCalls()).toHaveLength(0)
  })
})
