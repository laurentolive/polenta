import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PolentaRepoService } from './polenta-repo.service'
import { SyncService } from './sync.service'
import { WorkspaceTreeService } from './workspace-tree.service'

// GH21 — un pin sur un tag annoté (baseline) : `resolveRef` donne l'objet tag, pas le commit. Le repo
// était jugé désynchronisé à chaque ouverture : fetch réseau, et échec hors ligne.

const AUTHOR = { name: 'Testeur', email: 't@x' }
let ws: string
let comp: string
let root: string

async function initRepo(dir: string): Promise<string> {
  await fsP.mkdir(dir, { recursive: true })
  await git.init({ fs, dir, defaultBranch: 'main' })
  await fsP.writeFile(path.join(dir, 'README.md'), 'x')
  await git.add({ fs, dir, filepath: 'README.md' })
  return git.commit({ fs, dir, message: 'init', author: AUTHOR })
}

async function buildWithPin(pin: string) {
  await fsP.writeFile(path.join(root, 'polenta-repo.yaml'), `dependencies:\n  - name: comp\n    url: https://forge.test/comp.git\n    pin: ${pin}\n`)
  // Hors ligne : le moindre accès réseau échoue, comme dans l'issue.
  const fetch = vi.fn(async () => { throw new Error('HTTP Error: 404') })
  const service = new WorkspaceTreeService({ fetch } as unknown as SyncService, new PolentaRepoService(), undefined, 1)
  return { result: await service.buildTree(ws, root, []), fetch }
}

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh21-'))
  root = path.join(ws, 'root')
  comp = path.join(ws, 'comp')
  await initRepo(root)
  const sha = await initRepo(comp)
  await git.annotatedTag({ fs, dir: comp, ref: 'RE2', message: 'baseline RE2', object: sha, tagger: AUTHOR })
  await git.tag({ fs, dir: comp, ref: 'v2.0', object: sha })
})

afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true })
})

describe('WorkspaceTreeService — pin sur un tag annoté (GH21)', () => {
  it('HEAD sur le commit du tag : déjà au bon pin, aucun accès réseau', async () => {
    const sha = await git.resolveRef({ fs, dir: comp, ref: 'HEAD' })
    await git.checkout({ fs, dir: comp, ref: sha })
    const { result, fetch } = await buildWithPin('RE2')
    expect(fetch).not.toHaveBeenCalled()
    expect(result.status).toBe('ok')
  })

  it('HEAD posé par un checkout du tag lui-même : déjà au bon pin', async () => {
    await git.checkout({ fs, dir: comp, ref: 'RE2' })
    const { result, fetch } = await buildWithPin('RE2')
    expect(fetch).not.toHaveBeenCalled()
    expect(result.status).toBe('ok')
  })

  it('tag léger : comportement inchangé', async () => {
    const { result, fetch } = await buildWithPin('v2.0')
    expect(fetch).not.toHaveBeenCalled()
    expect(result.status).toBe('ok')
  })

  it('HEAD sur un autre commit que le tag annoté : le repo reste désynchronisé', async () => {
    await fsP.writeFile(path.join(comp, 'README.md'), 'y')
    await git.add({ fs, dir: comp, filepath: 'README.md' })
    await git.commit({ fs, dir: comp, message: 'suite', author: AUTHOR })
    const { fetch } = await buildWithPin('RE2')
    expect(fetch).toHaveBeenCalled()
  })
})

describe('SyncService.resolveTag (GH21)', () => {
  const sync = () => new SyncService({} as never)

  it('tag annoté : renvoie le commit, pas l\'objet tag', async () => {
    const sha = await git.resolveRef({ fs, dir: comp, ref: 'HEAD' })
    expect(await sync().resolveTag(comp, 'RE2')).toBe(sha)
  })

  it('tag léger : renvoie le commit ; tag absent : null', async () => {
    const sha = await git.resolveRef({ fs, dir: comp, ref: 'HEAD' })
    expect(await sync().resolveTag(comp, 'v2.0')).toBe(sha)
    expect(await sync().resolveTag(comp, 'absent')).toBeNull()
  })
})
