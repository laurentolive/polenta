import { describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition } from '@polenta/types'
import { canTrackHistory, editableToObjType, emptyObjType, fieldRenames, objTypeToEditable } from './objectTypeEditor'

// GH77 sprint 2 — options d'historique de l'éditeur de type (scénarios C1–C2, R4 de specs/GH77-tests.md).

const TYPE: ObjectTypeDefinition = {
  name: 'exigence', category: 'requirement',
  fields: [
    { name: 'priority', type: 'enum', values: ['high', 'low'], trackHistory: true },
    { name: 'statement', type: 'richtext', validator: 'EARS' },
  ],
  statuses: [{ name: 'draft' }],
}

describe('convertisseurs', () => {
  it('C1 — statut suivi par défaut : aucune clé trackStatusHistory écrite', () => {
    const fresh = editableToObjType(emptyObjType('requirement', 'VE12A', 'Exigence', 'Description'))
    expect(fresh).not.toHaveProperty('trackStatusHistory')
    expect(fresh.fields[0]).not.toHaveProperty('trackHistory')
  })

  it('C2 — décocher le statut écrit trackStatusHistory: false, aller-retour stable', () => {
    const editable = { ...objTypeToEditable(TYPE), trackStatusHistory: false }
    const saved = editableToObjType(editable)
    expect(saved.trackStatusHistory).toBe(false)
    expect(objTypeToEditable(saved).trackStatusHistory).toBe(false)
  })

  it('trackHistory conservé à l\'aller-retour, écrit seulement si vrai', () => {
    const saved = editableToObjType(objTypeToEditable(TYPE))
    expect(saved.fields[0].trackHistory).toBe(true)
    expect(saved.fields[1]).not.toHaveProperty('trackHistory')
  })

  it('un champ nommé status ne peut pas être historisé', () => {
    expect(canTrackHistory({ name: 'status', type: 'enum' })).toBe(false)
    const editable = objTypeToEditable(TYPE)
    editable.fields[0] = { ...editable.fields[0], name: 'status' }
    expect(editableToObjType(editable).fields[0]).not.toHaveProperty('trackHistory')
  })
})

describe('fieldRenames', () => {
  it('détecte un renommage par le nom d\'origine', () => {
    const editable = objTypeToEditable(TYPE)
    editable.fields[0] = { ...editable.fields[0], name: 'criticite' }
    expect(fieldRenames(editable)).toEqual([{ from: 'priority', to: 'criticite' }])
  })

  it('R4 — champ supprimé puis recréé sous un autre nom : pas de renommage', () => {
    const editable = objTypeToEditable(TYPE)
    editable.fields = [editable.fields[1], { ...editable.fields[0], name: 'criticite', originalName: undefined }]
    expect(fieldRenames(editable)).toEqual([])
  })

  it('nom vidé pendant la saisie : ignoré', () => {
    const editable = objTypeToEditable(TYPE)
    editable.fields[0] = { ...editable.fields[0], name: '' }
    expect(fieldRenames(editable)).toEqual([])
  })
})
