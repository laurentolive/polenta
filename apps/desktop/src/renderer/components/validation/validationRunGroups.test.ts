import { describe, expect, it } from 'vitest'
import type { ExecutionHistoryRow, ValidationRow } from '@polenta/types'
import { groupExecutionsByTest } from './validationRunGroups'

type Test = ValidationRow['tests'][number]

const test = (id: string, extra: Partial<Test> = {}): Test => ({ id, title: `Titre ${id}`, local: true, ...extra })
const run = (testCaseId: string, key: string, executedAt: string): ExecutionHistoryRow =>
  ({ key, kind: 'run', testCaseId, testTitle: `Titre ${testCaseId}`, objectTypeRef: 'root::t', run: { id: key, executedAt } as ExecutionHistoryRow['run'] }) as ExecutionHistoryRow
const pending = (testCaseId: string, entryId: string): ExecutionHistoryRow =>
  ({ key: `pending:CAMP-1:${entryId}`, kind: 'pending', testCaseId, testTitle: `Titre ${testCaseId}`, objectTypeRef: 'root::t', campaign: { id: 'CAMP-1', title: 'Campagne', status: 'planned', fields: {} }, entry: { entryId } }) as ExecutionHistoryRow

// GH430 — les entrées en attente des campagnes ouvertes sont listées sous leur test, sans entrer dans les runs.
describe('groupExecutionsByTest', () => {
  it('range les entrées en attente à part des runs, sous le même test', () => {
    const groups = groupExecutionsByTest([test('T1')], [pending('T1', 'T1-1'), run('T1', 'R1', '2026-11-01T10:00:00Z')], false)
    expect(groups).toHaveLength(1)
    const [id, g] = groups[0]
    expect(id).toBe('T1')
    expect(g.pending.map(r => r.key)).toEqual(['pending:CAMP-1:T1-1'])
    expect(g.runs.map(r => r.key)).toEqual(['R1'])
  })

  it('un test lié sans ligne reste présent, sans exécution ni attente', () => {
    const [[, g]] = groupExecutionsByTest([test('T2')], [], false)
    expect(g.runs).toEqual([])
    expect(g.pending).toEqual([])
  })

  it('un test seulement en attente n\'a aucun run : la dernière exécution reste vide', () => {
    const [[, g]] = groupExecutionsByTest([test('T3')], [pending('T3', 'T3-1')], false)
    expect(g.runs[0]).toBeUndefined()
    expect(g.pending).toHaveLength(1)
  })

  it('validation figée : une ligne d\'un test non lié à la signature (run ou attente) n\'entre pas dans le registre', () => {
    const groups = groupExecutionsByTest([test('T1', { lastRun: { id: 'R0' } as Test['lastRun'] })], [pending('T9', 'T9-1'), run('T1', 'R1', '2026-11-01T10:00:00Z')], true)
    expect(groups.map(([id]) => id)).toEqual(['T1'])
    expect(groups[0][1].signedRun).toEqual({ id: 'R0' })
    expect(groups[0][1].runs.map(r => r.key)).toEqual(['R1'])
  })

  it('test non lié en validation ouverte : ligne ajoutée, locale par défaut', () => {
    const groups = groupExecutionsByTest([], [pending('T4', 'T4-1')], false)
    expect(groups).toHaveLength(1)
    expect(groups[0][1]).toMatchObject({ title: 'Titre T4', local: true })
    expect(groups[0][1].pending).toHaveLength(1)
  })
})
