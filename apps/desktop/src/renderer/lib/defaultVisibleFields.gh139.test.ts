import { describe, expect, it } from 'vitest'
import type { LinkTypeDefinition, ObjectTypeDefinition } from '@polenta/types'
import { defaultVisibleFields } from './exportColumns'

// GH139 — colonnes par défaut portées par le schéma : champs et types de lien `defaultVisible`.

const req = (fields: ObjectTypeDefinition['fields']): ObjectTypeDefinition =>
  ({ name: 'exigence-metier', category: 'requirement', fields })

const LINKS: LinkTypeDefinition[] = [
  { name: 'raffinement', labelSourceToTarget: 'raffine', labelTargetToSource: 'est raffinée par', sourceRefs: ['requirement'], targetRefs: ['requirement'], defaultVisible: true },
  { name: 'verification', labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par', sourceRefs: ['test'], targetRefs: ['requirement'], defaultVisible: true },
  { name: 'relation', labelSourceToTarget: 'r', labelTargetToSource: 'r', sourceRefs: ['requirement'], targetRefs: ['test'] },
]

describe('defaultVisibleFields', () => {
  it('sans defaultVisible : système + 3 premiers champs (version incluse pour une exigence)', () => {
    const t = req([{ name: 'a', type: 'text' }, { name: 'b', type: 'text' }, { name: 'c', type: 'text' }, { name: 'd', type: 'text' }])
    expect(defaultVisibleFields(t)).toEqual(['section', 'name', 'id', 'status', 'version', 'a', 'b', 'c'])
  })

  it('champs defaultVisible seuls, dans l’ordre du schéma', () => {
    const t = req([{ name: 'a', type: 'text' }, { name: 'b', type: 'text', defaultVisible: true }, { name: 'c', type: 'text' }, { name: 'd', type: 'text', defaultVisible: true }])
    expect(defaultVisibleFields(t)).toEqual(['section', 'name', 'id', 'status', 'version', 'b', 'd'])
  })

  it('types de lien defaultVisible qui concernent le type : link-out/in en vue Tableau si source et cible, link:: sinon', () => {
    const t = req([{ name: 'a', type: 'text', defaultVisible: true }])
    const opts = { linkTypes: LINKS, objectTypeRef: 'root::exigence-metier' }
    expect(defaultVisibleFields(t, { ...opts, view: 'excel' }).slice(6))
      .toEqual(['link-out::raffinement', 'link-in::raffinement', 'link::verification'])
    expect(defaultVisibleFields(t, { ...opts, view: 'word' }).slice(6)).toEqual(['link::raffinement', 'link::verification'])
  })
})
