import { describe, it, expect } from 'vitest'
import { typeChoiceLabel } from './typeLabels'

describe('typeChoiceLabel (GH265)', () => {
  const hmi = { name: 'HMI_PH2_REQ', label: 'Exigence' }
  const sw = { name: 'VE22D_SW_REQ', label: 'Exigence' }
  const other = { name: 'SAFETY_REQ', label: 'Sécurité' }

  it('affiche le nom technique des types de même libellé, pas celui des autres', () => {
    const types = [hmi, sw, other]
    expect(types.map(t => typeChoiceLabel(t, types))).toEqual(['HMI_PH2_REQ', 'VE22D_SW_REQ', 'Sécurité'])
  })

  it('garde le libellé quand le type est seul de son libellé', () => {
    expect(typeChoiceLabel(hmi, [hmi])).toBe('Exigence')
  })

  it("retombe sur le nom d'un type sans libellé", () => {
    const noLabel = { name: 'X_REQ' }
    expect(typeChoiceLabel(noLabel, [noLabel, hmi])).toBe('X_REQ')
  })

  it('distingue aussi un libellé égal au nom technique d\'un autre type', () => {
    const a = { name: 'A', label: 'B' }
    const b = { name: 'B' }
    expect([a, b].map(t => typeChoiceLabel(t, [a, b]))).toEqual(['A', 'B'])
  })
})
