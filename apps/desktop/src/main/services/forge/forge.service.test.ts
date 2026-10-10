import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthService } from '../auth.service'
import type { SyncService } from '../sync.service'
import type { WorkspaceService } from '../workspace.service'
import type { HostContext, TokenStore } from '../../host/host-context'
import { ForgeService, parseRepoUrl } from './forge.service'
import { forgejoProvider } from './forgejo.provider'
import { RepoNameTakenError } from './forge-provider'
import { startFakeForge, type FakeForge } from './fake-forge.test-util'

/**
 * GH45 S4 — fonctions P1 (design §4) : réponses de la fausse forge calquées sur Forgejo 15.0.9 et
 * Gitea 28.1.0 (mesures du 2026-10-11 : permissions d'un lecteur, 409 sur un nom pris, 404 sur
 * /orgs/{utilisateur}).
 */

class MapTokenStore implements TokenStore {
  readonly map = new Map<string, string>()
  async get(k: string) { return this.map.get(k) ?? null }
  async set(k: string, v: string) { this.map.set(k, v) }
  async delete(k: string) { return this.map.delete(k) }
}

let dir: string
let forge: FakeForge
let host: string
let auth: AuthService
let tokens: MapTokenStore

function apiRepo(fullName: string, push = true, extra: Record<string, unknown> = {}) {
  const [owner, name] = fullName.split('/')
  return {
    full_name: fullName, name, owner: { login: owner, username: owner }, description: '',
    clone_url: `https://forge.test/${fullName}.git`, permissions: { admin: false, push, pull: true }, ...extra,
  }
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-forge-'))
  forge = await startFakeForge()
  host = new URL(forge.baseUrl).hostname
  tokens = new MapTokenStore()
  await tokens.set(`${host}:bob`, 'tok')
  await tokens.set('github.com:octo', 'gh')
  await fsP.writeFile(path.join(dir, 'auth.json'), JSON.stringify({
    accounts: [
      { remoteHost: 'github.com', username: 'octo', name: 'Octo', email: 'o@x', provider: 'github' },
      { remoteHost: host, username: 'bob', name: 'Bob', email: 'b@x', provider: 'forgejo', baseUrl: forge.baseUrl },
    ],
    defaultAccount: 'github.com:octo',
  }))
  const ctx: HostContext = { userDataDir: dir, tokenStore: tokens, machineConfig: { hideGithub: false } }
  auth = new AuthService(ctx)
})

afterEach(async () => {
  await forge.close()
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('forgejoProvider — fonctions P1', () => {
  it('listRepos : toutes les pages, lecture seule si pas de push, tri', async () => {
    const all = Array.from({ length: 51 }, (_, i) => apiRepo(`acme/p${String(i).padStart(2, '0')}`, i !== 3))
    forge.route('GET', '/api/v1/user/repos', req => {
      const page = Number(req.query.get('page')); const limit = Number(req.query.get('limit'))
      return { status: 200, json: all.slice((page - 1) * limit, page * limit) }
    })
    const repos = await forgejoProvider.listRepos!(forge.baseUrl, 'tok')
    expect(repos).toHaveLength(51)
    expect(repos[3]).toMatchObject({ fullName: 'acme/p03', owner: 'acme', readOnly: true })
    expect(repos[4].readOnly).toBe(false)
    expect(forge.requests.filter(r => r.path === '/api/v1/user/repos')).toHaveLength(2)
    expect(forge.requests[0].headers.authorization).toBe('token tok')
  })

  it('listCreatableOrgs : seulement les organisations où can_create_repository', async () => {
    forge.route('GET', '/api/v1/user/orgs', () => ({ status: 200, json: [{ username: 'acme', full_name: 'ACME' }, { username: 'lecture' }] }))
    forge.route('GET', '/api/v1/users/bob/orgs/acme/permissions', () => ({ status: 200, json: { is_owner: false, can_read: true, can_write: true, can_create_repository: true } }))
    // Gitea : can_read peut être faux pour un lecteur d'équipe — seul can_create_repository compte.
    forge.route('GET', '/api/v1/users/bob/orgs/lecture/permissions', () => ({ status: 200, json: { is_owner: false, can_read: false, can_write: false, can_create_repository: false } }))
    expect(await forgejoProvider.listCreatableOrgs!(forge.baseUrl, 'tok', 'bob')).toEqual([{ name: 'acme', label: 'ACME' }])
  })

  it('createOrgRepo : repo privé et vide ; nom pris (409) → RepoNameTakenError', async () => {
    forge.route('POST', '/api/v1/orgs/acme/repos', () => ({ status: 201, json: apiRepo('acme/nouveau') }))
    expect((await forgejoProvider.createOrgRepo!(forge.baseUrl, 'tok', 'acme', 'nouveau')).cloneUrl).toBe('https://forge.test/acme/nouveau.git')
    expect(JSON.parse(forge.requests[0].body)).toEqual({ name: 'nouveau', private: true, auto_init: false, default_branch: 'main' })
    forge.route('POST', '/api/v1/orgs/acme/repos', () => ({ status: 409, json: { message: 'The repository with the same name already exists.' } }))
    await expect(forgejoProvider.createOrgRepo!(forge.baseUrl, 'tok', 'acme', 'nouveau')).rejects.toBeInstanceOf(RepoNameTakenError)
  })

  it('repoPermissions : 404 → null', async () => {
    forge.route('GET', '/api/v1/repos/acme/ro', () => ({ status: 200, json: apiRepo('acme/ro', false) }))
    expect(await forgejoProvider.repoPermissions!(forge.baseUrl, 'tok', 'acme', 'ro')).toEqual({ pull: true, push: false, admin: false })
    expect(await forgejoProvider.repoPermissions!(forge.baseUrl, 'tok', 'acme', 'absent')).toBeNull()
  })

  it('orgMembers : nom affiché ou login ; propriétaire non organisation → null', async () => {
    forge.route('GET', '/api/v1/orgs/acme', () => ({ status: 200, json: { username: 'acme' } }))
    forge.route('GET', '/api/v1/orgs/acme/members', () => ({ status: 200, json: [{ login: 'carol', full_name: '' }, { login: 'alice', full_name: 'Alice Martin' }] }))
    expect(await forgejoProvider.orgMembers!(forge.baseUrl, 'tok', 'acme')).toEqual([
      { login: 'alice', name: 'Alice Martin' }, { login: 'carol', name: 'carol' },
    ])
    expect(await forgejoProvider.orgMembers!(forge.baseUrl, 'tok', 'bob')).toBeNull()
  })
})

describe('ForgeService', () => {
  let pushBranch: ReturnType<typeof vi.fn>
  let service: ForgeService

  /** Projet local réel (git init + commit), comme createNewProject, sans l'arbre du workspace. */
  async function initRepo(repoPath: string) {
    await fsP.mkdir(repoPath, { recursive: true })
    await git.init({ fs, dir: repoPath, defaultBranch: 'main' })
    await fsP.writeFile(path.join(repoPath, 'AGENTS.md'), 'x')
    await git.add({ fs, dir: repoPath, filepath: 'AGENTS.md' })
    await git.commit({ fs, dir: repoPath, message: 'init', author: { name: 'P', email: 'p@x' } })
  }

  beforeEach(() => {
    pushBranch = vi.fn(async () => {})
    const workspace = {
      createNewProject: vi.fn(async (containerDir: string, name: string) => { await initRepo(path.join(containerDir, name)); return { status: 'ok' } }),
      initProjectRepo: vi.fn(initRepo),
      openWorkspace: vi.fn(async () => ({ status: 'ok', tree: { nodes: [] } })),
    } as unknown as WorkspaceService
    service = new ForgeService(auth, workspace, { pushBranch } as unknown as SyncService)
  })

  it('accounts : comptes Forgejo connectés seulement', async () => {
    expect((await service.accounts()).map(a => a.key)).toEqual([`${host}:bob`])
  })

  it('listRepos : le repo de configuration n\'est pas proposé', async () => {
    forge.route('GET', '/api/v1/user/repos', () => ({ status: 200, json: [apiRepo('acme/polenta-config'), apiRepo('acme/demo')] }))
    expect((await service.listRepos(`${host}:bob`)).map(r => r.fullName)).toEqual(['acme/demo'])
    await expect(service.listRepos('inconnu:x')).rejects.toThrow(/reconnectez-vous/)
  })

  it('jeton refusé (401) → accès révoqué, comme pour git ; autre refus : message lisible', async () => {
    forge.route('GET', '/api/v1/user/repos', () => ({ status: 401, json: { message: 'token is required' } }))
    const err = await service.listRepos(`${host}:bob`).then(() => new Error('aucune erreur'), (e: Error) => e)
    expect(err.message).toMatch(/^⟦forge-access \{"status":401/)
    expect(err.message).toMatch(/Reconnectez-vous/)
    expect(auth.isAccessRevoked(host)).toBe(true)
    forge.route('GET', '/api/v1/user/orgs', () => ({ status: 500, json: { message: 'boom' } }))
    await expect(service.creatableOrgs(`${host}:bob`)).rejects.toThrow(`Le serveur ${host} a refusé l'opération (HTTP 500 : boom).`)
  })

  it('createProjectOnServer : nom pris → erreur avant toute écriture locale', async () => {
    forge.route('GET', '/api/v1/repos/acme/pris', () => ({ status: 200, json: apiRepo('acme/pris') }))
    await expect(service.createProjectOnServer(dir, 'pris', `${host}:bob`, 'acme')).rejects.toBeInstanceOf(RepoNameTakenError)
    expect(fs.existsSync(path.join(dir, 'pris'))).toBe(false)
    expect(forge.requests.some(r => r.method === 'POST')).toBe(false)
  })

  it('createProjectOnServer : repo distant, projet local, origin, publication de main', async () => {
    forge.route('POST', '/api/v1/orgs/acme/repos', () => ({ status: 201, json: apiRepo('acme/nouveau') }))
    const result = await service.createProjectOnServer(dir, 'nouveau', `${host}:bob`, 'acme')
    const repoPath = path.join(dir, 'nouveau')
    expect(result).toMatchObject({ cloneUrl: 'https://forge.test/acme/nouveau.git', pushWarning: undefined, open: { status: 'ok' } })
    expect((await git.listRemotes({ fs, dir: repoPath }))).toEqual([{ remote: 'origin', url: 'https://forge.test/acme/nouveau.git' }])
    expect(pushBranch).toHaveBeenCalledWith(repoPath, 'main')
  })

  it('createProjectOnServer : publication en échec → projet conservé avec origin, avertissement', async () => {
    forge.route('POST', '/api/v1/orgs/acme/repos', () => ({ status: 201, json: apiRepo('acme/coupe') }))
    pushBranch.mockRejectedValueOnce(new Error('réseau coupé'))
    const result = await service.createProjectOnServer(dir, 'coupe', `${host}:bob`, 'acme')
    expect(result.pushWarning).toBe('réseau coupé')
    expect((await git.listRemotes({ fs, dir: path.join(dir, 'coupe') }))[0].url).toBe('https://forge.test/acme/coupe.git')
  })

  it('createProjectOnServer : nom invalide refusé sans appel réseau', async () => {
    await expect(service.createProjectOnServer(dir, 'a b', `${host}:bob`, 'acme')).rejects.toThrow(/invalide/)
    expect(forge.requests).toHaveLength(0)
  })

  it('createComponentOnServer : initialisé et publié depuis un dossier temporaire supprimé ensuite', async () => {
    forge.route('POST', '/api/v1/orgs/acme/repos', () => ({ status: 201, json: apiRepo('acme/comp') }))
    let pushedFrom = ''
    pushBranch.mockImplementationOnce(async (repoPath: string) => { pushedFrom = repoPath })
    expect(await service.createComponentOnServer(`${host}:bob`, 'acme', 'comp')).toEqual({ cloneUrl: 'https://forge.test/acme/comp.git' })
    expect(pushedFrom).toMatch(/polenta-composant-/)
    expect(fs.existsSync(pushedFrom)).toBe(false)
  })

  it('createComponentOnServer : publication en échec → erreur qui donne l\'URL', async () => {
    forge.route('POST', '/api/v1/orgs/acme/repos', () => ({ status: 201, json: apiRepo('acme/comp') }))
    pushBranch.mockRejectedValueOnce(new Error('réseau coupé'))
    await expect(service.createComponentOnServer(`${host}:bob`, 'acme', 'comp')).rejects.toThrow(/https:\/\/forge\.test\/acme\/comp\.git/)
  })

  describe('repoAccess / orgMembers (repo local avec origin)', () => {
    async function repoWithOrigin(url: string): Promise<string> {
      const repoPath = path.join(dir, 'p')
      await initRepo(repoPath)
      await git.addRemote({ fs, dir: repoPath, remote: 'origin', url })
      return repoPath
    }

    it('lecture seule détectée ; remote GitHub ou forge injoignable → null, sans erreur', async () => {
      forge.route('GET', '/api/v1/repos/acme/demo', () => ({ status: 200, json: apiRepo('acme/demo', false) }))
      const repoPath = await repoWithOrigin(`${forge.baseUrl}/acme/demo.git`)
      expect(await service.repoAccess(repoPath)).toEqual({ host, repo: 'acme/demo', pull: true, push: false })
      await git.setConfig({ fs, dir: repoPath, path: 'remote.origin.url', value: 'https://github.com/octo/demo.git' })
      expect(await service.repoAccess(repoPath)).toBeNull()
      await forge.close()
      await git.setConfig({ fs, dir: repoPath, path: 'remote.origin.url', value: `${forge.baseUrl}/acme/demo.git` })
      expect(await service.repoAccess(repoPath)).toBeNull()
      forge = await startFakeForge()   // pour afterEach
    })

    it('membres chargés une fois par organisation', async () => {
      forge.route('GET', '/api/v1/orgs/acme', () => ({ status: 200, json: { username: 'acme' } }))
      forge.route('GET', '/api/v1/orgs/acme/members', () => ({ status: 200, json: [{ login: 'alice', full_name: 'Alice' }] }))
      const repoPath = await repoWithOrigin(`${forge.baseUrl}/acme/demo.git`)
      expect(await service.orgMembers(repoPath)).toEqual([{ login: 'alice', name: 'Alice' }])
      expect(await service.orgMembers(repoPath)).toEqual([{ login: 'alice', name: 'Alice' }])
      expect(forge.requests.filter(r => r.path === '/api/v1/orgs/acme/members')).toHaveLength(1)
    })
  })

  it('parseRepoUrl', () => {
    expect(parseRepoUrl('https://h/acme/demo.git')).toEqual({ owner: 'acme', repo: 'demo' })
    expect(parseRepoUrl('https://h/sous/chemin/acme/demo/')).toEqual({ owner: 'acme', repo: 'demo' })
    expect(parseRepoUrl('git@h:acme/demo.git')).toBeNull()
  })
})
