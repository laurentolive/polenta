import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ForgeKind } from '@polenta/types'

import { AuthService } from '../auth.service'
import { GitService } from '../git.service'
import { SyncService } from '../sync.service'
import type { WorkspaceService } from '../workspace.service'
import type { HostContext, TokenStore } from '../../host/host-context'
import { ForgeService } from './forge.service'
import { AdminRequiredError, LastAdminError } from './forge-provider'
import { RepoSettingsService } from './repo-settings.service'
import { startFakeForge, type FakeForge } from './fake-forge.test-util'

/**
 * GH108 — fenêtre « Paramètres du repo » (specs/GH108-design.md §5, S-01 à S-09). Réponses de la
 * fausse forge reprises de specs/GH107-sprint1.md ; GitHub servi sous `/api/v3`.
 */

class MapTokenStore implements TokenStore {
  readonly map = new Map<string, string>()
  async get(k: string) { return this.map.get(k) ?? null }
  async set(k: string, v: string) { this.map.set(k, v) }
  async delete(k: string) { return this.map.delete(k) }
}

const AUTHOR = { name: 'Testeur', email: 't@x' }
let dir: string
let repo: string
let forge: FakeForge
let service: ForgeService

async function setup(provider: ForgeKind, url?: string) {
  const host = new URL(forge.baseUrl).hostname
  const tokens = new MapTokenStore()
  await tokens.set(`${host}:bob`, 'tok')
  await fsP.writeFile(path.join(dir, 'auth.json'), JSON.stringify({
    accounts: [{ remoteHost: host, username: 'bob', name: 'Bob', email: 'b@x', provider, baseUrl: forge.baseUrl }],
    defaultAccount: `${host}:bob`,
  }))
  const ctx: HostContext = { userDataDir: dir, tokenStore: tokens, machineConfig: { hideGithub: false } }
  service = new ForgeService(new AuthService(ctx), {} as WorkspaceService, {} as SyncService)
  await git.init({ fs, dir: repo, defaultBranch: 'int-a' })
  await git.addRemote({ fs, dir: repo, remote: 'origin', url: url ?? `${forge.baseUrl}/acme/proj.git` })
}

const details = (admin = true, extra: Record<string, unknown> = {}) => ({
  full_name: 'acme/proj', name: 'proj', owner: { login: 'acme' }, description: 'D', private: true, clone_url: 'https://forge.test/acme/proj.git',
  default_branch: 'int-a', permissions: { admin, push: admin, pull: true }, ...extra,
})

const writes = () => forge.requests.filter(r => r.method !== 'GET')

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh108-'))
  repo = path.join(dir, 'repo')
  await fsP.mkdir(repo)
  forge = await startFakeForge()
})

afterEach(async () => {
  await forge.close()
  await fsP.rm(dir, { recursive: true, force: true })
})

/** Organisation avec `collaborators` et des équipes de niveaux donnés (Forgejo). */
function forgejoOrg(collaborators: Record<string, string>, teams: Array<{ name: string; permission: string; includes_all_repositories?: boolean }> = []) {
  forge.route('GET', '/api/v1/repos/acme/proj', () => ({ status: 200, json: details() }))
  forge.route('GET', '/api/v1/orgs/acme', () => ({ status: 200, json: { username: 'acme' } }))
  forge.route('GET', '/api/v1/orgs/acme/members', () => ({ status: 200, json: [{ login: 'ann', full_name: 'Ann' }] }))
  forge.route('GET', '/api/v1/orgs/acme/teams', () => ({ status: 200, json: teams }))
  forge.route('GET', '/api/v1/repos/acme/proj/teams', () => ({ status: 200, json: teams }))
  forge.route('GET', '/api/v1/repos/acme/proj/collaborators', () => ({ status: 200, json: Object.keys(collaborators).map(login => ({ login, full_name: `${login} N` })) }))
  for (const [login, level] of Object.entries(collaborators)) {
    forge.route('GET', `/api/v1/repos/acme/proj/collaborators/${login}/permission`, () => ({ status: 200, json: { permission: level, role_name: level } }))
    forge.route('DELETE', `/api/v1/repos/acme/proj/collaborators/${login}`, () => ({ status: 204, text: '' }))
    forge.route('PUT', `/api/v1/repos/acme/proj/collaborators/${login}`, () => ({ status: 204, text: '' }))
  }
}

describe('repoSettingsAvailable', () => {
  it('forge d\'un compte connecté : oui, sans appel réseau ; generic, SSH ou sans origin : non (S-13)', async () => {
    await setup('forgejo')
    expect(await service.repoSettingsAvailable(repo)).toBe(true)
    expect(forge.requests).toHaveLength(0)
    await git.deleteRemote({ fs, dir: repo, remote: 'origin' })
    expect(await service.repoSettingsAvailable(repo)).toBe(false)
    await git.addRemote({ fs, dir: repo, remote: 'origin', url: 'git@forge.test:acme/proj.git' })
    expect(await service.repoSettingsAvailable(repo)).toBe(false)
  })

  it('compte generic : non, repoSettings null', async () => {
    await setup('generic')
    expect(await service.repoSettingsAvailable(repo)).toBe(false)
    expect(await service.repoSettings(repo)).toBeNull()
  })
})

describe('repoSettings', () => {
  it('Forgejo, organisation : collaborateurs avec nom et niveau, équipes en lecture, autocomplétion, lien des équipes', async () => {
    await setup('forgejo')
    forgejoOrg({ mem: 'write' }, [{ name: 'Owners', permission: 'owner', includes_all_repositories: true }])
    const s = await service.repoSettings(repo)
    expect(s).toMatchObject({
      available: true, fullName: 'acme/proj', login: 'bob', isOrg: true, scopeMissing: false, membersRestricted: false,
      collaborators: [{ login: 'mem', name: 'mem N', level: 'write' }],
      teams: [{ name: 'Owners', level: 'owner', levelEditable: false, removable: false }],
      orgMembers: [{ login: 'ann', name: 'Ann' }],
      invitations: [], teamLevelEditable: false, teamsUrl: `${forge.baseUrl}/org/acme/teams`,
    })
  })

  it('repo personnel : pas d\'équipes, pas d\'appel aux équipes', async () => {
    await setup('forgejo', `${forge.baseUrl}/bob/proj.git`)
    forge.route('GET', '/api/v1/repos/bob/proj', () => ({ status: 200, json: details() }))
    forge.route('GET', '/api/v1/repos/bob/proj/collaborators', () => ({ status: 200, json: [{ login: 'bob' }] }))
    expect(await service.repoSettings(repo)).toMatchObject({ available: true, isOrg: false, collaborators: [], teams: [], orgTeams: [] })
    expect(forge.requests.some(r => r.path.endsWith('/teams'))).toBe(false)
  })

  it('GitHub : invitations, scope manquant, niveau maintain affiché tel quel (S-02, S-07)', async () => {
    await setup('github')
    const G = '/api/v3'
    forge.route('GET', `${G}/user`, () => ({ status: 200, json: { login: 'bob' }, headers: { 'X-OAuth-Scopes': 'repo, user:email' } }))
    forge.route('GET', `${G}/repos/acme/proj`, () => ({ status: 200, json: details() }))
    forge.route('GET', `${G}/orgs/acme/members`, () => ({ status: 200, json: [{ login: 'ann' }] }))
    forge.route('GET', `${G}/orgs/acme/teams`, () => ({ status: 200, json: [{ name: 'Devs', slug: 'devs' }] }))
    forge.route('GET', `${G}/repos/acme/proj/teams`, () => ({ status: 200, json: [{ name: 'Devs', slug: 'devs', permission: 'push' }] }))
    forge.route('GET', `${G}/repos/acme/proj/collaborators`, () => ({ status: 200, json: [{ login: 'seb', role_name: 'maintain' }] }))
    forge.route('GET', `${G}/repos/acme/proj/invitations`, () => ({ status: 200, json: [{ id: 7, invitee: { login: 'zed' }, permissions: 'read' }] }))
    expect(await service.repoSettings(repo)).toMatchObject({
      isOrg: true, scopeMissing: true, teamLevelEditable: true, teamsUrl: `${forge.baseUrl}/orgs/acme/teams`,
      collaborators: [{ login: 'seb', level: 'maintain' }],
      teams: [{ name: 'devs', label: 'Devs', level: 'write', levelEditable: true, removable: true }],
      invitations: [{ id: 7, login: 'zed', level: 'read' }],
    })
  })

  it('GH356 — GitHub, repo personnel : niveau des collaborateurs imposé (écriture) ; organisation : libre', async () => {
    await setup('github')
    const G = '/api/v3'
    forge.route('GET', `${G}/user`, () => ({ status: 200, json: { login: 'bob' }, headers: { 'X-OAuth-Scopes': 'repo, read:org' } }))
    forge.route('GET', `${G}/repos/acme/proj`, () => ({ status: 200, json: details(true, { owner: { login: 'acme', type: 'User' } }) }))
    forge.route('GET', `${G}/orgs/acme/members`, () => ({ status: 404, json: { message: 'Not Found' } }))
    forge.route('GET', `${G}/repos/acme/proj/collaborators`, () => ({ status: 200, json: [{ login: 'seb', role_name: 'write' }] }))
    forge.route('GET', `${G}/repos/acme/proj/invitations`, () => ({ status: 200, json: [] }))
    expect(await service.repoSettings(repo)).toMatchObject({ available: true, isOrg: false, fixedCollaboratorLevel: 'write' })
    forge.route('GET', `${G}/repos/acme/proj`, () => ({ status: 200, json: details(true, { owner: { login: 'acme', type: 'Organization' } }) }))
    expect(await service.repoSettings(repo)).not.toHaveProperty('fixedCollaboratorLevel')
  })

  it('S-11 — lecteur : la forge refuse les listes, aucune erreur, pas d\'appel aux invitations', async () => {
    await setup('forgejo')
    forge.route('GET', '/api/v1/repos/acme/proj', () => ({ status: 200, json: details(false) }))
    forge.route('GET', '/api/v1/orgs/acme', () => ({ status: 200, json: { username: 'acme' } }))
    forge.route('GET', '/api/v1/orgs/acme/members', () => ({ status: 200, json: [] }))
    forge.route('GET', '/api/v1/repos/acme/proj/collaborators', () => ({ status: 403, json: { message: 'token denied' } }))
    forge.route('GET', '/api/v1/repos/acme/proj/teams', () => ({ status: 403, json: { message: 'token denied' } }))
    forge.route('GET', '/api/v1/orgs/acme/teams', () => ({ status: 403, json: { message: 'token denied' } }))
    expect(await service.repoSettings(repo)).toMatchObject({ available: true, membersRestricted: true, collaborators: [], teams: [] })
  })

  it('S-12 — forge injoignable : offline, sans erreur', async () => {
    await setup('forgejo')
    await forge.close()
    expect(await service.repoSettings(repo)).toEqual({ available: false, reason: 'offline' })
    forge = await startFakeForge()
  })
})

describe('écritures', () => {
  it('S-01 — collaborateur, Forgejo : ajouter, changer, retirer', async () => {
    await setup('forgejo')
    forgejoOrg({ admin1: 'admin', mem: 'read' })
    forge.route('PUT', '/api/v1/repos/acme/proj/collaborators/neuf', () => ({ status: 204, text: '' }))
    expect(await service.setRepoCollaborator(repo, 'neuf', 'write')).toBe('added')
    expect(JSON.parse(writes().at(-1)!.body)).toEqual({ permission: 'write' })
    await service.setRepoCollaborator(repo, 'mem', 'admin')
    await service.removeRepoCollaborator(repo, 'mem')
    expect(writes().at(-1)).toMatchObject({ method: 'DELETE', path: '/api/v1/repos/acme/proj/collaborators/mem' })
  })

  it('S-02 — GitHub : non-membre invité, invitation annulée', async () => {
    await setup('github')
    const G = '/api/v3'
    forge.route('GET', `${G}/repos/acme/proj`, () => ({ status: 200, json: details() }))
    forge.route('GET', `${G}/orgs/acme/members`, () => ({ status: 200, json: [] }))
    forge.route('GET', `${G}/repos/acme/proj/collaborators`, () => ({ status: 200, json: [] }))
    forge.route('GET', `${G}/repos/acme/proj/teams`, () => ({ status: 200, json: [] }))
    forge.route('GET', `${G}/repos/acme/proj/invitations`, () => ({ status: 200, json: [] }))
    forge.route('PUT', `${G}/repos/acme/proj/collaborators/seb`, () => ({ status: 201, json: { id: 7, permissions: 'read' } }))
    expect(await service.setRepoCollaborator(repo, 'seb', 'read')).toBe('invited')
    expect(JSON.parse(writes().at(-1)!.body)).toEqual({ permission: 'pull' })
    forge.route('DELETE', `${G}/repos/acme/proj/invitations/7`, () => ({ status: 204, text: '' }))
    await service.cancelRepoInvitation(repo, 7)
    expect(writes().at(-1)).toMatchObject({ method: 'DELETE', path: `${G}/repos/acme/proj/invitations/7` })
  })

  it('S-03 — équipe : Forgejo sans niveau, GitHub avec niveau', async () => {
    await setup('forgejo')
    forgejoOrg({})
    forge.route('PUT', '/api/v1/repos/acme/proj/teams/devs', () => ({ status: 204, text: '' }))
    forge.route('DELETE', '/api/v1/repos/acme/proj/teams/devs', () => ({ status: 204, text: '' }))
    await service.setRepoTeamAccess(repo, 'devs', 'write')
    expect(writes().at(-1)!.body).toBe('')
    await service.removeRepoTeamAccess(repo, 'devs')
    await forge.close()
    forge = await startFakeForge()
    await fsP.rm(repo, { recursive: true, force: true })
    await fsP.mkdir(repo)
    await setup('github')
    const G = '/api/v3'
    forge.route('GET', `${G}/repos/acme/proj`, () => ({ status: 200, json: details() }))
    forge.route('PUT', `${G}/orgs/acme/teams/devs/repos/acme/proj`, () => ({ status: 204, text: '' }))
    await service.setRepoTeamAccess(repo, 'devs', 'admin')
    expect(JSON.parse(writes().at(-1)!.body)).toEqual({ permission: 'admin' })
  })

  it('S-04 — dernier admin direct, aucune équipe admin : retrait et rétrogradation refusés', async () => {
    await setup('forgejo')
    forgejoOrg({ seul: 'admin', mem: 'write' }, [{ name: 'lecteurs', permission: 'read' }])
    await expect(service.removeRepoCollaborator(repo, 'seul')).rejects.toBeInstanceOf(LastAdminError)
    await expect(service.setRepoCollaborator(repo, 'seul', 'read')).rejects.toBeInstanceOf(LastAdminError)
    expect(writes()).toHaveLength(0)
    await service.removeRepoCollaborator(repo, 'mem')
    expect(writes()).toHaveLength(1)
  })

  it('S-05 — dernier admin direct, équipe admin présente (Owners compte) : accepté', async () => {
    await setup('forgejo')
    forgejoOrg({ seul: 'admin' }, [{ name: 'Owners', permission: 'owner', includes_all_repositories: true }])
    await service.removeRepoCollaborator(repo, 'seul')
    expect(writes()).toHaveLength(1)
  })

  it('repo personnel : le propriétaire reste admin, la garde ne s\'applique pas', async () => {
    await setup('forgejo', `${forge.baseUrl}/bob/proj.git`)
    forge.route('GET', '/api/v1/repos/bob/proj', () => ({ status: 200, json: details() }))
    forge.route('DELETE', '/api/v1/repos/bob/proj/collaborators/seul', () => ({ status: 204, text: '' }))
    await service.removeRepoCollaborator(repo, 'seul')
    expect(writes()).toHaveLength(1)
  })

  it('S-06 — sans droit admin : refus côté main, aucune écriture', async () => {
    await setup('forgejo')
    forge.route('GET', '/api/v1/repos/acme/proj', () => ({ status: 200, json: details(false) }))
    const refused = expect.any(AdminRequiredError)
    await expect(service.updateRepoSettings(repo, { description: 'x' })).rejects.toEqual(refused)
    await expect(service.setRepoCollaborator(repo, 'a', 'read')).rejects.toEqual(refused)
    await expect(service.removeRepoCollaborator(repo, 'a')).rejects.toEqual(refused)
    await expect(service.setRepoTeamAccess(repo, 'a')).rejects.toEqual(refused)
    await expect(service.removeRepoTeamAccess(repo, 'a')).rejects.toEqual(refused)
    await expect(service.cancelRepoInvitation(repo, 1)).rejects.toEqual(refused)
    expect(writes()).toHaveLength(0)
  })

  it('description vide refusée, description et visibilité envoyées', async () => {
    await setup('forgejo')
    forge.route('GET', '/api/v1/repos/acme/proj', () => ({ status: 200, json: details() }))
    forge.route('PATCH', '/api/v1/repos/acme/proj', () => ({ status: 200, json: details() }))
    await expect(service.updateRepoSettings(repo, { description: '  ' })).rejects.toThrow(/obligatoire/)
    await service.updateRepoSettings(repo, { description: ' Nouvelle ' })
    expect(JSON.parse(writes().at(-1)!.body)).toEqual({ description: 'Nouvelle' })
  })
})

describe('README', () => {
  let bare: string
  let settings: RepoSettingsService
  let sync: SyncService
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()

  async function seed(readme: string | null, branch = 'int-a') {
    bare = path.join(dir, 'server.git').replace(/\\/g, '/')
    run(dir, 'init', '-q', '--bare', '--initial-branch=int-a', bare)
    await git.init({ fs, dir: repo, defaultBranch: 'int-a' })
    await fsP.mkdir(path.join(repo, 'config'))
    await fsP.writeFile(path.join(repo, 'config', 'project.yaml'), 'integrationBranch: int-a\n')
    if (readme !== null) await fsP.writeFile(path.join(repo, 'README.md'), readme)
    await git.add({ fs, dir: repo, filepath: '.' })
    await git.commit({ fs, dir: repo, message: 'init', author: AUTHOR })
    await git.addRemote({ fs, dir: repo, remote: 'origin', url: bare })
    if (branch !== 'int-a') await git.branch({ fs, dir: repo, ref: branch, checkout: true })
    const auth = { getAuthor: async () => AUTHOR, getHttpsCredentials: async () => null } as unknown as AuthService
    sync = new SyncService(auth)
    settings = new RepoSettingsService(new GitService(), sync)
  }

  it('S-08 — forme standard : commit du seul README, paragraphe remplacé, suite conservée, poussé', async () => {
    await seed('# proj\n\nAncienne description\nsur deux lignes\n\n## Suite\n\nGardée\n')
    expect(await settings.readmeState(repo)).toBe('standard')
    expect(await settings.syncReadme(repo, ' Nouvelle ')).toEqual({ status: 'committed' })
    const expected = '# proj\n\nNouvelle\n\n## Suite\n\nGardée\n'
    expect(await fsP.readFile(path.join(repo, 'README.md'), 'utf-8')).toBe(expected)
    expect(run(repo, 'status', '--porcelain')).toBe('')
    expect(run(repo, 'show', '--name-only', '--format=', 'HEAD')).toBe('README.md')
    expect(run(bare, 'show', 'int-a:README.md')).toBe(expected.trim())
  })

  it('S-09 — forme libre : non réécrit, signalé', async () => {
    for (const free of ['Pas de titre\n', '# t\n\n- une liste\n', '# t\nsans ligne vide\n', '# t\n\n## autre titre\n']) {
      await fsP.rm(repo, { recursive: true, force: true })
      await fsP.mkdir(repo)
      await fsP.rm(path.join(dir, 'server.git'), { recursive: true, force: true })
      await seed(free)
      expect(await settings.readmeState(repo)).toBe('free')
      expect(await settings.syncReadme(repo, 'Nouvelle')).toEqual({ status: 'free' })
      expect(await fsP.readFile(path.join(repo, 'README.md'), 'utf-8')).toBe(free)
    }
  })

  it('absent : créé ; même texte : rien ; hors intégration ou modification en attente : rien n\'est écrit', async () => {
    await seed(null)
    expect(await settings.readmeState(repo)).toBe('none')
    expect((await settings.syncReadme(repo, 'Desc')).status).toBe('committed')
    expect(await fsP.readFile(path.join(repo, 'README.md'), 'utf-8')).toBe('# repo\n\nDesc\n')
    expect(await settings.syncReadme(repo, 'Desc')).toEqual({ status: 'unchanged' })
    await fsP.writeFile(path.join(repo, 'README.md'), '# repo\n\nÀ moi\n')
    expect(await settings.syncReadme(repo, 'Autre')).toEqual({ status: 'pending-changes' })
    expect(await fsP.readFile(path.join(repo, 'README.md'), 'utf-8')).toBe('# repo\n\nÀ moi\n')
    await git.checkout({ fs, dir: repo, ref: 'int-a', force: true })
    await git.branch({ fs, dir: repo, ref: 'dev-x', checkout: true })
    expect(await settings.syncReadme(repo, 'Autre')).toEqual({ status: 'not-on-integration', branch: 'int-a' })
  })

  it('push en échec : commit gardé, erreur rendue', async () => {
    await seed('# proj\n\nAncienne\n')
    await fsP.rm(path.join(dir, 'server.git'), { recursive: true, force: true })
    const outcome = await settings.syncReadme(repo, 'Nouvelle')
    expect(outcome.status).toBe('committed')
    expect((outcome as { pushError?: string }).pushError).toBeTruthy()
  })
})
