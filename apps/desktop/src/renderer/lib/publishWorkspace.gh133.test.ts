import { beforeEach, describe, expect, it, vi } from 'vitest'

// GH133 — publier hors de la branche d'intégration sans fusionner (specs/GH133-tests.md).
// `api` est simulé : un seul repo, sur `toolTest` (intégration `main`), une modification en attente.

const calls: string[] = []
const sync = {
  status: vi.fn(async () => ({ branch: 'toolTest', staged: ['requirements/SYS-0001.yaml'], unstaged: [] })),
  isMergedInto: vi.fn(async () => false),
  fetch: vi.fn(async () => { calls.push('fetch') }),
  integrationState: vi.fn(async () => { calls.push('integrationState'); return { state: 'ok' } }),
  canMergeRemoteIntoIntegration: vi.fn(async () => ({ ok: true, conflicts: [] })),
  fastForwardBranch: vi.fn(async (_r: string, b: string) => { calls.push(`ff:${b}`); return 'ok' }),
  stageAll: vi.fn(async () => { calls.push('stageAll') }),
  commit: vi.fn(async () => { calls.push('commit'); return { sha: 'c0ffee' } }),
  mergeInto: vi.fn(async (_r: string, from: string, into: string) => { calls.push(`merge:${from}->${into}`); return { success: true, sha: 'merge1', conflicts: [] } }),
  checkoutBranch: vi.fn(async () => {}),
}

vi.mock('../api', () => ({
  api: {
    sync,
    baseline: { getIntegrationBranch: vi.fn(async () => 'main') },
  },
}))

const propagatePinToDependents = vi.fn(async () => ({ updated: [], conflicted: [], failed: [] }))
vi.mock('./workspaceActions', () => ({ propagatePinToDependents: (...args: unknown[]) => propagatePinToDependents(...(args as [])) }))

const { isOffIntegration, offIntegrationRepos, publishWorkspace } = await import('./publishWorkspace')

const root = { name: 'root', repoPath: '/repo', url: '', pin: '', isInterface: false, children: [] }
const publish = (merge?: boolean) => publishWorkspace({
  workspaceDir: '/ws', flatNodes: [root], roots: [root], title: 'Essai', ephemeral: null, onEphemeralChange: () => {}, merge,
})

beforeEach(() => {
  calls.length = 0
  vi.clearAllMocks()
})

describe('isOffIntegration', () => {
  const s = (branch: string, continuingEphemeral = false) => ({ branch, integrationBranch: 'main', continuingEphemeral })

  it('branche libre ou dev-* : oui', () => {
    expect(isOffIntegration(s('toolTest'))).toBe(true)
    expect(isOffIntegration(s('dev-essai'))).toBe(true)
  })

  it('intégration, int-* non désignée, éphémère, dev-resync, dev-auto, HEAD détachée : non', () => {
    expect(isOffIntegration(s('main'))).toBe(false)
    expect(isOffIntegration(s('int-B'))).toBe(false)
    expect(isOffIntegration(s('dev-essai', true))).toBe(false)
    expect(isOffIntegration(s('dev-resync'))).toBe(false)
    expect(isOffIntegration(s(''))).toBe(false)
  })
})

describe('offIntegrationRepos', () => {
  it('liste le repo à publier depuis toolTest', async () => {
    expect(await offIntegrationRepos([root], null)).toEqual([
      { repo: { name: 'root', label: undefined, repoPath: '/repo' }, branch: 'toolTest', integrationBranch: 'main' },
    ])
  })
})

describe('publishWorkspace — GH133', () => {
  it('case décochée : commit sur toolTest, ni fusion, ni intégration touchée, ni épinglage', async () => {
    const result = await publish(false)
    expect(calls).toEqual(['fetch', 'stageAll', 'commit'])
    expect(result.published).toEqual([expect.objectContaining({ sha: 'c0ffee', pushBranch: 'toolTest', merged: false })])
    expect(propagatePinToDependents).not.toHaveBeenCalled()
  })

  it('case cochée (défaut) : comportement actuel, fusion dans main et push de main', async () => {
    const result = await publish()
    expect(calls).toContain('merge:toolTest->main')
    expect(result.published).toEqual([expect.objectContaining({ sha: 'merge1', pushBranch: 'main', merged: true })])
    expect(propagatePinToDependents).toHaveBeenCalled()
  })

  it('case décochée sur la branche d\'intégration : publication nominale inchangée', async () => {
    sync.status.mockResolvedValue({ branch: 'main', staged: ['x'], unstaged: [] })
    const createBranch = vi.fn(async () => {})
    const branches = vi.fn(async () => [])
    Object.assign(sync, { createBranch, branches, deleteBranch: vi.fn(async () => {}) })
    const result = await publish(false)
    expect(result.published[0]).toMatchObject({ merged: true, pushBranch: 'main' })
  })
})
