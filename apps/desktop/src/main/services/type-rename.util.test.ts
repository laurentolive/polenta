import { describe, expect, it } from 'vitest'

import { idRenamer, renamePath } from './type-rename.util'

// GH100 — scénarios T1–T3 de specs/GH100-tests.md.

describe('idRenamer (GH100)', () => {
  const rename = idRenamer('COMP_REQ', new Map([['COMP_REQ-0001', 'VE22D_REQ-0001'], ['COMP_REQ-0002', 'VE22D_REQ-0002']]))

  it('T1 — ID entier seulement, entryId et runId compris', () => {
    expect(rename('targetId: COMP_REQ-0001')).toBe('targetId: VE22D_REQ-0001')
    expect(rename('COMP_REQ-00011 XCOMP_REQ-0001 A-COMP_REQ-0001 COMP_REQ-0001x')).toBe('COMP_REQ-00011 XCOMP_REQ-0001 A-COMP_REQ-0001 COMP_REQ-0001x')
    expect(rename('entryId: COMP_REQ-0001-2, runId: COMP_REQ-0002-run-0003')).toBe('entryId: VE22D_REQ-0001-2, runId: VE22D_REQ-0002-run-0003')
    // Un ID du préfixe absent des renommages reste tel quel.
    expect(rename('COMP_REQ-0009')).toBe('COMP_REQ-0009')
  })

  it('T2 — chemin réécrit segment par segment', () => {
    const t = idRenamer('COMP_TEST', new Map([['COMP_TEST-0001', 'NEW_TEST-0001']]))
    expect(renamePath('test-runs/COMP_TEST-0001/COMP_TEST-0001-run-0001.yaml', t)).toBe('test-runs/NEW_TEST-0001/NEW_TEST-0001-run-0001.yaml')
    expect(renamePath('impact-acks/COMP_TEST-0001/ack-1.yaml', t)).toBe('impact-acks/NEW_TEST-0001/ack-1.yaml')
  })

  it('T3 — une passe : un ID réécrit n\'est pas repris (nouveau préfixe contenant l\'ancien)', () => {
    const t = idRenamer('REQ', new Map([['REQ-0001', 'X_REQ-0002'], ['REQ-0002', 'X_REQ-0003']]))
    expect(t('REQ-0001 REQ-0002')).toBe('X_REQ-0002 X_REQ-0003')
  })
})
