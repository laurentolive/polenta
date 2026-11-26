import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PolentaRepoManifest, WorkspaceTreeNode } from '@polenta/types'

// GH454 — publier un composant remplaçait par le SHA du merge le pin d'un parent qui épinglait la
// branche d'intégration : le composant ne suivait plus la branche et repassait en HEAD détaché à
// la reconstruction suivante. `api` est simulé : manifestes en mémoire, rebuild toujours 'ok'.

const manifests = new Map<string, PolentaRepoManifest>()
const rebuildTree = vi.fn(async () => ({ status: 'ok' as const, tree: {} }))

vi.mock('../api', () => ({
  api: {
    polentaRepo: {
      get: vi.fn(async (repoPath: string) => structuredClone(manifests.get(repoPath) ?? null)),
      save: vi.fn(async (repoPath: string, m: PolentaRepoManifest) => { manifests.set(repoPath, structuredClone(m)) }),
    },
    workspace: { rebuildTree: (...args: unknown[]) => rebuildTree(...(args as [])) },
  },
}))

const { propagatePinToDependents } = await import('./workspaceActions')

const HMI = { name: 'hmi', url: 'https://forge.test/hmi.git' }
const node = (name: string): WorkspaceTreeNode => ({ name, repoPath: `/ws/${name}`, url: '', pin: '', isInterface: false, children: [] })
const flatNodes = [node('produit'), node('hmi'), node('autre')]
const pinOf = (repo: string) => manifests.get(`/ws/${repo}`)?.dependencies?.find(d => d.name === 'hmi')?.pin

beforeEach(() => {
  vi.clearAllMocks()
  manifests.clear()
})

describe('propagatePinToDependents — parent qui suit la branche (GH454)', () => {
  it('parent épinglé sur la branche du merge : pin conservé, aucun rebuild', async () => {
    manifests.set('/ws/produit', { dependencies: [{ ...HMI, pin: 'int-PH2' }] })
    const outcome = await propagatePinToDependents('/ws', flatNodes, HMI, 'ca6b7e0', { keepBranch: 'int-PH2' })
    expect(outcome).toEqual({ updated: [], conflicted: [], failed: [] })
    expect(pinOf('produit')).toBe('int-PH2')
    expect(rebuildTree).not.toHaveBeenCalled()
  })

  it('parent épinglé sur un commit : remplacé par le SHA (inchangé)', async () => {
    manifests.set('/ws/produit', { dependencies: [{ ...HMI, pin: '31ae309' }] })
    const outcome = await propagatePinToDependents('/ws', flatNodes, HMI, 'ca6b7e0', { keepBranch: 'int-PH2' })
    expect(outcome.updated).toEqual(['produit'])
    expect(pinOf('produit')).toBe('ca6b7e0')
  })

  it('parent épinglé sur une autre branche ou un tag : remplacé par le SHA (inchangé)', async () => {
    manifests.set('/ws/produit', { dependencies: [{ ...HMI, pin: 'main' }] })
    manifests.set('/ws/autre', { dependencies: [{ ...HMI, pin: 'v1.0' }] })
    const outcome = await propagatePinToDependents('/ws', flatNodes, HMI, 'ca6b7e0', { keepBranch: 'int-PH2' })
    expect(outcome.updated).toEqual(['produit', 'autre'])
    expect(pinOf('produit')).toBe('ca6b7e0')
    expect(pinOf('autre')).toBe('ca6b7e0')
  })

  it('sans keepBranch (choix de branche dans la combo) : comportement inchangé', async () => {
    manifests.set('/ws/produit', { dependencies: [{ ...HMI, pin: 'b32e901' }] })
    const outcome = await propagatePinToDependents('/ws', flatNodes, HMI, 'int-PH2')
    expect(outcome.updated).toEqual(['produit'])
    expect(pinOf('produit')).toBe('int-PH2')
  })
})
