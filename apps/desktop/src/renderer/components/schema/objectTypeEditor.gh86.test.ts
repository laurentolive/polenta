import { describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition } from '@polenta/types'
import { editableToObjType, emptyField, objTypeToEditable } from './objectTypeEditor'

// GH86 — enregistrer un type dans l'éditeur ne perd plus les clés qu'il n'affiche pas.

const TYPE = {
  name: 'exigence', label: 'Exigence', prefix: 'SYS', category: 'requirement',
  fields: [
    { name: 'statement', label: 'Énoncé', type: 'richtext', required: true, validator: 'EARS' },
    { name: 'ref', type: 'text', validator: 'regex:^[A-Z]+$', futureKey: { a: 1 } },
  ],
  statuses: [{ name: 'draft', label: 'Brouillon', futureStatusKey: true }],
  futureTypeKey: 'x',
} as unknown as ObjectTypeDefinition

describe('objectTypeEditor — clés hors éditeur (GH86)', () => {
  it('aller-retour sans modification : type identique, validator compris', () => {
    expect(editableToObjType(objTypeToEditable(TYPE))).toEqual(TYPE)
  })

  it('modifier le libellé du type conserve validator et clés inconnues', () => {
    const saved = editableToObjType({ ...objTypeToEditable(TYPE), label: 'Exigence système' }) as unknown as typeof TYPE & Record<string, unknown>
    expect(saved.label).toBe('Exigence système')
    expect(saved.fields.map(f => f.validator)).toEqual(['EARS', 'regex:^[A-Z]+$'])
    expect((saved.fields[1] as unknown as Record<string, unknown>).futureKey).toEqual({ a: 1 })
    expect((saved.statuses![0] as unknown as Record<string, unknown>).futureStatusKey).toBe(true)
    expect(saved.futureTypeKey).toBe('x')
  })

  it('les clés éditées gardent la main : vider un libellé le retire', () => {
    const editable = objTypeToEditable(TYPE)
    editable.fields[0] = { ...editable.fields[0], label: '', required: false }
    const field = editableToObjType(editable).fields[0]
    expect(field).toEqual({ name: 'statement', type: 'richtext', validator: 'EARS' })
  })

  it('renommer un champ conserve son validator', () => {
    const editable = objTypeToEditable(TYPE)
    editable.fields[0] = { ...editable.fields[0], name: 'enonce' }
    expect(editableToObjType(editable).fields[0]).toMatchObject({ name: 'enonce', validator: 'EARS' })
  })

  it('un champ ajouté dans l\'éditeur n\'hérite de rien', () => {
    const editable = objTypeToEditable(TYPE)
    editable.fields.push({ ...emptyField(), name: 'nouveau' })
    expect(editableToObjType(editable).fields[2]).toEqual({ name: 'nouveau', type: 'text' })
  })
})
