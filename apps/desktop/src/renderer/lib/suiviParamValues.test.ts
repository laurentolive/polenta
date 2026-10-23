import { describe, expect, it } from 'vitest'
import type { DashboardSelector, QueryParameterDef } from '@polenta/types'
import { effectiveValues, isKnownValue, missingRequired, optionTitle, storedChoices } from './suiviParamValues'

// GH93 — valeurs effectives de la barre de paramètres (specs/GH93-tests.md 6, 18, 19, 30).

const sel = (over: Partial<DashboardSelector>): DashboardSelector => ({
  key: 'campaign:campaign', name: 'campaign', kind: 'campaign', label: 'Campagne', default: null, required: false, widgetIds: ['w1'], ...over,
})
const OPTIONS = {
  campaigns: [{ id: 'CAMP-0001', title: 'Lot 1', status: 'in_progress' }],
  components: ['moteur'],
  objectTypes: [{ objectTypeRef: 'root::exigence', label: 'Exigence', component: 'moteur' }],
}

describe('GH93 — valeurs effectives de la barre', () => {
  it('valeur connue ; liste en chargement : rien d\'invalide', () => {
    expect(isKnownValue(sel({}), 'CAMP-0001', OPTIONS)).toBe(true)
    expect(isKnownValue(sel({}), 'CAMP-0009', OPTIONS)).toBe(false)
    expect(isKnownValue(sel({}), 'CAMP-0009', {})).toBe(true)
    expect(isKnownValue(sel({ kind: 'component' }), 'pompe', OPTIONS)).toBe(false)
    expect(isKnownValue(sel({ kind: 'objectType' }), 'root::exigence', OPTIONS)).toBe(true)
    expect(isKnownValue(sel({ kind: 'enum', values: [{ value: 'A' }] }), 'B', OPTIONS)).toBe(false)
    expect(isKnownValue(sel({ kind: 'text' }), 'libre', OPTIONS)).toBe(true)
    expect(isKnownValue(sel({}), null, OPTIONS)).toBe(true)
  })

  it('18 — choix > défaut ; valeur introuvable signalée, remplacée par le défaut ; « Toutes » explicite', () => {
    const selectors = [sel({ default: 'CAMP-0001' }), sel({ key: 'p:period', name: 'p', kind: 'period' })]
    expect(effectiveValues(selectors, {}, OPTIONS)).toEqual({ values: { 'campaign:campaign': 'CAMP-0001', 'p:period': null }, invalid: {} })
    expect(effectiveValues(selectors, { 'campaign:campaign': 'CAMP-0009' }, OPTIONS)).toEqual({
      values: { 'campaign:campaign': 'CAMP-0001', 'p:period': null }, invalid: { 'campaign:campaign': 'CAMP-0009' },
    })
    expect(effectiveValues(selectors, { 'campaign:campaign': null }, OPTIONS).values['campaign:campaign']).toBeNull()
    // Défaut lui-même introuvable : aucune valeur.
    expect(effectiveValues([sel({ default: 'CAMP-0042' })], {}, OPTIONS).values['campaign:campaign']).toBeNull()
  })

  it('19 — paramètres obligatoires sans valeur', () => {
    const decls: QueryParameterDef[] = [
      { name: 'campaign', kind: 'campaign', label: { fr: 'Campagne', en: 'Campaign' }, required: true },
      { name: 'lot', kind: 'text', label: 'Lot' },
    ]
    expect(missingRequired(decls, {}, 'en')).toEqual(['Campaign'])
    expect(missingRequired(decls, { 'campaign:campaign': 'CAMP-0001' }, 'fr')).toEqual([])
    expect(missingRequired(undefined, {}, 'fr')).toEqual([])
  })

  it('30 — choix mémorisés : sélecteurs disparus nettoyés, valeur introuvable conservée', () => {
    const selectors = [sel({})]
    expect(storedChoices(selectors, { 'old:text': 'x', 'campaign:campaign': 'CAMP-0009' }, 'campaign:campaign', 'CAMP-0001')).toEqual({ 'campaign:campaign': 'CAMP-0001' })
    expect(storedChoices([...selectors, sel({ key: 'p:period', name: 'p', kind: 'period' })], { 'campaign:campaign': 'CAMP-0009' }, 'p:period', null))
      .toEqual({ 'campaign:campaign': 'CAMP-0009', 'p:period': null })
  })

  it('libellé d\'une valeur', () => {
    expect(optionTitle(OPTIONS, 'campaign', 'CAMP-0001')).toBe('CAMP-0001 — Lot 1')
    expect(optionTitle(OPTIONS, 'objectType', 'root::exigence')).toBe('Exigence (moteur)')
    expect(optionTitle(OPTIONS, 'campaign', 'CAMP-0009')).toBeUndefined()
  })
})
