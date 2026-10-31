import { describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition } from '@polenta/types'
import { editableToObjType, emptyObjType, objTypeToEditable } from './objectTypeEditor'

// GH229 — « ID affiché » dans l'éditeur de type (scénario L14 de specs/GH229-tests.md).

const TYPE: ObjectTypeDefinition = {
  name: 'exigence', category: 'requirement',
  fields: [{ name: 'clientRef', type: 'text' }, { name: 'statement', type: 'richtext' }],
  displayIdField: 'clientRef',
}

describe('displayIdField', () => {
  it('absent par défaut : aucune clé écrite', () => {
    expect(editableToObjType(emptyObjType('requirement', 'VE12A', 'Exigence', 'Description'))).not.toHaveProperty('displayIdField')
  })

  it('aller-retour stable', () => {
    expect(editableToObjType(objTypeToEditable(TYPE)).displayIdField).toBe('clientRef')
  })

  it('champ choisi renommé dans l\'éditeur : displayIdField suit le nouveau nom', () => {
    const renamed = objTypeToEditable(TYPE)
    renamed.fields[0] = { ...renamed.fields[0], name: 'reference' }
    expect(editableToObjType(renamed).displayIdField).toBe('reference')
  })

  it('L14 — champ choisi supprimé ou retypé : displayIdField retiré', () => {
    const removed = objTypeToEditable(TYPE)
    removed.fields = removed.fields.filter(f => f.name !== 'clientRef')
    expect(editableToObjType(removed)).not.toHaveProperty('displayIdField')

    const retyped = objTypeToEditable(TYPE)
    retyped.fields[0] = { ...retyped.fields[0], type: 'richtext' }
    expect(editableToObjType(retyped)).not.toHaveProperty('displayIdField')
  })
})
