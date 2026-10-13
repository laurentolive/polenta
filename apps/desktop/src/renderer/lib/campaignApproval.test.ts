import { describe, expect, it } from 'vitest'
import type { CampaignTestRun, TestCase } from '@polenta/types'
import { approvalSubject, isResyncable, unapprovedPendingRuns, unapprovedTestOf } from './campaignApproval'

// GH68 — badge « Non approuvé » et bandeau de la page campagne (L1–L3 de specs/GH68-tests.md).

const tc = (id: string, status: string, version = 1) => ({ id, status, version } as unknown as TestCase)
const isApproved = (t: TestCase) => t.status === 'valide'
const run = (testCaseId: string, snapshot: TestCase | undefined, status: CampaignTestRun['status'] = 'pending'): CampaignTestRun =>
  ({ entryId: `${testCaseId}-1`, testCaseId, status, ...(snapshot && { testSnapshot: snapshot }) })

describe('campaignApproval', () => {
  it('pending + copie non approuvée : resynchronisable, jugé sur le live', () => {
    const r = run('A', tc('A', 'draft'))
    expect(isResyncable(r, isApproved)).toBe(true)
    expect(approvalSubject(r, tc('A', 'review', 2), isApproved)?.version).toBe(2)
  })

  it('L1 — test devenu approuvé : plus de badge avant même l\'exécution', () => {
    expect(unapprovedTestOf(run('A', tc('A', 'draft')), tc('A', 'valide', 2), isApproved)).toBeUndefined()
  })

  it('L2 — copie approuvée, test repassé en brouillon : pas de badge (T49)', () => {
    expect(unapprovedTestOf(run('B', tc('B', 'valide')), tc('B', 'draft', 2), isApproved)).toBeUndefined()
  })

  it('L3 — instance exécutée sur une copie non approuvée : badge, hors bandeau', () => {
    const r = run('A', tc('A', 'draft'), 'PASS')
    expect(isResyncable(r, isApproved)).toBe(false)
    expect(unapprovedTestOf(r, tc('A', 'valide', 2), isApproved)?.status).toBe('draft')
    expect(unapprovedPendingRuns([r], new Map([['A', tc('A', 'valide', 2)]]), isApproved)).toEqual([])
  })

  it('test source supprimé : jugé sur la copie', () => {
    expect(unapprovedTestOf(run('A', tc('A', 'draft')), undefined, isApproved)?.status).toBe('draft')
  })

  it('entrée pré-T49 : jugée sur le live', () => {
    expect(unapprovedTestOf(run('A', undefined), tc('A', 'draft'), isApproved)?.status).toBe('draft')
    expect(unapprovedTestOf(run('A', undefined), undefined, isApproved)).toBeUndefined()
  })

  it('bandeau : compte les pending non approuvées seulement', () => {
    const runs = [run('A', tc('A', 'draft')), run('B', tc('B', 'valide')), run('C', tc('C', 'draft'), 'FAIL')]
    const live = new Map([['A', tc('A', 'draft', 2)], ['B', tc('B', 'valide')], ['C', tc('C', 'draft')]])
    expect(unapprovedPendingRuns(runs, live, isApproved).map(r => r.testCaseId)).toEqual(['A'])
  })
})
