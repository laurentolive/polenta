import { describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, TestCampaign, TestCase, TestRun } from '@polenta/types'
import { ExecutionHistoryService } from './execution-history.service'
import type { CampaignsService } from './campaigns.service'
import type { TestsService } from './tests.service'

// GH400 — vue Exécutions : exécutions de tous les tests d'un type (specs/GH400-tests.md U1–U5).

const tc = (id: string, ref: string): TestCase => ({ id, title: `Titre ${id}`, objectTypeRef: ref } as TestCase)
const run = (id: string, testCaseId: string, at: string, extra: Partial<TestRun> = {}): TestRun =>
  ({ id, testCaseId, result: 'PASS', executedAt: at, executedBy: 'x', duration: 0, equipmentUsed: [], stepResults: [], notes: '', ...extra } as TestRun)

const A = 'root::essai-a'
const B = 'root::essai-b'
const TESTS = [tc('TA-1', A), tc('TA-2', A), tc('TB-1', B)]
const RUNS: Record<string, TestRun[]> = {
  'TA-1': [
    run('RA0', 'TA-1', '2026-10-01T10:00:00Z', { campaignEntry: { campaignId: 'C1', entryId: 'TA-1-1' } }),   // remplacé par RA1
    run('RA1', 'TA-1', '2026-10-02T10:00:00Z', { campaignEntry: { campaignId: 'C1', entryId: 'TA-1-1' } }),
    run('ROLD', 'TA-1', '2026-09-01T10:00:00Z'),                                                              // avant GH73, désigné par C1
    run('RORPHAN', 'TA-1', '2026-08-01T10:00:00Z'),                                                           // avant GH73, désigné par personne
  ],
  'TA-2': [
    run('RA2', 'TA-2', '2026-10-03T10:00:00Z', { campaignEntry: { campaignId: 'C1', entryId: 'TA-2-1' } }),   // entrée retirée
    run('RISO', 'TA-2', '2026-10-04T10:00:00Z'),
  ],
  'TB-1': [run('RB1', 'TB-1', '2026-10-05T10:00:00Z', { campaignEntry: { campaignId: 'C2', entryId: 'TB-1-1' } })],
}
const CAMPAIGNS = [
  { id: 'C1', title: 'Campagne 1', status: 'completed', fields: {}, runs: [
    { entryId: 'TA-1-1', testCaseId: 'TA-1', status: 'PASS', runId: 'RA1' },
    { entryId: 'TA-1-0', testCaseId: 'TA-1', status: 'PASS', runId: 'ROLD' },
  ], removedRuns: [{ entryId: 'TA-2-1', testCaseId: 'TA-2', status: 'PASS', runId: 'RA2', removedAt: '2026-10-10' }] },
  { id: 'C2', title: 'Campagne 2', status: 'in_progress', fields: {}, runs: [
    { entryId: 'TA-1-2', testCaseId: 'TA-1', status: 'pending' },
    { entryId: 'TB-1-1', testCaseId: 'TB-1', status: 'PASS', runId: 'RB1' },
  ] },
] as unknown as TestCampaign[]
const TYPES: Record<string, Partial<ObjectTypeDefinition>> = {
  [A]: { runFields: [{ name: 'banc', type: 'text' }], stepFields: [] },
  [B]: { runFields: [{ name: 'operateur', type: 'text' }], stepFields: [] },
} as Record<string, Partial<ObjectTypeDefinition>>

const service = new ExecutionHistoryService(
  {
    findAll: async () => TESTS,
    findRuns: async (_r: string, id: string) => RUNS[id] ?? [],
    typeDefFor: async (_r: string, ref: string) => TYPES[ref],
  } as unknown as TestsService,
  { list: async () => CAMPAIGNS } as unknown as CampaignsService,
  { findLinks: async () => [] },
)

describe('ExecutionHistoryService — cible de type (GH400)', () => {
  it('U1 — type A : runs remplacés, retirés, isolés et entrée en attente ; ni type B ni ses champs', async () => {
    const h = await service.history('repo', { objectTypeRef: A })
    expect(h.rows.map(r => r.key).sort()).toEqual(['RA0', 'RA1', 'RA2', 'RISO', 'ROLD', 'RORPHAN', 'pending:C2:TA-1-2'].sort())
    expect(h.rows[0].key).toBe('pending:C2:TA-1-2')
    const byKey = Object.fromEntries(h.rows.map(r => [r.key, r]))
    expect(byKey.RA0.superseded).toBe(true)
    expect(byKey.RA2).toMatchObject({ removed: true, campaign: { id: 'C1' } })
    expect(byKey.RISO.campaign).toBeUndefined()
    expect(Object.keys(h.runFieldDefs)).toEqual([A])
  })

  it('U2 — type B : ses seules exécutions', async () => {
    const h = await service.history('repo', { objectTypeRef: B })
    expect(h.rows.map(r => r.key)).toEqual(['RB1'])
    expect(h.runFieldDefs[B].runFields.map(f => f.name)).toEqual(['operateur'])
  })

  it('U3 — run sans campaignEntry désigné par une entrée : rattaché à sa campagne', async () => {
    const h = await service.history('repo', { objectTypeRef: A })
    const old = h.rows.find(r => r.key === 'ROLD')!
    expect(old).toMatchObject({ campaign: { id: 'C1' }, entry: { entryId: 'TA-1-0' } })
    expect(old.superseded).toBeUndefined()
  })

  it('U4 — run sans campaignEntry désigné par personne : isolé', async () => {
    const h = await service.history('repo', { objectTypeRef: A })
    const orphan = h.rows.find(r => r.key === 'RORPHAN')!
    expect(orphan.campaign).toBeUndefined()
    expect(orphan.campaignMissing).toBeUndefined()
  })

  it('U5 — cible test : le repli vaut aussi pour la section de l\'éditeur', async () => {
    const h = await service.history('repo', { testId: 'TA-1' })
    expect(h.rows.find(r => r.key === 'ROLD')?.campaign?.id).toBe('C1')
  })

  it('type inconnu : aucune ligne', async () => {
    const h = await service.history('repo', { objectTypeRef: 'root::absent' })
    expect(h.rows).toEqual([])
  })
})
