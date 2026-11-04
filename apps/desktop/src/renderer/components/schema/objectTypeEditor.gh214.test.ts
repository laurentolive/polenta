import { describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ValueRename } from '@polenta/types'
import { requiredWhenIssues } from '@polenta/types'
import { editableToObjType, objTypeToEditable, valueRenames, withRenamedRequiredWhen } from './objectTypeEditor'

// GH214 — les renommages de champ, de statut et de valeur d'enum réécrivent les `requiredWhen`.

const TYPE: ObjectTypeDefinition = {
  name: 'exigence', category: 'requirement',
  fields: [
    { name: 'prio', type: 'enum', values: ['haute', 'basse'] },
    { name: 'safety', type: 'boolean' },
    { name: 'tags', type: 'multi_enum', values: ['a', 'b'] },
    { name: 'rationale', type: 'text', requiredWhen: { status: ['approved', 'review'], prio: ['haute'], safety: ['true'] } },
  ],
  statuses: [{ name: 'draft' }, { name: 'review' }, { name: 'approved', isApproval: true }],
}

const TEST_TYPE: ObjectTypeDefinition = {
  name: 'essai', category: 'test',
  fields: [{ name: 'prio', type: 'enum', values: ['haute'] }],
  statuses: [{ name: 'draft' }],
  runFields: [
    { name: 'bench', type: 'enum', values: ['b1', 'b2'] },
    { name: 'note', type: 'text', requiredWhen: { result: ['FAIL'], bench: ['b1'] } },
  ],
  stepFields: [
    { name: 'mode', type: 'enum', values: ['m1'] },
    { name: 'measure', type: 'text', requiredWhen: { mode: ['m1'] } },
  ],
}

const fieldOf = (t: ObjectTypeDefinition, name: string) => t.fields.find(f => f.name === name)!
const statusRename = (from: string, to: string): ValueRename => ({ target: { kind: 'status' }, from, to })

describe('withRenamedRequiredWhen', () => {
  it('statut renommé : la condition suit, plus aucune référence inconnue (exemple de l\'issue)', () => {
    const t = objTypeToEditable(TYPE)
    t.statuses[2] = { ...t.statuses[2], name: 'validated' }
    const saved = editableToObjType(withRenamedRequiredWhen(t, TYPE, valueRenames(t, TYPE)))
    expect(fieldOf(saved, 'rationale').requiredWhen).toEqual({ status: ['validated', 'review'], prio: ['haute'], safety: ['true'] })
    expect(requiredWhenIssues(saved)).toEqual([])
  })

  it('champ renommé : la clé suit', () => {
    const t = objTypeToEditable(TYPE)
    t.fields[0] = { ...t.fields[0], name: 'criticite' }
    const saved = editableToObjType(withRenamedRequiredWhen(t, TYPE, []))
    expect(fieldOf(saved, 'rationale').requiredWhen).toEqual({ status: ['approved', 'review'], criticite: ['haute'], safety: ['true'] })
    expect(requiredWhenIssues(saved)).toEqual([])
  })

  it('valeur d\'enum renommée : la valeur suit, seulement sous la clé de ce champ', () => {
    const t = objTypeToEditable(TYPE)
    t.fields[0] = { ...t.fields[0], values: 'critique, basse' }
    const saved = editableToObjType(withRenamedRequiredWhen(t, TYPE, valueRenames(t, TYPE)))
    expect(fieldOf(saved, 'rationale').requiredWhen?.prio).toEqual(['critique'])
    expect(requiredWhenIssues(saved)).toEqual([])
  })

  it('champ et valeur renommés dans la même édition : les deux s\'appliquent', () => {
    const t = objTypeToEditable(TYPE)
    t.fields[0] = { ...t.fields[0], name: 'criticite', values: 'critique, basse' }
    const saved = editableToObjType(withRenamedRequiredWhen(t, TYPE, valueRenames(t, TYPE)))
    expect(fieldOf(saved, 'rationale').requiredWhen).toEqual({ status: ['approved', 'review'], criticite: ['critique'], safety: ['true'] })
  })

  it('une même valeur sous une autre clé n\'est pas touchée', () => {
    const type: ObjectTypeDefinition = {
      ...TYPE,
      fields: [...TYPE.fields, { name: 'other', type: 'enum', values: ['haute'] }, { name: 'x', type: 'text', requiredWhen: { other: ['haute'] } }],
    }
    const t = objTypeToEditable(type)
    t.fields[0] = { ...t.fields[0], values: 'critique, basse' }
    const saved = editableToObjType(withRenamedRequiredWhen(t, type, valueRenames(t, type)))
    expect(fieldOf(saved, 'x').requiredWhen).toEqual({ other: ['haute'] })
  })

  it('renommage décoché : la condition garde l\'ancienne valeur, et son avertissement', () => {
    const t = objTypeToEditable(TYPE)
    t.statuses[2] = { ...t.statuses[2], name: 'validated' }
    const saved = editableToObjType(withRenamedRequiredWhen(t, TYPE, []))
    expect(fieldOf(saved, 'rationale').requiredWhen?.status).toEqual(['approved', 'review'])
    expect(requiredWhenIssues(saved).map(i => i.level)).toEqual(['warning'])
  })

  it('deux champs échangent leur nom : les clés s\'échangent', () => {
    const type: ObjectTypeDefinition = {
      ...TYPE,
      fields: [
        { name: 'a', type: 'enum', values: ['1'] }, { name: 'b', type: 'enum', values: ['2'] },
        { name: 'x', type: 'text', requiredWhen: { a: ['1'], b: ['2'] } },
      ],
    }
    const t = objTypeToEditable(type)
    t.fields[0] = { ...t.fields[0], name: 'b' }
    t.fields[1] = { ...t.fields[1], name: 'a' }
    expect(fieldOf(editableToObjType(withRenamedRequiredWhen(t, type, [])), 'x').requiredWhen).toEqual({ b: ['1'], a: ['2'] })
  })

  it('condition déjà corrigée à la main : pas de doublon', () => {
    const t = objTypeToEditable(TYPE)
    t.statuses[2] = { ...t.statuses[2], name: 'validated' }
    t.fields[3] = { ...t.fields[3], requiredWhen: 'status = validated, approved' }
    const saved = editableToObjType(withRenamedRequiredWhen(t, TYPE, [statusRename('approved', 'validated')]))
    expect(fieldOf(saved, 'rationale').requiredWhen).toEqual({ status: ['validated'] })
  })

  it('un vrai champ nommé `status` ne se confond pas avec le pseudo-champ statut', () => {
    const type: ObjectTypeDefinition = {
      ...TYPE,
      fields: [{ name: 'status', type: 'enum', values: ['on'] }, { name: 'x', type: 'text', requiredWhen: { status: ['approved'] } }],
    }
    const t = objTypeToEditable(type)
    t.fields[0] = { ...t.fields[0], name: 'etat', values: 'off' }
    const saved = editableToObjType(withRenamedRequiredWhen(t, type, [{ target: { kind: 'field', field: 'etat', multi: false }, from: 'on', to: 'off' }]))
    expect(fieldOf(saved, 'x').requiredWhen).toEqual({ status: ['approved'] })
  })

  it('runFields et stepFields : clés et valeurs suivent dans leur liste, `result` reste intact', () => {
    const t = objTypeToEditable(TEST_TYPE)
    t.runFields[0] = { ...t.runFields[0], name: 'banc', values: 'bx, b2' }
    t.stepFields[0] = { ...t.stepFields[0], name: 'regime' }
    const saved = editableToObjType(withRenamedRequiredWhen(t, TEST_TYPE, []))
    expect(saved.runFields?.find(f => f.name === 'note')?.requiredWhen).toEqual({ result: ['FAIL'], banc: ['bx'] })
    expect(saved.stepFields?.find(f => f.name === 'measure')?.requiredWhen).toEqual({ regime: ['m1'] })
  })

  it('aucun renommage : le schéma enregistré est identique', () => {
    const t = objTypeToEditable(TYPE)
    expect(editableToObjType(withRenamedRequiredWhen(t, TYPE, []))).toEqual(editableToObjType(t))
  })
})
