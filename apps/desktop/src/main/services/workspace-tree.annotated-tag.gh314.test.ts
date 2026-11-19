import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IntegrationBranchService } from './integration-branch.service'
import { PolentaRepoService } from './polenta-repo.service'
import { SyncService } from './sync.service'
import { WorkspaceTreeService } from './workspace-tree.service'
import { TestRepo } from '../git/test-repo.test-util'

// GH314 (GH106 S2-5) — un composant épinglé sur un tag annoté était positionné sur l'objet tag :
// un checkout qui écrit l'id de l'objet tag dans HEAD (ancien moteur) ; le commit du tag doit être
// retrouvé. Le sélecteur de branche ne retrouvait plus le tag (résolu en commit) et affichait un sha.
// Le moteur natif ne produit plus cet état : les tests le posent directement dans `.git/HEAD`.

const AUTHOR = { name: 'Testeur', email: 't@x' }
let ws: string
let comp: string
let root: string
let tagCommit: string
let tagObject: string

async function commitFile(dir: string, content: string, message: string): Promise<string> {
  await fsP.writeFile(path.join(dir, 'README.md'), content)
  await new TestRepo(dir).add(['README.md'])
  return new TestRepo(dir).commit(message, AUTHOR)
}

async function initRepo(dir: string): Promise<string> {
  await fsP.mkdir(dir, { recursive: true })
  await TestRepo.init(dir, 'main')
  return commitFile(dir, 'x', 'init')
}

async function readHeadFile(dir: string): Promise<string> {
  return (await fsP.readFile(path.join(dir, '.git', 'HEAD'), 'utf8')).trim()
}

/** HEAD posé directement sur `oid` (détaché, sans passer par checkout). */
async function setHeadRaw(dir: string, oid: string): Promise<void> {
  await fsP.writeFile(path.join(dir, '.git', 'HEAD'), `${oid}\n`)
}

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh314-'))
  root = path.join(ws, 'root')
  comp = path.join(ws, 'comp')
  await initRepo(root)
  tagCommit = await initRepo(comp)
  await new TestRepo(comp).annotatedTag('v2.0', tagCommit, 'release v2.0', AUTHOR)
  tagObject = await new TestRepo(comp).resolve('refs/tags/v2.0')
  // Le composant a avancé après le tag : il faut un checkout pour rejoindre le pin.
  await commitFile(comp, 'y', 'suite')
})

afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true })
})

describe('WorkspaceTreeService — checkout d\'un pin sur un tag annoté (GH314)', () => {
  it('HEAD est posé sur le commit du tag, pas sur l\'objet tag', async () => {
    expect(tagObject).not.toBe(tagCommit)
    await fsP.writeFile(path.join(root, 'polenta-repo.yaml'),
      'dependencies:\n  - name: comp\n    url: https://forge.test/comp.git\n    pin: v2.0\n')
    const fetch = vi.fn(async () => undefined)
    const service = new WorkspaceTreeService({ fetch } as unknown as SyncService, new PolentaRepoService(), undefined, 1)

    const result = await service.buildTree(ws, root, [])

    expect(fetch).toHaveBeenCalled()
    expect(result.status).toBe('ok')
    expect(await readHeadFile(comp)).toBe(tagCommit)
    expect(await fsP.readFile(path.join(comp, 'README.md'), 'utf8')).toBe('x')
  })

  it('HEAD laissé sur l\'objet tag par un checkout antérieur : reposé sur le commit, sans réseau', async () => {
    await setHeadRaw(comp, tagObject)
    expect(await readHeadFile(comp)).toBe(tagObject)
    await fsP.writeFile(path.join(root, 'polenta-repo.yaml'),
      'dependencies:\n  - name: comp\n    url: https://forge.test/comp.git\n    pin: v2.0\n')
    const fetch = vi.fn(async () => undefined)
    const service = new WorkspaceTreeService({ fetch } as unknown as SyncService, new PolentaRepoService(), undefined, 1)

    const result = await service.buildTree(ws, root, [])

    expect(result.status).toBe('ok')
    expect(fetch).not.toHaveBeenCalled()
    expect(await readHeadFile(comp)).toBe(tagCommit)
  })

  it('pin sur une branche : HEAD reste attaché à la branche', async () => {
    await new TestRepo(comp).branch('release', tagCommit)
    await fsP.writeFile(path.join(root, 'polenta-repo.yaml'),
      'dependencies:\n  - name: comp\n    url: https://forge.test/comp.git\n    pin: release\n')
    const fetch = vi.fn(async () => undefined)
    const service = new WorkspaceTreeService({ fetch } as unknown as SyncService, new PolentaRepoService(), undefined, 1)

    const result = await service.buildTree(ws, root, [])

    expect(result.status).toBe('ok')
    expect(await readHeadFile(comp)).toBe('ref: refs/heads/release')
  })
})

describe('SyncService.checkoutBranch — tag annoté choisi dans le sélecteur (GH314)', () => {
  it('HEAD détaché sur le commit du tag', async () => {
    const result = await new SyncService({} as never).checkoutBranch(comp, 'v2.0')
    expect(result.branch).toBe('v2.0')
    expect(await readHeadFile(comp)).toBe(tagCommit)
    expect(await fsP.readFile(path.join(comp, 'README.md'), 'utf8')).toBe('x')
  })

  it('branche locale : HEAD attaché, comportement inchangé', async () => {
    await new TestRepo(comp).branch('release', tagCommit)
    await new SyncService({} as never).checkoutBranch(comp, 'release')
    expect(await readHeadFile(comp)).toBe('ref: refs/heads/release')
  })
})

describe('SyncService.createBranch — HEAD laissé sur un objet tag (GH314)', () => {
  it('la branche créée pointe sur le commit du tag', async () => {
    await setHeadRaw(comp, tagObject)
    await new SyncService({} as never).createBranch(comp, 'int-v2')
    expect(await new TestRepo(comp).resolve('refs/heads/int-v2')).toBe(tagCommit)
    expect(await readHeadFile(comp)).toBe('ref: refs/heads/int-v2')
  })
})

describe('IntegrationBranchService.state — HEAD laissé sur un objet tag (GH314)', () => {
  it('headOid est le commit du tag, pour un dossier positionné avant le correctif', async () => {
    await setHeadRaw(comp, tagObject)
    const sync = new SyncService({} as never)
    const gitService = { getIntegrationBranch: async () => 'main' }
    const service = new IntegrationBranchService(gitService as never, sync, {} as never)
    const state = await service.state(comp)
    expect(state.headOid).toBe(tagCommit)
  })
})
