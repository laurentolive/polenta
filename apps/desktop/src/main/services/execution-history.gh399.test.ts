import { describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, TestCampaign, TestCase, TestRun } from '@polenta/types'
import { ExecutionHistoryService } from './execution-history.service'
import type { CampaignsService } from './campaigns.service'
import type { TestsService } from './tests.service'

// GH399 — une exécution par son ID (popup, navigation) et ID des exécutions du repo (index des liens).
// specs/GH399-tests.md U1–U4.

const tc = (id: string): TestCase => ({ id, title: `Titre ${id}`, objectTypeRef: 'root::essai' } as TestCase)
const run = (id: string, testCaseId: string, at: string, extra: Partial<TestRun> = {}): TestRun =>
  ({ id, testCaseId, result: 'PASS', executedAt: at, executedBy: 'x', duration: 0, equipmentUsed: [], stepResults: [], notes: '', ...extra } as TestRun)

const RUNS: Record<string, TestRun[]> = {
  'TA-0001': [
    run('TA-0001-run-0003', 'TA-0001', '2026-10-03T10:00:00Z', { campaignEntry: { campaignId: 'C2', entryId: 'TA-0001-1' } }),
    run('TA-0001-run-0002', 'TA-0001', '2026-10-02T10:00:00Z', { campaignEntry: { campaignId: 'C2', entryId: 'TA-0001-1' } }),
    run('TA-0001-run-0001', 'TA-0001', '2026-10-01T10:00:00Z'),
  ],
  'TB-0001': [run('TB-0001-run-0001', 'TB-0001', '2026-10-04T10:00:00Z')],
}
const CAMPAIGNS = [
  { id: 'C2', title: 'Campagne 2', status: 'completed', fields: {}, runs: [{ entryId: 'TA-0001-1', testCaseId: 'TA-0001', status: 'PASS', runId: 'TA-0001-run-0003' }] },
  { id: 'C3', title: 'Ouverte', status: 'in_progress', fields: {}, runs: [{ entryId: 'TA-0001-9', testCaseId: 'TA-0001', status: 'pending' }] },
] as unknown as TestCampaign[]

const service = new ExecutionHistoryService(
  {
    findAll: async () => [tc('TA-0001'), tc('TB-0001')],
    findRuns: async (_r: string, id: string) => RUNS[id] ?? [],
    runsMap: async () => new Map(Object.entries(RUNS)),
    typeDefFor: async () => ({ runFields: [{ name: 'banc', type: 'text' }], stepFields: [] } as Partial<ObjectTypeDefinition>),
  } as unknown as TestsService,
  { list: async () => CAMPAIGNS } as unknown as CampaignsService,
  { findLinks: async () => [] },
)

describe('ExecutionHistoryService — une exécution (GH399)', () => {
  it('U1 — sa seule ligne, avec campagne et entrée ; ni autres runs, ni entrées en attente', async () => {
    const h = await service.history('repo', { runId: 'TA-0001-run-0003' })
    expect(h.rows.map(r => r.key)).toEqual(['TA-0001-run-0003'])
    expect(h.rows[0]).toMatchObject({ campaign: { id: 'C2' }, entry: { entryId: 'TA-0001-1' }, testCaseId: 'TA-0001' })
    expect(h.runFieldDefs['root::essai'].runFields.map(f => f.name)).toEqual(['banc'])
  })

  it('U2 — essai remplacé : marqué', async () => {
    const h = await service.history('repo', { runId: 'TA-0001-run-0002' })
    expect(h.rows[0].superseded).toBe(true)
  })

  it('U3 — test inconnu, ou run absent : aucune ligne', async () => {
    expect((await service.history('repo', { runId: 'XX-0001-run-0001' })).rows).toEqual([])
    expect((await service.history('repo', { runId: 'TA-0001-run-0099' })).rows).toEqual([])
  })

  it('U4 — ID des exécutions du repo, avec leur test', async () => {
    const ids = await service.runIds('repo')
    expect(ids).toHaveLength(4)
    expect(ids).toContainEqual({ id: 'TB-0001-run-0001', testCaseId: 'TB-0001' })
  })
})
