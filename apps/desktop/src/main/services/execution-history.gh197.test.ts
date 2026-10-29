import { describe, expect, it } from 'vitest'

import type { ObjectLink, ObjectTypeDefinition, TestCampaign, TestCase, TestRun } from '@polenta/types'
import { ExecutionHistoryService } from './execution-history.service'
import type { CampaignsService } from './campaigns.service'
import type { TestsService } from './tests.service'

// GH197 — historique des exécutions (specs/GH197-tests.md, scénarios 1 à 6).

const tc = (id: string, ref = 'root::essai'): TestCase => ({ id, title: `Titre ${id}`, objectTypeRef: ref } as TestCase)
const run = (id: string, testCaseId: string, at: string, extra: Partial<TestRun> = {}): TestRun =>
  ({ id, testCaseId, result: 'PASS', executedAt: at, executedBy: 'x', duration: 0, equipmentUsed: [], stepResults: [], notes: '', ...extra } as TestRun)

const TESTS = [tc('T1'), tc('T2'), tc('T3')]
const RUNS: Record<string, TestRun[]> = {
  T1: [
    run('R1', 'T1', '2026-10-01T10:00:00Z', { campaignEntry: { campaignId: 'C1', entryId: 'T1-1' } }),
    run('R2', 'T1', '2026-10-03T10:00:00Z', { campaignEntry: { campaignId: 'C2', entryId: 'T1-1' } }),
    run('R3', 'T1', '2026-10-02T10:00:00Z'),
    run('R4', 'T1', '2026-10-04T10:00:00Z', { campaignEntry: { campaignId: 'GONE', entryId: 'T1-1' } }),
  ],
  // Test itérant (T179) : une instance par exigence.
  T2: [
    run('R5', 'T2', '2026-10-05T10:00:00Z', { requirementId: 'SYS-1', campaignEntry: { campaignId: 'C2', entryId: 'T2-1' } }),
    run('R6', 'T2', '2026-10-06T10:00:00Z', { requirementId: 'SYS-2', campaignEntry: { campaignId: 'C2', entryId: 'T2-2' } }),
  ],
  T3: [run('R7', 'T3', '2026-10-07T10:00:00Z')],
}
const CAMPAIGNS = [
  { id: 'C1', title: 'Campagne 1', status: 'completed', fields: {}, runs: [], removedRuns: [{ entryId: 'T1-1', testCaseId: 'T1', status: 'PASS', runId: 'R1' }] },
  { id: 'C2', title: 'Campagne 2', status: 'in_progress', fields: { banc: 'B1' }, runs: [
    { entryId: 'T1-1', testCaseId: 'T1', status: 'PASS', runId: 'R2', testSnapshot: { version: 3 } },
    { entryId: 'T1-2', testCaseId: 'T1', status: 'pending' },
    { entryId: 'T2-1', testCaseId: 'T2', status: 'PASS', runId: 'R5', requirementId: 'SYS-1' },
    { entryId: 'T2-2', testCaseId: 'T2', status: 'PASS', runId: 'R6', requirementId: 'SYS-2' },
    { entryId: 'T2-3', testCaseId: 'T2', status: 'pending', requirementId: 'SYS-2' },
  ] },
  { id: 'C3', title: 'Campagne close', status: 'abandoned', fields: {}, runs: [{ entryId: 'T1-9', testCaseId: 'T1', status: 'pending' }] },
] as unknown as TestCampaign[]
const LINKS: ObjectLink[] = [
  { id: 'L1', type: 'verification', sourceId: 'T2', targetId: 'SYS-1' },
  { id: 'L2', type: 'verification', sourceId: 'SYS-1', targetId: 'T3' },   // sens inverse : compte aussi
] as unknown as ObjectLink[]
const TYPE: Partial<ObjectTypeDefinition> = { runFields: [{ name: 'temp', type: 'number' }], stepFields: [] }

const service = new ExecutionHistoryService(
  {
    findAll: async () => TESTS,
    findRuns: async (_r: string, id: string) => RUNS[id] ?? [],
    typeDefFor: async () => TYPE,
  } as unknown as TestsService,
  { list: async () => CAMPAIGNS } as unknown as CampaignsService,
  { findLinks: async (_r: string, id: string) => LINKS.filter(l => l.sourceId === id || l.targetId === id) },
)

describe('ExecutionHistoryService', () => {
  it('test : runs (campagnes, isolé, retiré, campagne introuvable), pending des campagnes ouvertes, ordre', async () => {
    const h = await service.history('repo', { testId: 'T1' })
    expect(h.rows.map(r => r.key)).toEqual(['pending:C2:T1-2', 'R4', 'R2', 'R3', 'R1'])
    const byKey = Object.fromEntries(h.rows.map(r => [r.key, r]))
    expect(byKey.R1).toMatchObject({ removed: true, campaign: { id: 'C1' }, entry: { entryId: 'T1-1' } })
    expect(byKey.R2).toMatchObject({ campaign: { id: 'C2', fields: { banc: 'B1' } }, entry: { testVersion: 3 } })
    expect(byKey.R3.campaign).toBeUndefined()
    expect(byKey.R4.campaignMissing).toBe(true)
    expect(h.rows.some(r => r.key.includes('C3'))).toBe(false)                    // campagne clôturée
    expect(h.runFieldDefs['root::essai'].runFields.map(f => f.name)).toEqual(['temp'])
  })

  it('exigence : tests liés (sens indifférent), règle T179', async () => {
    const h = await service.history('repo', { requirementId: 'SYS-1' })
    expect(h.rows.map(r => r.key)).toEqual(['R7', 'R5'])                         // pas R6 (instance SYS-2), ni T2-3
    expect(h.rows.map(r => r.testCaseId)).toEqual(['T3', 'T2'])
  })
})
