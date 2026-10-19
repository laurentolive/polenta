import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ForgeKind } from '@polenta/types'

import { AuthService } from '../auth.service'
import type { SyncService } from '../sync.service'
import type { WorkspaceService } from '../workspace.service'
import type { HostContext, TokenStore } from '../../host/host-context'
import { ForgeService } from './forge.service'
import { startFakeForge, type FakeForge } from './fake-forge.test-util'

/**
 * GH106 — alignement de la branche par défaut de la forge sur la branche d'intégration
 * (specs/GH106-tests.md T-05, T-06, T-07, T-20). GitHub est servi par la fausse forge sous
 * `/api/v3` (forme GitHub Enterprise Server), github.com n'étant jamais appelé dans les tests.
 */

class MapTokenStore implements TokenStore {
  readonly map = new Map<string, string>()
  async get(k: string) { return this.map.get(k) ?? null }
  async set(k: string, v: string) { this.map.set(k, v) }
  async delete(k: string) { return this.map.delete(k) }
}

let dir: string
let repo: string
let forge: FakeForge
let auth: AuthService
let service: ForgeService

async function setup(provider: ForgeKind) {
  const host = new URL(forge.baseUrl).hostname
  const tokens = new MapTokenStore()
  await tokens.set(`${host}:bob`, 'tok')
  await fsP.writeFile(path.join(dir, 'auth.json'), JSON.stringify({
    accounts: [{ remoteHost: host, username: 'bob', name: 'Bob', email: 'b@x', provider, baseUrl: forge.baseUrl }],
    defaultAccount: `${host}:bob`,
  }))
  const ctx: HostContext = { userDataDir: dir, tokenStore: tokens, machineConfig: { hideGithub: false } }
  auth = new AuthService(ctx)
  service = new ForgeService(auth, {} as WorkspaceService, {} as SyncService)
  await git.init({ fs, dir: repo, defaultBranch: 'int-a' })
  await git.addRemote({ fs, dir: repo, remote: 'origin', url: `${forge.baseUrl}/acme/proj.git` })
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh106-forge-'))
  repo = path.join(dir, 'repo')
  await fsP.mkdir(repo)
  forge = await startFakeForge()
})

afterEach(async () => {
  await forge.close()
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('ForgeService.alignDefaultBranch — Forgejo', () => {
  beforeEach(() => setup('forgejo'))

  it('admin : PATCH default_branch → set (T-05)', async () => {
    forge.route('GET', '/api/v1/repos/acme/proj', () => ({ status: 200, json: { default_branch: 'main', permissions: { admin: true } } }))
    forge.route('PATCH', '/api/v1/repos/acme/proj', () => ({ status: 200, json: {} }))
    expect(await service.alignDefaultBranch(repo, 'int-b')).toBe('set')
    const patch = forge.requests.find(r => r.method === 'PATCH')!
    expect(JSON.parse(patch.body)).toEqual({ default_branch: 'int-b' })
    expect(patch.headers.authorization).toBe('token tok')
  })

  it('non admin : aucun PATCH → not-admin (T-06)', async () => {
    forge.route('GET', '/api/v1/repos/acme/proj', () => ({ status: 200, json: { default_branch: 'main', permissions: { admin: false, push: true } } }))
    expect(await service.alignDefaultBranch(repo, 'int-b')).toBe('not-admin')
    expect(forge.requests.some(r => r.method === 'PATCH')).toBe(false)
  })

  it('déjà alignée → unchanged', async () => {
    forge.route('GET', '/api/v1/repos/acme/proj', () => ({ status: 200, json: { default_branch: 'int-b', permissions: { admin: true } } }))
    expect(await service.alignDefaultBranch(repo, 'int-b')).toBe('unchanged')
  })

  it('401 au PATCH → erreur renvoyée, hôte marqué révoqué, aucune exception (T-20)', async () => {
    forge.route('GET', '/api/v1/repos/acme/proj', () => ({ status: 200, json: { default_branch: 'main', permissions: { admin: true } } }))
    forge.route('PATCH', '/api/v1/repos/acme/proj', () => ({ status: 401, json: { message: 'token is required' } }))
    const outcome = await service.alignDefaultBranch(repo, 'int-b')
    expect(typeof outcome).toBe('object')
    expect(auth.isAccessRevoked(new URL(forge.baseUrl).hostname)).toBe(true)
  })

  it('403 « prohibited » à la lecture → révoqué et erreur, pas « non admin »', async () => {
    forge.route('GET', '/api/v1/repos/acme/proj', () => ({ status: 403, json: { message: 'user is prohibited from login' } }))
    const outcome = await service.alignDefaultBranch(repo, 'int-b')
    expect(typeof outcome).toBe('object')
    expect(auth.isAccessRevoked(new URL(forge.baseUrl).hostname)).toBe(true)
  })

  it('404 (repo inaccessible) → erreur explicite', async () => {
    const outcome = await service.alignDefaultBranch(repo, 'int-b')
    expect(outcome).toMatchObject({ error: expect.stringMatching(/introuvable/) })
  })

  it('origin hors forge connue → no-forge', async () => {
    await git.deleteRemote({ fs, dir: repo, remote: 'origin' })
    await git.addRemote({ fs, dir: repo, remote: 'origin', url: 'https://ailleurs.test/acme/proj.git' })
    expect(await service.alignDefaultBranch(repo, 'int-b')).toBe('no-forge')
  })
})

describe('ForgeService.alignDefaultBranch — GitHub (T-07)', () => {
  beforeEach(() => setup('github'))

  it('admin : GET puis PATCH /repos/acme/proj → set', async () => {
    forge.route('GET', '/api/v3/repos/acme/proj', () => ({ status: 200, json: { default_branch: 'main', permissions: { admin: true } } }))
    forge.route('PATCH', '/api/v3/repos/acme/proj', () => ({ status: 200, json: {} }))
    expect(await service.alignDefaultBranch(repo, 'int-b')).toBe('set')
    expect(JSON.parse(forge.requests.find(r => r.method === 'PATCH')!.body)).toEqual({ default_branch: 'int-b' })
  })
})
