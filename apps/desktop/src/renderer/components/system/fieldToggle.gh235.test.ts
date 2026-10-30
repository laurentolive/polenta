import { describe, it, expect } from 'vitest'
import { toggleVisibleField } from './fieldToggle'

const canonical = ['section', 'name', 'id', 'status', 'version', 'priority', 'link::verification']

describe('toggleVisibleField (GH235)', () => {
  it('décocher garde l\'ordre réorganisé des autres colonnes', () => {
    expect(toggleVisibleField(['status', 'name', 'id', 'priority'], 'id', canonical))
      .toEqual(['status', 'name', 'priority'])
  })

  it('cocher garde l\'ordre réorganisé et place la colonne après son prédécesseur canonique affiché', () => {
    expect(toggleVisibleField(['priority', 'status', 'name'], 'version', canonical))
      .toEqual(['priority', 'status', 'version', 'name'])
  })

  it('sans prédécesseur canonique affiché, la colonne va en tête', () => {
    expect(toggleVisibleField(['status', 'id'], 'section', canonical))
      .toEqual(['section', 'status', 'id'])
  })

  it('une colonne hors ordre canonique va en fin de liste', () => {
    expect(toggleVisibleField(['id', 'name'], 'computed::x', canonical))
      .toEqual(['id', 'name', 'computed::x'])
  })

  it('ordre canonique conservé quand l\'utilisateur ne l\'a pas modifié', () => {
    expect(toggleVisibleField(['section', 'name', 'id', 'priority'], 'status', canonical))
      .toEqual(['section', 'name', 'id', 'status', 'priority'])
  })
})
