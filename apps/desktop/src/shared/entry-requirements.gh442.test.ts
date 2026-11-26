import { describe, expect, it } from 'vitest'
import { entryRequirementIds, requirementIdsText } from '@polenta/types'

// GH442 U1 — règle unique de la colonne « Exigence » : exigence de l'instance, sinon exigences couvertes.
describe('entryRequirementIds (GH442)', () => {
  it('une instance de test itérant garde son exigence, même si le test en couvre d\'autres', () => {
    expect(entryRequirementIds({ requirementId: 'SYS-0001' }, ['SYS-0001', 'SYS-0003'])).toEqual(['SYS-0001'])
  })

  it('une entrée sans exigence propre reprend les exigences couvertes par le test', () => {
    expect(entryRequirementIds({}, ['SYS-0001', 'SYS-0002'])).toEqual(['SYS-0001', 'SYS-0002'])
  })

  it('sans exigence propre ni couverte : vide', () => {
    expect(entryRequirementIds({})).toEqual([])
    expect(entryRequirementIds({}, [])).toEqual([])
  })

  it('ne rend pas le tableau reçu (pas de mutation partagée)', () => {
    const covered = ['SYS-0001']
    expect(entryRequirementIds({}, covered)).not.toBe(covered)
  })
})

describe('requirementIdsText (GH442)', () => {
  it('joint les IDs par « , » ; vide sans exigence', () => {
    expect(requirementIdsText(['SYS-0001', 'SYS-0002'])).toBe('SYS-0001, SYS-0002')
    expect(requirementIdsText([])).toBe('')
  })
})
