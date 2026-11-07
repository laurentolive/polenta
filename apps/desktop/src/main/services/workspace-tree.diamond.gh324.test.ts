import * as fs from 'fs'
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MountOverride } from '@polenta/types'
import { PolentaRepoService } from './polenta-repo.service'
import type { SyncService } from './sync.service'
import { WorkspaceTreeService } from './workspace-tree.service'

// GH324 — détection des conflits en diamant : regroupée par nom de montage (dossier), plus par URL.
// Avant : la résolution par la modale (mountAs) ne pouvait jamais aboutir, et une 2ᵉ déclaration
// du même nom avec un autre pin / une autre URL était ignorée sans message.

const AUTHOR = { name: 'Testeur', email: 't@x' }
const URL_A = 'https://forge.test/a.git'
const URL_B = 'https://forge.test/b.git'
const URL_COMP = 'https://forge.test/comp.git'
const URL_OTHER = 'https://forge.test/other.git'
let ws: string

/** Repo git sur la branche `branch` (le pin d'une dépendance montée y est donc déjà satisfait). */
async function initRepo(name: string, branch = 'main', manifest?: string): Promise<void> {
  const dir = path.join(ws, name)
  await fsP.mkdir(dir, { recursive: true })
  await git.init({ fs, dir, defaultBranch: branch })
  await fsP.writeFile(path.join(dir, 'README.md'), name)
  await git.add({ fs, dir, filepath: 'README.md' })
  await git.commit({ fs, dir, message: 'init', author: AUTHOR })
  if (manifest !== undefined) await fsP.writeFile(path.join(dir, 'polenta-repo.yaml'), manifest)
}

function deps(...list: Array<{ name: string; url: string; pin: string }>): string {
  return 'dependencies:\n' + list.map(d => `  - name: ${d.name}\n    url: ${d.url}\n    pin: ${d.pin}\n`).join('')
}

/** Racine → A, B ; A et B déclarent chacun une dépendance. Aucun accès réseau autorisé. */
async function diamond(fromA: { name: string; url: string; pin: string }, fromB: { name: string; url: string; pin: string }) {
  await initRepo('root', 'main', deps({ name: 'A', url: URL_A, pin: 'main' }, { name: 'B', url: URL_B, pin: 'main' }))
  await initRepo('A', 'main', deps(fromA))
  await initRepo('B', 'main', deps(fromB))
}

function build(overrides: MountOverride[] = []) {
  const offline = vi.fn(async () => { throw new Error('HTTP Error: 404') })
  const service = new WorkspaceTreeService(
    { fetch: offline, clone: offline } as unknown as SyncService, new PolentaRepoService(), undefined, 1,
  )
  return service.buildTree(ws, path.join(ws, 'root'), overrides)
}

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh324-'))
})

afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true })
})

describe('WorkspaceTreeService — conflits en diamant (GH324)', () => {
  it('diamant partagé (même nom, même url, même pin) : un seul montage, pas de conflit', async () => {
    await diamond({ name: 'comp', url: URL_COMP, pin: 'int-A' }, { name: 'comp', url: URL_COMP, pin: 'int-A' })
    await initRepo('comp', 'int-A')
    const result = await build()
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.tree.nodes.map(n => n.name).sort()).toEqual(['A', 'B', 'comp', 'root'])
  })

  it('même nom, même url, pins différents : conflit signalé (plus d\'écrasement silencieux)', async () => {
    await diamond({ name: 'comp', url: URL_COMP, pin: 'int-A' }, { name: 'comp', url: URL_COMP, pin: 'int-B' })
    await initRepo('comp', 'int-A')
    const result = await build()
    expect(result).toEqual({
      status: 'diamond-conflict',
      conflicts: [{
        url: URL_COMP,
        mountName: 'comp',
        pins: [
          { pin: 'int-A', url: URL_COMP, requiredBy: ['A'] },
          { pin: 'int-B', url: URL_COMP, requiredBy: ['B'] },
        ],
      }],
    })
  })

  it('même nom, url différentes : conflit signalé', async () => {
    await diamond({ name: 'comp', url: URL_COMP, pin: 'main' }, { name: 'comp', url: URL_OTHER, pin: 'main' })
    await initRepo('comp', 'main')
    const result = await build()
    expect(result.status).toBe('diamond-conflict')
    if (result.status !== 'diamond-conflict') return
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].mountName).toBe('comp')
    expect(result.conflicts[0].pins).toEqual([
      { pin: 'main', url: URL_COMP, requiredBy: ['A'] },
      { pin: 'main', url: URL_OTHER, requiredBy: ['B'] },
    ])
  })

  it('résolution par la modale (un nom par version) : le workspace s\'ouvre avec les deux montages', async () => {
    await diamond({ name: 'comp', url: URL_COMP, pin: 'int-A' }, { name: 'comp', url: URL_COMP, pin: 'int-B' })
    await initRepo('comp-a', 'int-A')
    await initRepo('comp-b', 'int-B')
    const result = await build([
      { url: URL_COMP, pin: 'int-A', mountAs: 'comp-a' },
      { url: URL_COMP, pin: 'int-B', mountAs: 'comp-b' },
    ])
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const byName = new Map(result.tree.nodes.map(n => [n.name, n]))
    expect([...byName.keys()].sort()).toEqual(['A', 'B', 'comp-a', 'comp-b', 'root'])
    expect(byName.get('comp-a')).toMatchObject({ url: URL_COMP, pin: 'int-A', repoPath: path.join(ws, 'comp-a') })
    expect(byName.get('comp-b')).toMatchObject({ url: URL_COMP, pin: 'int-B', repoPath: path.join(ws, 'comp-b') })
    const childrenOf = (name: string) =>
      result.tree.logicalTree.children.find(c => c.name === name)!.children.map(c => c.name)
    expect(childrenOf('A')).toEqual(['comp-a'])
    expect(childrenOf('B')).toEqual(['comp-b'])
  })

  it('résolution partielle (une seule version renommée, l\'autre garde le nom déclaré) : ouvert', async () => {
    await diamond({ name: 'comp', url: URL_COMP, pin: 'int-A' }, { name: 'comp', url: URL_COMP, pin: 'int-B' })
    await initRepo('comp', 'int-A')
    await initRepo('comp-b', 'int-B')
    const result = await build([{ url: URL_COMP, pin: 'int-B', mountAs: 'comp-b' }])
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.tree.nodes.map(n => `${n.name}@${n.pin}`).sort()).toEqual(['A@main', 'B@main', 'comp-b@int-B', 'comp@int-A', 'root@'])
  })

  it('nom choisi déjà pris par un autre montage : le conflit est de nouveau signalé', async () => {
    await initRepo('root', 'main', deps(
      { name: 'A', url: URL_A, pin: 'main' },
      { name: 'B', url: URL_B, pin: 'main' },
      { name: 'other', url: URL_OTHER, pin: 'main' },
    ))
    await initRepo('A', 'main', deps({ name: 'comp', url: URL_COMP, pin: 'int-A' }))
    await initRepo('B', 'main', deps({ name: 'comp', url: URL_COMP, pin: 'int-B' }))
    await initRepo('comp', 'int-A')
    await initRepo('other', 'main')
    const result = await build([{ url: URL_COMP, pin: 'int-B', mountAs: 'other' }])
    expect(result.status).toBe('diamond-conflict')
    if (result.status !== 'diamond-conflict') return
    expect(result.conflicts.map(c => c.mountName)).toEqual(['other'])
  })

  it('déclaration directe : même url sous deux noms dans un même manifeste, pas de conflit', async () => {
    await initRepo('root', 'main', deps(
      { name: 'comp-int-a', url: URL_COMP, pin: 'int-A' },
      { name: 'comp-int-b', url: URL_COMP, pin: 'int-B' },
    ))
    await initRepo('comp-int-a', 'int-A')
    await initRepo('comp-int-b', 'int-B')
    const result = await build()
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.tree.nodes.map(n => n.name).sort()).toEqual(['comp-int-a', 'comp-int-b', 'root'])
  })
})
