import { describe, expect, it } from 'vitest'
import type { ObjectTypeDefinition } from '@polenta/types'
import { defaultLinkTypes, linkTypeNamingRoot, offeredDefaultLinks, requirementRefs, showsIssueImpact, type DefaultLinkKind } from './defaultLinkTypes'

const type = (name: string, category: ObjectTypeDefinition['category']) =>
  ({ name, label: name, prefix: name, category, fields: [], statuses: [] }) as unknown as ObjectTypeDefinition
const TYPES = [type('CONTROLE_MOTEUR_REQ', 'requirement'), type('CONTROLE_MOTEUR_TEST', 'test'), type('CONTROLE_MOTEUR_ISS', 'issue')]
const labels = (kind: DefaultLinkKind) => kind === 'verification'
  ? { labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par' }
  : { labelSourceToTarget: 'est implémentée par', labelTargetToSource: 'implémente' }
const ALL: DefaultLinkKind[] = ['verification', 'implementation', 'implementation-parent']
const input = (over: Partial<Parameters<typeof defaultLinkTypes>[0]> = {}) => ({
  kinds: ALL, root: 'Contrôle moteur', node: 'moteur', objectTypes: TYPES, parentRefs: ['root::SYS'], labels, taken: [], ...over,
})

describe('GH373 — types de liens par défaut', () => {
  it('U-1 liens proposés selon les cases cochées', () => {
    expect(offeredDefaultLinks(['requirement', 'test', 'issue'], true)).toEqual(ALL)
    expect(offeredDefaultLinks(['requirement', 'issue'], true)).toEqual(['implementation', 'implementation-parent'])
    expect(offeredDefaultLinks(['test', 'issue'], true)).toEqual([])
    expect(offeredDefaultLinks(['requirement', 'test'], false)).toEqual(['verification', 'implementation'])
  })

  it('U-2 issue-impact affiché avec issue + exigence seulement', () => {
    expect(showsIssueImpact(['requirement', 'issue'])).toBe(true)
    expect(showsIssueImpact(['issue'])).toBe(false)
    expect(showsIssueImpact(['requirement', 'test'])).toBe(false)
  })

  it('U-3 racine des noms', () => {
    expect(linkTypeNamingRoot('Contrôle moteur')).toBe('controle-moteur')
    expect(linkTypeNamingRoot('comp-motor-control')).toBe('comp-motor-control')
  })

  it('U-4 composant local : refs du nœud, lien parent à part, defaultVisible sur la vérification', () => {
    expect(defaultLinkTypes(input())).toEqual({
      own: [
        { name: 'controle-moteur-verification', labelSourceToTarget: 'vérifie', labelTargetToSource: 'est vérifiée par',
          sourceRefs: ['moteur::CONTROLE_MOTEUR_TEST'], targetRefs: ['moteur::CONTROLE_MOTEUR_REQ'], defaultVisible: true },
        { name: 'controle-moteur-implementation', labelSourceToTarget: 'est implémentée par', labelTargetToSource: 'implémente',
          sourceRefs: ['moteur::CONTROLE_MOTEUR_REQ'], targetRefs: ['moteur::CONTROLE_MOTEUR_REQ'] },
      ],
      parent: [
        { name: 'controle-moteur-implementation-parent', labelSourceToTarget: 'est implémentée par', labelTargetToSource: 'implémente',
          sourceRefs: ['root::SYS'], targetRefs: ['moteur::CONTROLE_MOTEUR_REQ'] },
      ],
    })
  })

  it('U-5 repo séparé : refs root::', () => {
    const { own } = defaultLinkTypes(input({ node: 'root' }))
    expect(own[0].sourceRefs).toEqual(['root::CONTROLE_MOTEUR_TEST'])
    expect(own[1].targetRefs).toEqual(['root::CONTROLE_MOTEUR_REQ'])
  })

  it('U-6 collision : premier suffixe libre', () => {
    const { own, parent } = defaultLinkTypes(input({ taken: ['controle-moteur-verification', 'controle-moteur-verification-2', 'controle-moteur-implementation'] }))
    expect(own.map(l => l.name)).toEqual(['controle-moteur-verification-3', 'controle-moteur-implementation-2'])
    expect(parent[0].name).toBe('controle-moteur-implementation-parent')
  })

  it('U-7 extrémité absente : lien omis', () => {
    expect(defaultLinkTypes(input({ objectTypes: [TYPES[0]], parentRefs: [] }))).toEqual({
      own: [expect.objectContaining({ name: 'controle-moteur-implementation' })], parent: [],
    })
    expect(defaultLinkTypes(input({ objectTypes: [TYPES[1]] }))).toEqual({ own: [], parent: [] })
    expect(defaultLinkTypes(input({ kinds: ['implementation'] })).own.map(l => l.name)).toEqual(['controle-moteur-implementation'])
  })

  it('U-8 forme de l\'onglet Liens : pas de defaultVisible à false', () => {
    const { own } = defaultLinkTypes(input())
    expect(Object.keys(own[1]).sort()).toEqual(['labelSourceToTarget', 'labelTargetToSource', 'name', 'sourceRefs', 'targetRefs'])
  })

  it('requirementRefs : types exigence du nœud', () => {
    expect(requirementRefs({ name: 'root', objectTypes: [type('SYS', 'requirement'), type('T', 'test'), type('SW', 'requirement')] } as never))
      .toEqual(['root::SYS', 'root::SW'])
    expect(requirementRefs(undefined)).toEqual([])
  })
})
