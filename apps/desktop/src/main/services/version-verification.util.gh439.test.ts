import { describe, expect, it } from 'vitest'

import type { CoverageStatus, Requirement, TraceabilityMatrix } from '@polenta/types'
import { buildRequirementRows, buildVerification, frozenCoverage, liveCoverage } from './version-verification.util'
import type { ValidationRequirement } from './validation-rows.util'

// GH439 sprint 1 — fonctions pures : couverture figée au passage released et lignes de la page (specs/GH439-tests.md R11, S18).

const matrix = (rows: Array<[string, CoverageStatus, string[]?]>): Pick<TraceabilityMatrix, 'requirements'> => ({
  requirements: rows.map(([id, coverageStatus, tests = []]) => ({
    requirement: { id } as Requirement, coverageStatus,
    cells: tests.map(testCaseId => ({ testCaseId, coverageType: 'full' as const, status: 'not_run' as const, lastRunId: null, lastRunDate: null })),
  })),
})
const req = (id: string, extra: Partial<ValidationRequirement['state']> = {}): ValidationRequirement => ({
  state: { id, objectTypeRef: 'root::exigence', status: 'draft', version: 1, title: `Titre ${id}`, key: id, contentKey: id, ...extra },
  fields: { priority: 'high' },
})
const NOW = new Date('2026-11-25T10:00:00.000Z')

describe('buildVerification', () => {
  it('R11 — exigence absente de la matrice : not_covered sans test ; tri numérique par ID', () => {
    const v = buildVerification([req('PR-0010'), req('PR-0002'), req('PR-0003')], matrix([['PR-0002', 'validated', ['PT-0002']], ['PR-0010', 'failing', ['PT-0010', 'PT-0009']]]), NOW)
    expect(v).toEqual({
      computedAt: '2026-11-25T10:00:00.000Z',
      rows: [
        { id: 'PR-0002', status: 'validated', tests: ['PT-0002'] },
        { id: 'PR-0003', status: 'not_covered', tests: [] },
        { id: 'PR-0010', status: 'failing', tests: ['PT-0009', 'PT-0010'] },
      ],
    })
  })

  it('une exigence de la matrice hors périmètre n\'est pas figée ; un test lié deux fois n\'est listé qu\'une fois', () => {
    const v = buildVerification([req('PR-0001')], matrix([['PR-0001', 'covered', ['PT-0001', 'PT-0001']], ['PR-0099', 'validated', ['PT-0099']]]), NOW)
    expect(v.rows).toEqual([{ id: 'PR-0001', status: 'covered', tests: ['PT-0001'] }])
  })
})

describe('buildRequirementRows', () => {
  it('S18 — contenu de l\'état lu, tri numérique, couverture absente : null', () => {
    const rows = buildRequirementRows([req('PR-0010'), req('PR-0002', { status: 'approved', version: 3 })], frozenCoverage({
      computedAt: '', rows: [{ id: 'PR-0002', status: 'validated', tests: ['PT-0001'] }],
    }))
    expect(rows.map(r => r.requirementId)).toEqual(['PR-0002', 'PR-0010'])
    expect(rows[0]).toEqual({
      requirementId: 'PR-0002', title: 'Titre PR-0002', objectTypeRef: 'root::exigence', status: 'approved', version: 3,
      fields: { priority: 'high' }, coverageStatus: 'validated', tests: ['PT-0001'],
    })
    // Exigence sans ligne figée : « — » côté écran, pas not_covered.
    expect(rows[1]).toMatchObject({ requirementId: 'PR-0010', coverageStatus: null, tests: [] })
  })

  it('couverture à l\'instant : une exigence absente de la matrice vaut not_covered', () => {
    const rows = buildRequirementRows([req('PR-0001'), req('PR-0002')], liveCoverage(matrix([['PR-0001', 'covered', ['PT-0001']]])))
    expect(rows.map(r => `${r.requirementId}:${r.coverageStatus}`)).toEqual(['PR-0001:covered', 'PR-0002:not_covered'])
  })
})
