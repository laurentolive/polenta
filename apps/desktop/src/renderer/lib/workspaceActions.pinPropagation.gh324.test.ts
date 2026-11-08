import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PolentaRepoManifest, WorkspaceTreeNode } from '@polenta/types'

// GH324 — depuis que deux déclarations d'un même nom de montage avec des pins différents sont un
// conflit, propager le pin d'un repo partagé (diamant : racine et moteur déclarent `bus`) parent
// par parent passerait par un état en conflit et serait annulé. Les manifestes sont donc tous
// écrits avant un seul rebuild. `api` est simulé : manifestes en mémoire, et un rebuild qui lève
// un conflit dès qu'un même nom est déclaré avec deux couples (url, pin).

const manifests = new Map<string, PolentaRepoManifest>()
const rebuildTree = vi.fn(async () => {
  const seen = new Map<string, string>()
  for (const m of manifests.values()) {
    for (const d of m.dependencies ?? []) {
      const variant = `${d.url}@${d.pin}`
      const previous = seen.get(d.name)
      if (previous !== undefined && previous !== variant) return { status: 'diamond-conflict' as const, conflicts: [] }
      seen.set(d.name, variant)
    }
  }
  return { status: 'ok' as const, tree: {} }
})

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

const BUS = { name: 'bus', url: 'https://forge.test/bus.git' }
const node = (name: string): WorkspaceTreeNode => ({ name, repoPath: `/ws/${name}`, url: '', pin: '', isInterface: false, children: [] })
const flatNodes = [node('root'), node('moteur'), node('bus'), node('autre')]
const pinOf = (repo: string, name = 'bus') => manifests.get(`/ws/${repo}`)?.dependencies?.find(d => d.name === name)?.pin

beforeEach(() => {
  vi.clearAllMocks()
  manifests.clear()
  manifests.set('/ws/root', { dependencies: [{ ...BUS, pin: 'v1' }, { name: 'moteur', url: 'https://forge.test/moteur.git', pin: 'main' }] })
  manifests.set('/ws/moteur', { dependencies: [{ ...BUS, pin: 'v1' }] })
  manifests.set('/ws/autre', { dependencies: [] })
})

describe('propagatePinToDependents — repo partagé (GH324)', () => {
  it('diamant : le pin arrive chez les deux parents, un seul rebuild', async () => {
    const outcome = await propagatePinToDependents('/ws', flatNodes, BUS, 'v2')
    expect(outcome).toEqual({ updated: ['root', 'moteur'], conflicted: [], failed: [] })
    expect(pinOf('root')).toBe('v2')
    expect(pinOf('moteur')).toBe('v2')
    expect(rebuildTree).toHaveBeenCalledTimes(1)
  })

  it('conflit au rebuild : tous les manifestes écrits sont restaurés', async () => {
    // `autre` monte un autre repo sous le nom `bus` : non mis à jour, il reste en conflit.
    manifests.set('/ws/autre', { dependencies: [{ name: 'bus', url: 'https://forge.test/autre-bus.git', pin: 'v2' }] })
    const outcome = await propagatePinToDependents('/ws', flatNodes, BUS, 'v2')
    expect(outcome).toEqual({ updated: [], conflicted: ['root', 'moteur'], failed: [] })
    expect(pinOf('root')).toBe('v1')
    expect(pinOf('moteur')).toBe('v1')
  })

  it('aucun parent à mettre à jour : pas de rebuild', async () => {
    const outcome = await propagatePinToDependents('/ws', flatNodes, BUS, 'v1')
    expect(outcome).toEqual({ updated: [], conflicted: [], failed: [] })
    expect(rebuildTree).not.toHaveBeenCalled()
  })
})
