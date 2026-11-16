import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthService } from '../auth.service'
import type { SyncService } from '../sync.service'
import type { WorkspaceService } from '../workspace.service'
import type { HostContext, TokenStore } from '../../host/host-context'
import { ForgeService } from './forge.service'
import { githubProvider } from './github.provider'
import { startFakeForge, type FakeForge } from './fake-forge.test-util'

/** GH368 — suggestions de membres : membres des organisations du compte (specs/GH368-tests.md S-01 à S-06). */

class MapTokenStore implements TokenStore {
  readonly map = new Map<string, string>()
  async get(k: string) { return this.map.get(k) ?? null }
  async set(k: string, v: string) { this.map.set(k, v) }
  async delete(k: string) { return this.map.delete(k) }
}

const F = '/api/v1'
const G = '/api/v3'
let dir: string
let forge: FakeForge
let service: ForgeService
let key: string

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh368-'))
  forge = await startFakeForge()
  const host = new URL(forge.baseUrl).hostname
  key = `${host}:moi`
  const tokens = new MapTokenStore()
  await tokens.set(key, 'tok')
  await fsP.writeFile(path.join(dir, 'auth.json'), JSON.stringify({
    accounts: [{ remoteHost: host, username: 'moi', name: 'Moi', email: 'm@x', provider: 'forgejo', baseUrl: forge.baseUrl }],
    defaultAccount: key,
  }))
  const ctx: HostContext = { userDataDir: dir, tokenStore: tokens, machineConfig: { hideGithub: false } }
  service = new ForgeService(new AuthService(ctx), {} as WorkspaceService, {} as SyncService)
})

afterEach(async () => {
  await forge.close()
  await fsP.rm(dir, { recursive: true, force: true })
})

function orgs(...names: string[]) {
  forge.route('GET', `${F}/user/orgs`, req => ({ status: 200, json: Number(req.query.get('page') ?? 1) > 1 ? [] : names.map(username => ({ username })) }))
}
function members(org: string, list: Array<{ login: string; full_name?: string }>) {
  forge.route('GET', `${F}/orgs/${org}`, () => ({ status: 200, json: { username: org } }))
  forge.route('GET', `${F}/orgs/${org}/members`, req => ({ status: 200, json: Number(req.query.get('page') ?? 1) > 1 ? [] : list }))
}

describe('ForgeService.memberSuggestions (Forgejo)', () => {
  it('S-01 / S-05 — union des organisations, sans doublon ni le compte lui-même, sans annuaire', async () => {
    orgs('acme', 'beta')
    members('acme', [{ login: 'alice', full_name: 'Alice Martin' }, { login: 'bob', full_name: '' }, { login: 'Moi', full_name: 'Moi' }])
    members('beta', [{ login: 'carol', full_name: 'Carol' }, { login: 'BOB', full_name: 'Bob B' }])
    expect(await service.memberSuggestions(key)).toEqual([
      { login: 'alice', name: 'Alice Martin', orgs: ['acme'] },
      { login: 'bob', name: 'Bob B', orgs: ['acme', 'beta'] },
      { login: 'carol', name: 'Carol', orgs: ['beta'] },
    ])
    expect(forge.requests.some(r => /\/users\/search|\/search\/users/.test(r.path))).toBe(false)
  })

  it('S-02 — une organisation en échec (403) est ignorée', async () => {
    orgs('acme', 'beta')
    members('acme', [{ login: 'alice', full_name: 'Alice' }])
    forge.route('GET', `${F}/orgs/beta`, () => ({ status: 200, json: { username: 'beta' } }))
    forge.route('GET', `${F}/orgs/beta/members`, () => ({ status: 403, json: { message: 'forbidden' } }))
    expect((await service.memberSuggestions(key)).map(s => s.login)).toEqual(['alice'])
  })

  it('S-03 — liste des organisations en échec, compte inconnu : [] sans exception', async () => {
    forge.route('GET', `${F}/user/orgs`, () => ({ status: 500, json: { message: 'boom' } }))
    expect(await service.memberSuggestions(key)).toEqual([])
    expect(await service.memberSuggestions('ailleurs:personne')).toEqual([])
  })

  it('S-04 — membres d\'une organisation lus une seule fois (cache) ; un échec n\'est pas gardé', async () => {
    orgs('acme')
    let fail = true
    forge.route('GET', `${F}/orgs/acme`, () => ({ status: 200, json: { username: 'acme' } }))
    forge.route('GET', `${F}/orgs/acme/members`, () => fail ? { status: 500, json: {} } : { status: 200, json: [{ login: 'alice' }] })
    expect(await service.memberSuggestions(key)).toEqual([])
    fail = false
    expect((await service.memberSuggestions(key)).map(s => s.login)).toEqual(['alice'])
    expect((await service.memberSuggestions(key)).map(s => s.login)).toEqual(['alice'])
    expect(forge.requests.filter(r => r.path === `${F}/orgs/acme/members`)).toHaveLength(2)
  })

  it('S-04 — cache expiré après 10 min : relu (nouveau membre proposé)', async () => {
    orgs('acme')
    let list = [{ login: 'alice' }]
    forge.route('GET', `${F}/orgs/acme`, () => ({ status: 200, json: { username: 'acme' } }))
    forge.route('GET', `${F}/orgs/acme/members`, () => ({ status: 200, json: list }))
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      expect((await service.memberSuggestions(key)).map(s => s.login)).toEqual(['alice'])
      list = [{ login: 'alice' }, { login: 'zed' }]
      clock.mockReturnValue(now + 9 * 60_000)
      expect((await service.memberSuggestions(key)).map(s => s.login)).toEqual(['alice'])
      clock.mockReturnValue(now + 11 * 60_000)
      expect((await service.memberSuggestions(key)).map(s => s.login)).toEqual(['alice', 'zed'])
    } finally {
      clock.mockRestore()
    }
  })
})

describe('githubProvider.listUserOrgs', () => {
  const scopes = (s: string) => ({ 'X-OAuth-Scopes': s })

  it('S-06 — sans read:org : /user/orgs ; avec : /user/memberships/orgs', async () => {
    forge.route('GET', `${G}/user`, () => ({ status: 200, json: { login: 'octo' }, headers: scopes('repo') }))
    forge.route('GET', `${G}/user/orgs`, () => ({ status: 200, json: [{ login: 'pub' }] }))
    expect(await githubProvider.listUserOrgs!(forge.baseUrl, 'gh')).toEqual(['pub'])

    forge.route('GET', `${G}/user`, () => ({ status: 200, json: { login: 'octo' }, headers: scopes('repo, read:org') }))
    forge.route('GET', `${G}/user/memberships/orgs`, () => ({ status: 200, json: [{ role: 'member', organization: { login: 'acme' } }] }))
    expect(await githubProvider.listUserOrgs!(forge.baseUrl, 'gh')).toEqual(['acme'])
  })
})
