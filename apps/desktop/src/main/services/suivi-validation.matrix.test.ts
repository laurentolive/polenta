import { describe, expect, it } from 'vitest'
import { pruneMapping, validateWidget } from './suivi-validation.util'

// GH69 — règles de mapping du widget matrice (add_widget / update_widget MCP, scénarios M1 / M2).
const COLS = ['testCaseId', 'testTitle', 'campaignId', 'campaignCreatedAt', 'status']
const MAPPING = { category: 'testCaseId', series: 'campaignId', measure: 'status', label: 'testTitle' }

describe('validateWidget — matrix (GH69)', () => {
  it('M1 — mapping complet avec libellé accepté', () => {
    expect(validateWidget({ type: 'matrix', queryId: 'Q', fieldMapping: MAPPING }, COLS, []).issue).toBeNull()
  })

  it('lignes, colonnes et valeur obligatoires', () => {
    const { issue } = validateWidget({ type: 'matrix', queryId: 'Q', fieldMapping: { category: 'testCaseId', measure: 'status' } }, COLS, [])
    expect(issue?.code).toBe('MISSING_MAPPING')
  })

  it('libellé hors résultat refusé', () => {
    const { issue } = validateWidget({ type: 'matrix', queryId: 'Q', fieldMapping: { ...MAPPING, label: 'nope' } }, COLS, [])
    expect(issue?.code).toBe('UNKNOWN_COLUMN')
  })

  it('label non applicable à un autre type', () => {
    const { issue } = validateWidget({ type: 'bar', queryId: 'Q', fieldMapping: { category: 'status', measure: 'status', label: 'testTitle' } }, COLS, [])
    expect(issue?.code).toBe('INVALID_MAPPING')
  })

  it('M2 — passage bar → matrix : mapping conservé (stacked retiré)', () => {
    expect(pruneMapping('matrix', { category: 'testCaseId', series: 'campaignId', measure: 'status', stacked: true })).toEqual({
      category: 'testCaseId', series: 'campaignId', measure: 'status',
    })
  })
})
