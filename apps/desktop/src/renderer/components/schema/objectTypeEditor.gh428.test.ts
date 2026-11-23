import { describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition } from '@polenta/types'
import { editableToObjType, objTypeToEditable } from './objectTypeEditor'

// GH428 — « renseigné en campagne » : propriété des champs d'exécution (`runFields`) seulement, écrite
// quand elle est vraie, relue dans l'éditeur, absente des champs d'étape et des champs du test.

const TYPE: ObjectTypeDefinition = {
  name: 'essai', category: 'test', fields: [{ name: 'dev', type: 'text' }],
  statuses: [{ name: 'draft' }, { name: 'approved', isApproval: true }],
  runFields: [
    { name: 'criticite', type: 'enum', values: ['critique', 'regression'], campaignInput: true },
    { name: 'rapport', type: 'text' },
  ],
  stepFields: [{ name: 'mesure', type: 'number' }],
}

describe('éditeur de schéma — renseigné en campagne (GH428)', () => {
  it('relit la propriété sur un champ d\'exécution', () => {
    const edited = objTypeToEditable(TYPE)
    expect(edited.runFields[0].campaignInput).toBe(true)
    expect(edited.runFields[1].campaignInput).toBe(false)
  })

  it('écrit la propriété seulement quand elle est vraie', () => {
    const back = editableToObjType(objTypeToEditable(TYPE))
    expect(back.runFields).toEqual(TYPE.runFields)
    expect(back.runFields![1]).not.toHaveProperty('campaignInput')
  })

  it('n\'écrit jamais la propriété sur un champ d\'étape ni sur un champ du test', () => {
    const edited = objTypeToEditable({ ...TYPE, stepFields: [{ name: 'mesure', type: 'number', campaignInput: true } as never] })
    const back = editableToObjType(edited)
    expect(back.stepFields![0]).not.toHaveProperty('campaignInput')
    expect(back.fields[0]).not.toHaveProperty('campaignInput')
  })

  it('coche dans l\'éditeur → écrite dans le schéma', () => {
    const edited = objTypeToEditable(TYPE)
    edited.runFields[1] = { ...edited.runFields[1], campaignInput: true }
    const back = editableToObjType(edited)
    expect(back.runFields![1].campaignInput).toBe(true)
  })
})
