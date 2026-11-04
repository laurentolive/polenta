import { describe, expect, it } from 'vitest'
import type { ExecutionHistoryRow, TestRun } from '@polenta/types'
import { runMentions } from './runMentions'

const row = (run: Partial<TestRun> | undefined, extra: Partial<ExecutionHistoryRow> = {}) =>
  ({ run: run && { executedAt: '2026-11-01T10:00:00Z', ...run }, ...extra }) as Pick<ExecutionHistoryRow, 'run' | 'testedDrift'>

// GH204 U16 — mentions d'une exécution.
describe('runMentions', () => {
  it('aucune mention sur la version validée', () => {
    expect(runMentions(row({ testedConfig: { component: 'moteur', ref: 'MCV-4' } }), 'MCV-4', null)).toEqual([])
  })

  it('aucune mention sur le produit dont la structure contient la version validée', () => {
    const testedConfig = { component: 'produit', ref: 'PRV-1', components: { sous: { ref: 'SV-1', components: { moteur: { ref: 'MCV-4' } } } } }
    expect(runMentions(row({ testedConfig }), 'MCV-4', null)).toEqual([])
  })

  it('autre version', () => {
    const testedConfig = { component: 'produit', ref: 'PRV-1', components: { moteur: { ref: 'MCV-3' } } }
    expect(runMentions(row({ testedConfig }), 'MCV-4', null)).toEqual(['other_version'])
  })

  it('run sans version testée', () => {
    expect(runMentions(row({}), 'MCV-4', null)).toEqual(['no_version'])
  })

  it('structure évoluée depuis l\'exécution', () => {
    const r = row({ testedConfig: { component: 'moteur', ref: 'MCV-4' } }, { testedDrift: [{ kind: 'version_abandoned', path: '', ref: 'MCV-4' }] })
    expect(runMentions(r, 'MCV-4', null)).toEqual(['evolved'])
  })

  it('après la signature seulement si postérieur', () => {
    const r = row({ testedConfig: { component: 'moteur', ref: 'MCV-4' } })
    expect(runMentions(r, 'MCV-4', '2026-11-02T10:00:00Z')).toEqual([])
    expect(runMentions(r, 'MCV-4', '2026-10-30T10:00:00Z')).toEqual(['after_signature'])
  })

  it('entrée en attente : rien', () => {
    expect(runMentions(row(undefined), 'MCV-4', null)).toEqual([])
  })
})
