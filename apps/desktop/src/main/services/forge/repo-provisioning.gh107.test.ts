import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateRepoRequest, ForgeRepo } from '@polenta/types'

import { WorkspaceService } from '../workspace.service'
import type { IntegrationBranchService } from '../integration-branch.service'
import type { SyncService } from '../sync.service'
import type { HostContext } from '../../host/host-context'
import type { ForgeService } from './forge.service'
import { RepoNameTakenError } from './forge-provider'
import { RepoProvisioningService } from './repo-provisioning.service'

/**
 * GH107 sprint 2 — création d'un repo (specs/GH107-tests.md C-01 à C-08) : vrai repo git local,
 * forge et push simulés (les appels de forge sont couverts par forge-repo-api.gh107.test.ts).
 */

let dir: string
let calls: string[]
let forge: { createRemote: ReturnType<typeof vi.fn>; alignDefaultBranch: ReturnType<typeof vi.fn>; grantMember: ReturnType<typeof vi.fn> }
let pushBranch: ReturnType<typeof vi.fn>
let workspace: WorkspaceService
let service: RepoProvisioningService

const REMOTE: ForgeRepo = {
  fullName: 'acme/proj', owner: 'acme', name: 'proj', description: 'Desc', cloneUrl: 'https://forge.test/acme/proj.git', readOnly: false,
}

function request(over: Partial<CreateRepoRequest> = {}): CreateRepoRequest {
  return {
    accountKey: 'forge.test:bob', owner: 'acme', ownerKind: 'org', name: 'proj', description: '  Le projet  ', visibility: 'private',
    integrationSuffix: 'x', members: [], target: { kind: 'project', containerDir: dir }, ...over,
  }
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh107-prov-'))
  calls = []
  forge = {
    createRemote: vi.fn(async () => { calls.push('remote'); return REMOTE }),
    alignDefaultBranch: vi.fn(async () => { calls.push('defaultBranch'); return 'set' }),
    grantMember: vi.fn(async (_k: string, _o: string, _r: string, g: { name: string }) => { calls.push(`member:${g.name}`); return 'added' }),
  }
  pushBranch = vi.fn(async (_d: string, b: string) => { calls.push(`push:${b}`) })
  const ctx = { userDataDir: dir, machineConfig: { hideGithub: false } } as unknown as HostContext
  workspace = new WorkspaceService(ctx, { pushBranch } as unknown as SyncService)
  service = new RepoProvisioningService(forge as unknown as ForgeService, workspace, { pushBranch } as unknown as SyncService, {} as IntegrationBranchService)
})

afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

describe('RepoProvisioningService.create', () => {
  it('C-01 / C-02 — projet : un seul commit sur int-x (README, project.yaml), aucune branche main, étapes dans l\'ordre', async () => {
    const result = await service.create(request())
    const repo = path.join(dir, 'proj')
    expect(await git.listBranches({ fs, dir: repo })).toEqual(['int-x'])
    const log = await git.log({ fs, dir: repo })
    expect(log).toHaveLength(1)
    const files = await git.listFiles({ fs, dir: repo, ref: 'int-x' })
    expect(files).toEqual(expect.arrayContaining(['README.md', 'config/project.yaml', 'AGENTS.md', '.gitignore']))
    expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf-8')).toBe('# proj\n\nLe projet\n')
    expect(yaml.load(fs.readFileSync(path.join(repo, 'config', 'project.yaml'), 'utf-8'))).toEqual({ integrationBranch: 'int-x' })
    expect((await git.listRemotes({ fs, dir: repo }))[0].url).toBe(REMOTE.cloneUrl)
    expect(forge.createRemote).toHaveBeenCalledWith('forge.test:bob', {
      owner: 'acme', ownerKind: 'org', name: 'proj', description: 'Le projet', visibility: 'private', defaultBranch: 'int-x',
    })
    expect(calls).toEqual(['remote', 'push:int-x', 'defaultBranch'])
    expect(result.steps.map(s => `${s.id}:${s.status}`)).toEqual(['remote:done', 'local:done', 'push:done', 'defaultBranch:done', 'members:done', 'open:done'])
    expect(result).toMatchObject({ fullName: 'acme/proj', cloneUrl: REMOTE.cloneUrl, branch: 'int-x' })
    expect(result.open).toBeDefined()
    expect(fs.existsSync(path.join(dir, '.polenta', 'workspace.yaml'))).toBe(true)
  })

  it('C-03 — un appel par membre, après le push', async () => {
    const members = [{ kind: 'user' as const, name: 'ann', level: 'write' as const }, { kind: 'team' as const, name: 'devs', level: 'read' as const }]
    await service.create(request({ members }))
    expect(calls).toEqual(['remote', 'push:int-x', 'defaultBranch', 'member:ann', 'member:devs'])
    expect(forge.grantMember).toHaveBeenCalledWith('forge.test:bob', 'acme', 'proj', members[1])
  })

  it('C-04 — push en échec : repo distant gardé, push failed, suivantes skipped', async () => {
    pushBranch.mockRejectedValueOnce(new Error('réseau coupé'))
    const result = await service.create(request({ members: [{ kind: 'user', name: 'ann', level: 'read' }] }))
    expect(result.steps.map(s => `${s.id}:${s.status}`)).toEqual(['remote:done', 'local:done', 'push:failed', 'defaultBranch:skipped', 'members:skipped', 'open:skipped'])
    expect(result.steps[2].detail).toBe('réseau coupé')
    expect(result.fullName).toBe('acme/proj')
    expect(forge.alignDefaultBranch).not.toHaveBeenCalled()
    expect(forge.grantMember).not.toHaveBeenCalled()
  })

  it('C-05 — un membre en échec : les suivants sont appliqués, detail le nomme ; invitation signalée', async () => {
    forge.grantMember
      .mockRejectedValueOnce(new Error('Aucun compte « zed » sur le serveur.'))
      .mockResolvedValueOnce('invited')
    const result = await service.create(request({ members: [
      { kind: 'user', name: 'zed', level: 'read' }, { kind: 'user', name: 'seb', level: 'write' },
    ] }))
    const members = result.steps.find(s => s.id === 'members')!
    expect(members.status).toBe('failed')
    expect(members.detail).toBe('zed : Aucun compte « zed » sur le serveur.\nInvitation à accepter : seb')
    expect(forge.grantMember).toHaveBeenCalledTimes(2)
    expect(result.steps.find(s => s.id === 'open')!.status).toBe('done')
  })

  it('C-06 — nom pris juste avant la création : refus, aucune écriture locale', async () => {
    forge.createRemote.mockRejectedValueOnce(new RepoNameTakenError('acme/proj'))
    await expect(service.create(request())).rejects.toBeInstanceOf(RepoNameTakenError)
    expect(fs.existsSync(path.join(dir, 'proj'))).toBe(false)
  })

  it('validation avant toute écriture : description vide, branche invalide, nom invalide, dossier occupé', async () => {
    await expect(service.create(request({ description: '   ' }))).rejects.toThrow(/description est obligatoire/)
    await expect(service.create(request({ integrationSuffix: 'a b' }))).rejects.toThrow(/int-a b/)
    await expect(service.create(request({ name: 'bad name!' }))).rejects.toThrow(/invalide/)
    await fsP.mkdir(path.join(dir, 'proj'))
    await fsP.writeFile(path.join(dir, 'proj', 'x'), '')
    await expect(service.create(request())).rejects.toThrow(/existe déjà et n'est pas vide/)
    expect(forge.createRemote).not.toHaveBeenCalled()
  })

  it('C-07 — composant : dossier temporaire supprimé, cloneUrl et branche rendus, rien dans containerDir', async () => {
    let pushedFrom = ''
    pushBranch.mockImplementationOnce(async (d: string) => {
      pushedFrom = d
      expect(await git.listBranches({ fs, dir: d })).toEqual(['int-x'])
    })
    const result = await service.create(request({ target: { kind: 'component' } }))
    expect(result).toMatchObject({ cloneUrl: REMOTE.cloneUrl, branch: 'int-x' })
    expect(result.open).toBeUndefined()
    expect(result.steps.every(s => s.status === 'done')).toBe(true)
    expect(pushedFrom).not.toBe('')
    expect(fs.existsSync(pushedFrom)).toBe(false)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('C-08 — création locale sans options : toujours sur main, sans README ni project.yaml', async () => {
    const repo = path.join(dir, 'local')
    await workspace.initProjectRepo(repo)
    expect(await git.listBranches({ fs, dir: repo })).toEqual(['main'])
    expect(await git.listFiles({ fs, dir: repo, ref: 'main' })).not.toContain('README.md')
  })

  it('GH108 — forge qui impose le privé : public demandé, créé privé, signalé sans bloquer', async () => {
    forge.createRemote.mockResolvedValueOnce({ ...REMOTE, private: true })
    const result = await service.create(request({ visibility: 'public' }))
    expect(result.steps[0]).toMatchObject({ id: 'remote', status: 'admin' })
    expect(result.steps[0].detail).toMatch(/impose des dépôts privés/)
    expect(result.steps.find(s => s.id === 'open')!.status).toBe('done')
    // Privé demandé et obtenu : rien à signaler.
    forge.createRemote.mockResolvedValueOnce({ ...REMOTE, private: true })
    await fsP.rm(path.join(dir, 'proj'), { recursive: true, force: true })
    expect((await service.create(request())).steps[0]).toMatchObject({ id: 'remote', status: 'done' })
  })

  it('branche par défaut refusée (pas admin) : signalée, la suite continue', async () => {
    forge.alignDefaultBranch.mockResolvedValueOnce('not-admin')
    const result = await service.create(request())
    expect(result.steps.find(s => s.id === 'defaultBranch')).toEqual({ id: 'defaultBranch', status: 'admin', detail: 'À faire par un administrateur du repo.' })
    expect(result.steps.find(s => s.id === 'open')!.status).toBe('done')
  })
})
