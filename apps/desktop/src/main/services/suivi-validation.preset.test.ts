import { describe, expect, it } from 'vitest'
import { pruneMapping, validateWidget } from './suivi-validation.util'
import { PROGRESS_MAPPING } from './dashboard-seed.service'

// GH71 — préréglage `campaignProgress` du widget barre face aux règles de mapping (GH69).
const COLS = ['campaignTitle', 'progress', 'count']

describe('validateWidget — preset (GH71)', () => {
  it('mapping du seed « Avancement par campagne » accepté', () => {
    expect(validateWidget({ type: 'bar', queryId: 'Q', fieldMapping: PROGRESS_MAPPING }, COLS, []).issue).toBeNull()
  })

  it('preset sans série refusé', () => {
    const { issue } = validateWidget({ type: 'bar', queryId: 'Q', fieldMapping: { category: 'campaignTitle', measure: 'count', preset: 'campaignProgress' } }, COLS, [])
    expect(issue?.code).toBe('INVALID_MAPPING')
  })

  it('preset non applicable à un autre type ; retiré au changement de type', () => {
    const { issue } = validateWidget({ type: 'line', queryId: 'Q', fieldMapping: { category: 'campaignTitle', measure: 'count', series: 'progress', preset: 'campaignProgress' } }, COLS, [])
    expect(issue?.code).toBe('INVALID_MAPPING')
    expect(pruneMapping('line', PROGRESS_MAPPING)).toEqual({ category: 'campaignTitle', measure: 'count', series: 'progress' })
    expect(pruneMapping('bar', PROGRESS_MAPPING)).toEqual(PROGRESS_MAPPING)
  })
})
