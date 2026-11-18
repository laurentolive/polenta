import { describe, expect, it } from 'vitest'
import type { ExecutionHistoryRow } from '@polenta/types'
import { runPage } from './executionsRoute'

// GH399 — page d'une exécution (specs/GH399-tests.md U5).

const row = (extra: Partial<ExecutionHistoryRow>): ExecutionHistoryRow => ({
  key: 'T-1-run-0001', kind: 'run', testCaseId: 'T-1', testTitle: 'T', objectTypeRef: 'root::essai',
  campaign: { id: 'C1', title: 'C', status: 'in_progress', fields: {} }, entry: { entryId: 'T-1-1' },
  ...extra,
} as ExecutionHistoryRow)

describe('runPage', () => {
  it('campagne ouverte : page d\'exécution ; close : relecture', () => {
    expect(runPage(row({}), 'repo', 'p')).toEqual({ pathname: '/campaign/C1/execute/T-1-1', search: { repoPath: 'repo', projectId: 'p' } })
    expect(runPage(row({ campaign: { id: 'C1', title: 'C', status: 'completed', fields: {} } }), 'repo', 'p')?.pathname).toBe('/campaign/C1/run/T-1-1')
  })

  it('isolée, entrée retirée, essai remplacé, campagne introuvable : pas de page', () => {
    expect(runPage(row({ campaign: undefined, entry: undefined }), 'repo', 'p')).toBeNull()
    expect(runPage(row({ removed: true }), 'repo', 'p')).toBeNull()
    expect(runPage(row({ superseded: true }), 'repo', 'p')).toBeNull()
    expect(runPage(row({ campaign: undefined, campaignMissing: true }), 'repo', 'p')).toBeNull()
  })
})
