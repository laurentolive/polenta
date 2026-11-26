import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PolentaRepoService } from './polenta-repo.service'
import { SyncService } from './sync.service'
import { WorkspaceTreeService } from './workspace-tree.service'
import { TestRepo } from '../git/test-repo.test-util'

// GH454 — un composant épinglé sur un commit et placé sur une branche qui contient ce commit
// (branche qui a avancé : publication, mise en conformité, pull) était remis sur le commit à chaque
// reconstruction de l'arbre : HEAD détaché sans prévenir, commits de la branche absents du dossier.

const AUTHOR = { name: 'Testeur', email: 't@x' }
let ws: string
let comp: string
let root: string
let pinned: string

async function commitFile(dir: string, file: string, content: string, message: string): Promise<string> {
  await fsP.writeFile(path.join(dir, file), content)
  await new TestRepo(dir).add([file])
  return new TestRepo(dir).commit(message, AUTHOR)
}

async function initRepo(dir: string): Promise<string> {
  await fsP.mkdir(dir, { recursive: true })
  await TestRepo.init(dir, 'main')
  return commitFile(dir, 'README.md', 'x', 'init')
}

async function readHeadFile(dir: string): Promise<string> {
  return (await fsP.readFile(path.join(dir, '.git', 'HEAD'), 'utf8')).trim()
}

async function pinComp(pin: string): Promise<void> {
  await fsP.writeFile(path.join(root, 'polenta-repo.yaml'),
    `dependencies:\n  - name: comp\n    url: https://forge.test/comp.git\n    pin: ${pin}\n`)
}

function makeService(fetch = vi.fn(async () => undefined)) {
  return { fetch, service: new WorkspaceTreeService({ fetch } as unknown as SyncService, new PolentaRepoService(), undefined, 1) }
}

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh454-'))
  root = path.join(ws, 'root')
  comp = path.join(ws, 'comp')
  await initRepo(root)
  pinned = await initRepo(comp)
  await new TestRepo(comp).branch('int-X', pinned)
  await new SyncService({} as never).checkoutBranch(comp, 'int-X')
  await pinComp(pinned)
})

afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true })
})

describe('WorkspaceTreeService — pin sur un commit, composant sur une branche (GH454)', () => {
  it('branche qui contient le commit épinglé et a avancé : laissée sur la branche, sans réseau', async () => {
    await commitFile(comp, 'conformite.txt', 'c', 'mise en conformité')
    const { fetch, service } = makeService()

    const result = await service.buildTree(ws, root, [])

    expect(result.status).toBe('ok')
    expect(fetch).not.toHaveBeenCalled()
    expect(await readHeadFile(comp)).toBe('ref: refs/heads/int-X')
    expect(await fsP.readFile(path.join(comp, 'conformite.txt'), 'utf8')).toBe('c')
  })

  it('séquence réelle : branche choisie → commit dans le composant → commit dans le produit → reconstruction', async () => {
    const { service } = makeService()
    expect((await service.buildTree(ws, root, [])).status).toBe('ok')
    expect(await readHeadFile(comp)).toBe('ref: refs/heads/int-X')

    await commitFile(comp, 'exigence.yaml', 'e', 'Ajout exigence')
    expect((await service.buildTree(ws, root, [])).status).toBe('ok')
    expect(await readHeadFile(comp)).toBe('ref: refs/heads/int-X')

    await commitFile(root, 'autre.txt', 'a', 'commit produit')
    expect((await service.buildTree(ws, root, [])).status).toBe('ok')
    expect(await readHeadFile(comp)).toBe('ref: refs/heads/int-X')
    expect(await fsP.readFile(path.join(comp, 'exigence.yaml'), 'utf8')).toBe('e')
  })

  it('pin déplacé sur un commit absent de la branche : checkout du commit (HEAD détaché)', async () => {
    // Un collègue a épinglé un commit d'une autre ligne : le pin s'applique toujours.
    await new TestRepo(comp).branch('autre', pinned)
    await new SyncService({} as never).checkoutBranch(comp, 'autre')
    const other = await commitFile(comp, 'autre.txt', 'o', 'autre ligne')
    await new SyncService({} as never).checkoutBranch(comp, 'int-X')
    await commitFile(comp, 'conformite.txt', 'c', 'mise en conformité')
    await pinComp(other)
    const { service } = makeService()

    const result = await service.buildTree(ws, root, [])

    expect(result.status).toBe('ok')
    expect(await readHeadFile(comp)).toBe(other)
  })

  it('HEAD détaché sur un descendant du commit épinglé : remis sur le pin (inchangé)', async () => {
    const ahead = await commitFile(comp, 'conformite.txt', 'c', 'mise en conformité')
    await fsP.writeFile(path.join(comp, '.git', 'HEAD'), `${ahead}\n`)
    const { service } = makeService()

    const result = await service.buildTree(ws, root, [])

    expect(result.status).toBe('ok')
    expect(await readHeadFile(comp)).toBe(pinned)
  })

  it('pin abrégé (7 caractères) : même règle', async () => {
    await pinComp(pinned.slice(0, 7))
    await commitFile(comp, 'conformite.txt', 'c', 'mise en conformité')
    const { service } = makeService()

    expect((await service.buildTree(ws, root, [])).status).toBe('ok')
    expect(await readHeadFile(comp)).toBe('ref: refs/heads/int-X')
  })
})
