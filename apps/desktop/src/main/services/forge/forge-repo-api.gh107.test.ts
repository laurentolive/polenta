import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { forgejoProvider, POLENTA_TOKEN_SCOPES } from './forgejo.provider'
import { githubProvider } from './github.provider'
import {
  InvalidRepoNameError, OwnerCreateForbiddenError, RepoNameTakenError, ScopeMissingError, UnknownAccountError, VisibilityChangeError,
} from './forge-provider'
import { startFakeForge, type FakeForge } from './fake-forge.test-util'

/**
 * GH107 sprint 1 — providers Forgejo et GitHub : création, réglages, collaborateurs, équipes. Chaque
 * réponse de la fausse forge reprend une mesure de specs/GH107-sprint1.md (Forgejo 15.0.9 `acme`,
 * GitHub `polenta-test-org`, 2026-11-05). GitHub est servi sous `/api/v3` (forme GitHub Enterprise
 * Server) : github.com n'est jamais appelé.
 */

let forge: FakeForge
beforeEach(async () => { forge = await startFakeForge() })
afterEach(async () => { await forge.close() })

const F = '/api/v1'
const G = '/api/v3'
const body = (i = -1) => JSON.parse(forge.requests.at(i)!.body)

function repo(fullName: string, extra: Record<string, unknown> = {}) {
  const [owner, name] = fullName.split('/')
  return {
    full_name: fullName, name, owner: { login: owner }, description: 'Sonde GH107', private: true, empty: true,
    clone_url: `https://forge.test/${fullName}.git`, default_branch: 'main', permissions: { admin: true, push: true, pull: true }, ...extra,
  }
}

describe('Forgejo', () => {
  it('scopes du jeton : write:user pour un repo personnel (§1.1)', () => {
    expect(POLENTA_TOKEN_SCOPES).toEqual(['write:repository', 'write:user', 'write:organization'])
  })

  it('createRepo, compte personnel : corps mesuré, default_branch demandée', async () => {
    forge.route('POST', `${F}/user/repos`, () => ({ status: 201, json: repo('bob/proj', { default_branch: 'int-x' }) }))
    const created = await forgejoProvider.createRepo!(forge.baseUrl, 'tok', {
      owner: 'bob', ownerKind: 'user', name: 'proj', description: 'Desc', visibility: 'public', defaultBranch: 'int-x',
    })
    expect(created).toMatchObject({ fullName: 'bob/proj', cloneUrl: 'https://forge.test/bob/proj.git' })
    expect(body()).toEqual({ name: 'proj', description: 'Desc', private: false, auto_init: false, default_branch: 'int-x' })
  })

  it('createRepo : scope manquant → ScopeMissingError ; organisation refusée → OwnerCreateForbiddenError', async () => {
    forge.route('POST', `${F}/user/repos`, () => ({ status: 403, json: { message: 'token does not have at least one of required scope(s): [write:user]' } }))
    const user = { owner: 'bob', ownerKind: 'user' as const, name: 'p', description: '', visibility: 'private' as const }
    const err = await forgejoProvider.createRepo!(forge.baseUrl, 'tok', user).catch((e: Error) => e)
    expect(err).toBeInstanceOf(ScopeMissingError)
    expect((err as ScopeMissingError).scope).toBe('write:user')
    expect((err as Error).message).toMatch(/reconnectez-vous/)
    // Non-membre d'une organisation privée : 404 « HasOrgOrUserVisible ».
    forge.route('POST', `${F}/orgs/acme/repos`, () => ({ status: 404, json: { message: 'HasOrgOrUserVisible', errors: [] } }))
    const org = { ...user, owner: 'acme', ownerKind: 'org' as const }
    const refused = await forgejoProvider.createRepo!(forge.baseUrl, 'tok', org).catch((e: Error) => e)
    expect(refused).toBeInstanceOf(OwnerCreateForbiddenError)
    expect((refused as Error).message).toMatch(/n'a pas le droit de créer un dépôt dans l'organisation « acme ».*administrateur/)
  })

  it('createRepo : nom invalide refusé sans appel', async () => {
    await expect(forgejoProvider.createRepo!(forge.baseUrl, 'tok', {
      owner: 'bob', ownerKind: 'user', name: 'bad name!', description: '', visibility: 'private',
    })).rejects.toBeInstanceOf(InvalidRepoNameError)
    expect(forge.requests).toHaveLength(0)
  })

  it('repoDetails ; updateRepo : description puis visibilité, refus 422 → VisibilityChangeError', async () => {
    forge.route('GET', `${F}/repos/bob/proj`, () => ({ status: 200, json: repo('bob/proj', { default_branch: 'int-x' }) }))
    expect(await forgejoProvider.repoDetails!(forge.baseUrl, 'tok', 'bob', 'proj')).toEqual({
      description: 'Sonde GH107', visibility: 'private', defaultBranch: 'int-x', permissions: { pull: true, push: true, admin: true },
    })
    expect(await forgejoProvider.repoDetails!(forge.baseUrl, 'tok', 'bob', 'absent')).toBeNull()
    const patches: unknown[] = []
    forge.route('PATCH', `${F}/repos/bob/proj`, req => {
      const b = JSON.parse(req.body); patches.push(b)
      return 'private' in b
        ? { status: 422, json: { message: 'cannot change private repository to public' } }
        : { status: 200, json: repo('bob/proj', b) }
    })
    const err = await forgejoProvider.updateRepo!(forge.baseUrl, 'tok', 'bob', 'proj', { description: 'Nouvelle', visibility: 'public' }).catch((e: Error) => e)
    // La description est passée seule : le refus de visibilité ne l'annule pas.
    expect(patches).toEqual([{ description: 'Nouvelle' }, { private: false }])
    expect(err).toBeInstanceOf(VisibilityChangeError)
    expect((err as Error).message).toMatch(/refuse de rendre ce dépôt public \(cannot change private repository to public\)/)
  })

  it('listCollaborators : niveau lu par collaborateur, propriétaire exclu', async () => {
    forge.route('GET', `${F}/repos/bob/proj/collaborators`, () => ({ status: 200, json: [{ login: 'bob' }, { login: 'mem' }], headers: { 'X-Total-Count': '2' } }))
    forge.route('GET', `${F}/repos/bob/proj/collaborators/mem/permission`, () => ({ status: 200, json: { permission: 'write', role_name: 'write', user: { login: 'mem' } } }))
    expect(await forgejoProvider.listCollaborators!(forge.baseUrl, 'tok', 'bob', 'proj')).toEqual([{ login: 'mem', level: 'write' }])
    expect(forge.requests.some(r => r.path.endsWith('/collaborators/bob/permission'))).toBe(false)
  })

  it('setCollaborator : ajout direct (204) ; compte inconnu (422) → UnknownAccountError ; retrait', async () => {
    forge.route('PUT', `${F}/repos/bob/proj/collaborators/mem`, () => ({ status: 204, text: '' }))
    expect(await forgejoProvider.setCollaborator!(forge.baseUrl, 'tok', 'bob', 'proj', 'mem', 'read')).toBe('added')
    expect(body()).toEqual({ permission: 'read' })
    forge.route('PUT', `${F}/repos/bob/proj/collaborators/nobody`, () => ({ status: 422, json: { message: 'user does not exist [uid: 0, name: nobody]' } }))
    await expect(forgejoProvider.setCollaborator!(forge.baseUrl, 'tok', 'bob', 'proj', 'nobody', 'read')).rejects.toBeInstanceOf(UnknownAccountError)
    forge.route('DELETE', `${F}/repos/bob/proj/collaborators/mem`, () => ({ status: 204, text: '' }))
    await forgejoProvider.removeCollaborator!(forge.baseUrl, 'tok', 'bob', 'proj', 'mem')
  })

  it('équipes : repo personnel (405) → [] ; niveau de l\'équipe non modifiable ; « tous les repos » non retirable', async () => {
    forge.route('GET', `${F}/repos/bob/proj/teams`, () => ({ status: 405, json: { message: 'repo is not owned by an organization' } }))
    expect(await forgejoProvider.listRepoTeams!(forge.baseUrl, 'tok', 'bob', 'proj')).toEqual([])
    forge.route('GET', `${F}/repos/acme/proj/teams`, () => ({ status: 200, json: [
      { id: 1, name: 'Owners', permission: 'owner', includes_all_repositories: true },
      { id: 6, name: 'devs', permission: 'write', includes_all_repositories: false },
    ] }))
    expect(await forgejoProvider.listRepoTeams!(forge.baseUrl, 'tok', 'acme', 'proj')).toEqual([
      { name: 'devs', label: 'devs', level: 'write', levelEditable: false, removable: true },
      { name: 'Owners', label: 'Owners', level: 'owner', levelEditable: false, removable: false },
    ])
    forge.route('GET', `${F}/orgs/acme/teams`, () => ({ status: 200, json: [{ id: 6, name: 'devs', permission: 'write' }] }))
    expect(await forgejoProvider.listOrgTeams!(forge.baseUrl, 'tok', 'acme')).toEqual([{ name: 'devs', label: 'devs' }])
  })

  it('setRepoTeam : sans corps ; déjà ajoutée (422) = succès ; inconnue (404) remonte', async () => {
    forge.route('PUT', `${F}/repos/acme/proj/teams/devs`, () => ({ status: 422, json: { message: "team 'devs' is already added to repo" } }))
    await forgejoProvider.setRepoTeam!(forge.baseUrl, 'tok', 'acme', 'proj', 'devs', 'admin')
    expect(forge.requests.at(-1)!.body).toBe('')
    forge.route('PUT', `${F}/repos/acme/proj/teams/x`, () => ({ status: 404, json: { message: 'team does not exist' } }))
    await expect(forgejoProvider.setRepoTeam!(forge.baseUrl, 'tok', 'acme', 'proj', 'x')).rejects.toThrow(/404/)
  })
})

describe('GitHub', () => {
  const scopes = (s: string) => ({ 'X-OAuth-Scopes': s })

  it('listOwners : admin → oui ; membre → members_can_create_repositories, inconnu si absent, exclu si faux', async () => {
    forge.route('GET', `${G}/user`, () => ({ status: 200, json: { login: 'octo' }, headers: scopes('repo, read:org, user:email') }))
    forge.route('GET', `${G}/user/memberships/orgs`, () => ({ status: 200, json: [
      { state: 'active', role: 'admin', organization: { login: 'mine' } },
      { state: 'active', role: 'member', organization: { login: 'open' } },
      { state: 'active', role: 'member', organization: { login: 'closed' } },
      { state: 'active', role: 'member', organization: { login: 'silent' } },
    ] }))
    forge.route('GET', `${G}/orgs/open`, () => ({ status: 200, json: { login: 'open', members_can_create_repositories: true } }))
    forge.route('GET', `${G}/orgs/closed`, () => ({ status: 200, json: { login: 'closed', members_can_create_repositories: false } }))
    // Non-admin : champ absent (mesuré `null` pour un non-membre).
    forge.route('GET', `${G}/orgs/silent`, () => ({ status: 200, json: { login: 'silent', members_can_create_repositories: null } }))
    expect(await githubProvider.listOwners!(forge.baseUrl, 'gh', 'octo')).toEqual({
      owners: [
        { name: 'octo', label: '', kind: 'user', canCreate: true },
        { name: 'mine', label: '', kind: 'org', canCreate: true },
        { name: 'open', label: '', kind: 'org', canCreate: true },
        { name: 'silent', label: '', kind: 'org', canCreate: 'unknown' },
      ],
    })
    expect(forge.requests.find(r => r.path === `${G}/user/memberships/orgs`)!.query.get('state')).toBe('active')
  })

  it('listOwners sans read:org : organisations publiques, scopeMissing', async () => {
    forge.route('GET', `${G}/user`, () => ({ status: 200, json: { login: 'octo' }, headers: scopes('repo, user:email') }))
    forge.route('GET', `${G}/user/orgs`, () => ({ status: 200, json: [{ login: 'pub' }] }))
    forge.route('GET', `${G}/orgs/pub`, () => ({ status: 200, json: { login: 'pub' } }))
    expect(await githubProvider.listOwners!(forge.baseUrl, 'gh', 'octo')).toEqual({
      owners: [{ name: 'octo', label: '', kind: 'user', canCreate: true }, { name: 'pub', label: '', kind: 'org', canCreate: 'unknown' }],
      scopeMissing: true,
    })
  })

  it('createRepo : corps sans default_branch ; nom pris (422) ; organisation refusée (403)', async () => {
    forge.route('POST', `${G}/orgs/acme/repos`, () => ({ status: 201, json: repo('acme/proj') }))
    const input = { owner: 'acme', ownerKind: 'org' as const, name: 'proj', description: 'D', visibility: 'private' as const, defaultBranch: 'int-x' }
    expect((await githubProvider.createRepo!(forge.baseUrl, 'gh', input)).fullName).toBe('acme/proj')
    expect(body()).toEqual({ name: 'proj', description: 'D', private: true, auto_init: false })
    forge.route('POST', `${G}/orgs/acme/repos`, () => ({ status: 422, json: {
      message: 'Repository creation failed.', errors: [{ resource: 'Repository', code: 'custom', field: 'name', message: 'name already exists on this account' }],
    } }))
    forge.route('GET', `${G}/repos/acme/proj`, () => ({ status: 200, json: repo('acme/proj') }))
    await expect(githubProvider.createRepo!(forge.baseUrl, 'gh', input)).rejects.toBeInstanceOf(RepoNameTakenError)
    forge.route('POST', `${G}/orgs/acme/repos`, () => ({ status: 403, json: { message: 'You need admin access to the organization before adding a repository to it.' } }))
    await expect(githubProvider.createRepo!(forge.baseUrl, 'gh', input)).rejects.toBeInstanceOf(OwnerCreateForbiddenError)
  })

  it('createRepo : nom invalide refusé sans appel (GitHub le renommerait) ; nom rendu différent → erreur', async () => {
    const input = { owner: 'octo', ownerKind: 'user' as const, name: 'bad name!', description: '', visibility: 'private' as const }
    await expect(githubProvider.createRepo!(forge.baseUrl, 'gh', input)).rejects.toBeInstanceOf(InvalidRepoNameError)
    expect(forge.requests).toHaveLength(0)
    forge.route('POST', `${G}/user/repos`, () => ({ status: 201, json: repo('octo/autre') }))
    await expect(githubProvider.createRepo!(forge.baseUrl, 'gh', { ...input, name: 'proj' })).rejects.toThrow(/« octo\/autre » au lieu de « octo\/proj »/)
  })

  it('updateRepo : visibilité en cours de changement → VisibilityChangeError inProgress', async () => {
    forge.route('PATCH', `${G}/repos/acme/proj`, req => 'private' in JSON.parse(req.body)
      ? { status: 422, json: { message: 'Failed to update visibility. A previous visibility change is still in progress.' } }
      : { status: 200, json: repo('acme/proj') })
    const err = await githubProvider.updateRepo!(forge.baseUrl, 'gh', 'acme', 'proj', { description: 'x', visibility: 'private' }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(VisibilityChangeError)
    expect((err as VisibilityChangeError).inProgress).toBe(true)
    expect((err as Error).message).toMatch(/encore en cours/)
  })

  it('listCollaborators : role_name (triage, maintain tels quels), propriétaire exclu, affiliation=direct', async () => {
    forge.route('GET', `${G}/repos/octo/proj/collaborators`, () => ({ status: 200, json: [
      { login: 'octo', role_name: 'admin' }, { login: 'seb', role_name: 'triage' }, { login: 'ann', role_name: 'write' },
    ] }))
    expect(await githubProvider.listCollaborators!(forge.baseUrl, 'gh', 'octo', 'proj')).toEqual([
      { login: 'ann', level: 'write' }, { login: 'seb', level: 'triage' },
    ])
    expect(forge.requests.at(-1)!.query.get('affiliation')).toBe('direct')
  })

  it('setCollaborator : 201 → invited, 204 → added ; invitation en attente → PATCH de l\'invitation', async () => {
    forge.route('GET', `${G}/repos/acme/proj/invitations`, () => ({ status: 200, json: [] }))
    forge.route('PUT', `${G}/repos/acme/proj/collaborators/seb`, () => ({ status: 201, json: { id: 7, permissions: 'read' } }))
    expect(await githubProvider.setCollaborator!(forge.baseUrl, 'gh', 'acme', 'proj', 'seb', 'read')).toBe('invited')
    expect(body()).toEqual({ permission: 'pull' })
    forge.route('PUT', `${G}/repos/acme/proj/collaborators/seb`, () => ({ status: 204, text: '' }))
    expect(await githubProvider.setCollaborator!(forge.baseUrl, 'gh', 'acme', 'proj', 'seb', 'write')).toBe('added')
    expect(body()).toEqual({ permission: 'push' })
    forge.route('GET', `${G}/repos/acme/proj/invitations`, () => ({ status: 200, json: [{ id: 7, invitee: { login: 'SEB' }, permissions: 'read' }] }))
    forge.route('PATCH', `${G}/repos/acme/proj/invitations/7`, () => ({ status: 200, json: { id: 7, permissions: 'write' } }))
    expect(await githubProvider.setCollaborator!(forge.baseUrl, 'gh', 'acme', 'proj', 'seb', 'write')).toBe('invited')
    expect(body()).toEqual({ permissions: 'write' })
    forge.route('GET', `${G}/repos/acme/proj/invitations`, () => ({ status: 200, json: [] }))
    forge.route('PUT', `${G}/repos/acme/proj/collaborators/nobody`, () => ({ status: 404, json: { message: 'Not Found' } }))
    await expect(githubProvider.setCollaborator!(forge.baseUrl, 'gh', 'acme', 'proj', 'nobody', 'read')).rejects.toBeInstanceOf(UnknownAccountError)
  })

  it('invitations : liste, annulation, 404 à la seconde annulation = succès', async () => {
    forge.route('GET', `${G}/repos/acme/proj/invitations`, () => ({ status: 200, json: [{ id: 7, invitee: { login: 'seb' }, permissions: 'triage' }] }))
    expect(await githubProvider.listInvitations!(forge.baseUrl, 'gh', 'acme', 'proj')).toEqual([{ id: 7, login: 'seb', level: 'triage' }])
    forge.route('DELETE', `${G}/repos/acme/proj/invitations/7`, () => ({ status: 404, json: { message: 'Not Found' } }))
    await githubProvider.cancelInvitation!(forge.baseUrl, 'gh', 'acme', 'proj', 7)
  })

  it('équipes : slug, niveau par repo modifiable, appels sur /orgs/{org}/teams/{slug}/repos', async () => {
    forge.route('GET', `${G}/repos/acme/proj/teams`, () => ({ status: 200, json: [{ name: 'Probe Devs', slug: 'probe-devs', permission: 'push' }] }))
    expect(await githubProvider.listRepoTeams!(forge.baseUrl, 'gh', 'acme', 'proj')).toEqual([
      { name: 'probe-devs', label: 'Probe Devs', level: 'write', levelEditable: true, removable: true },
    ])
    forge.route('PUT', `${G}/orgs/acme/teams/probe-devs/repos/acme/proj`, () => ({ status: 204, text: '' }))
    await githubProvider.setRepoTeam!(forge.baseUrl, 'gh', 'acme', 'proj', 'probe-devs', 'admin')
    expect(body()).toEqual({ permission: 'admin' })
    forge.route('DELETE', `${G}/orgs/acme/teams/probe-devs/repos/acme/proj`, () => ({ status: 204, text: '' }))
    await githubProvider.removeRepoTeam!(forge.baseUrl, 'gh', 'acme', 'proj', 'probe-devs')
    forge.route('GET', `${G}/orgs/acme/teams`, () => ({ status: 200, json: [{ name: 'Probe Devs', slug: 'probe-devs' }] }))
    expect(await githubProvider.listOrgTeams!(forge.baseUrl, 'gh', 'acme')).toEqual([{ name: 'probe-devs', label: 'Probe Devs' }])
  })

  it('pagination : 100 par page jusqu\'à une page incomplète', async () => {
    const all = Array.from({ length: 101 }, (_, i) => ({ login: `u${String(i).padStart(3, '0')}`, role_name: 'read' }))
    forge.route('GET', `${G}/repos/acme/proj/collaborators`, req => {
      const page = Number(req.query.get('page')); const per = Number(req.query.get('per_page'))
      return { status: 200, json: all.slice((page - 1) * per, page * per) }
    })
    expect(await githubProvider.listCollaborators!(forge.baseUrl, 'gh', 'acme', 'proj')).toHaveLength(101)
    expect(forge.requests.map(r => r.query.get('page'))).toEqual(['1', '2'])
  })
})
