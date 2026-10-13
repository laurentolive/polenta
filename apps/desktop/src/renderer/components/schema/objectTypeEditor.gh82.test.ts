import { describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition } from '@polenta/types'
import { editableToObjType, emptyStatus, objTypeToEditable, valueRenames, withOriginalFieldNames, withRenamedDefaults } from './objectTypeEditor'

// GH82 — détection des renommages de statut / valeur d'enum (scénarios D1–D7 de specs/GH82-tests.md).

const TYPE: ObjectTypeDefinition = {
  name: 'exigence', category: 'requirement',
  fields: [
    { name: 'prio', label: 'Priorité', type: 'enum', values: ['haute', 'moyenne', 'basse'], default: 'haute' },
    { name: 'tags', type: 'multi_enum', values: ['a', 'b'] },
  ],
  statuses: [{ name: 'draft' }, { name: 'review' }, { name: 'approved', isApproval: true }],
}

const edit = () => objTypeToEditable(TYPE)

describe('valueRenames', () => {
  it('D1 — statut renommé sur sa ligne', () => {
    const t = edit()
    t.statuses[1] = { ...t.statuses[1], name: 'en-revue' }
    expect(valueRenames(t, TYPE)).toEqual([{ target: { kind: 'status' }, from: 'review', to: 'en-revue' }])
  })

  it('D2 — statut supprimé puis ajouté : aucun renommage', () => {
    const t = edit()
    t.statuses = [t.statuses[0], t.statuses[2], { ...emptyStatus(), name: 'en-revue' }]
    expect(valueRenames(t, TYPE)).toEqual([])
  })

  it('D3 — valeur changée à la même position', () => {
    const t = edit()
    t.fields[0] = { ...t.fields[0], values: 'haute, med, basse' }
    expect(valueRenames(t, TYPE)).toEqual([{ target: { kind: 'field', field: 'prio', multi: false }, from: 'moyenne', to: 'med' }])
  })

  it('D4 — ajout d\'une valeur : rien de proposé pour ce champ', () => {
    const t = edit()
    t.fields[0] = { ...t.fields[0], values: 'haute, moyenne, basse, nulle' }
    expect(valueRenames(t, TYPE)).toEqual([])
  })

  it('D5 — champ renommé et valeur renommée : cible = nouveau nom ; multi_enum signalé', () => {
    const t = edit()
    t.fields[1] = { ...t.fields[1], name: 'etiquettes', values: 'a, bb' }
    expect(valueRenames(t, TYPE)).toEqual([{ target: { kind: 'field', field: 'etiquettes', multi: true }, from: 'b', to: 'bb' }])
  })

  it('D6 — enum passé en text : aucun renommage de valeur', () => {
    const t = edit()
    t.fields[0] = { ...t.fields[0], type: 'text', values: 'x, y, z' }
    expect(valueRenames(t, TYPE)).toEqual([])
  })

  it('réordonner ou échanger des valeurs : rien de proposé (indiscernable d\'un renommage croisé)', () => {
    const reorder = edit()
    reorder.fields[0] = { ...reorder.fields[0], values: 'basse, moyenne, haute' }
    expect(valueRenames(reorder, TYPE)).toEqual([])
    const rename = edit()
    rename.fields[0] = { ...rename.fields[0], values: 'haute, basse, faible' }
    expect(valueRenames(rename, TYPE)).toEqual([])
  })

  it('aperçu : cible ramenée au nom d\'origine du champ', () => {
    const t = edit()
    t.fields[1] = { ...t.fields[1], name: 'etiquettes', values: 'a, bb' }
    expect(withOriginalFieldNames(t, valueRenames(t, TYPE))[0].target).toEqual({ kind: 'field', field: 'tags', multi: true })
  })

  it('D7b — default multi_enum : élément renommé dans la liste', () => {
    const type: ObjectTypeDefinition = { ...TYPE, fields: [{ name: 'tags', type: 'multi_enum', values: ['a', 'b'], default: 'a, b' }] }
    const t = objTypeToEditable(type)
    t.fields[0] = { ...t.fields[0], values: 'aa, b' }
    expect(editableToObjType(withRenamedDefaults(t, valueRenames(t, type))).fields[0].default).toBe('aa, b')
  })

  it('D7 — default égal à une valeur renommée retenue : remplacé', () => {
    const t = edit()
    t.fields[0] = { ...t.fields[0], values: 'high, moyenne, basse' }
    const renames = valueRenames(t, TYPE)
    expect(editableToObjType(withRenamedDefaults(t, renames)).fields[0].default).toBe('high')
    expect(editableToObjType(withRenamedDefaults(t, [])).fields[0].default).toBe('haute')
  })
})
