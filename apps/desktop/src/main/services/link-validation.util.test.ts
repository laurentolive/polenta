import { describe, expect, it } from 'vitest'
import { matchesRefs, validateLinkEntries, type ResolvedLinkObject } from './link-validation.util'

// GH105 — résolution d'une ref `<nœud>::<type>` avec le repo de l'objet (chaque repo a un nœud
// `root`) ; sans contexte, comparaison historique sur l'objectTypeRef seul.

const obj = (id: string, ref: string, repoPath: string, category: ResolvedLinkObject['category'] = 'requirement'): ResolvedLinkObject =>
  ({ id, category, objectTypeRef: ref, repoPath })

describe('GH105 — matchesRefs avec portée workspace', () => {
  const declaredBy = { 'root::X': ['/prod', '/comp'], 'root::C_REQ': ['/comp'] }

  it('ref déclarée par le repo du type de lien : seuls ses objets — L6', () => {
    const scope = { definingRepo: '/prod', declaredBy }
    expect(matchesRefs(obj('A', 'root::X', '/prod'), ['root::X'], scope)).toBe(true)
    expect(matchesRefs(obj('B', 'root::X', '/comp'), ['root::X'], scope)).toBe(false)
  })

  it('ref déclarée par un autre repo : ses objets', () => {
    const scope = { definingRepo: '/prod', declaredBy }
    expect(matchesRefs(obj('C', 'root::C_REQ', '/comp'), ['root::C_REQ'], scope)).toBe(true)
  })

  it('ref par catégorie : objets de tous les repos — L7', () => {
    const scope = { definingRepo: '/prod', declaredBy }
    expect(matchesRefs(obj('T', 'root::T', '/comp', 'test'), ['test'], scope)).toBe(true)
    expect(matchesRefs(obj('R', 'root::R', '/comp'), ['test'], scope)).toBe(false)
  })

  it('sans portée : comparaison sur objectTypeRef seul (comportement antérieur)', () => {
    expect(matchesRefs(obj('B', 'root::X', '/comp'), ['root::X'])).toBe(true)
  })
})

describe('GH105 — validateLinkEntries : ownerId côté sourceRefs', () => {
  const lt = [{ name: 'implements', labelSourceToTarget: '', labelTargetToSource: '', sourceRefs: ['root::P'], targetRefs: ['root::C'], definingRepo: '/prod' }]
  const table = new Map([
    ['P-1', obj('P-1', 'root::P', '/prod')],
    ['C-1', obj('C-1', 'root::C', '/comp')],
  ])
  const declaredBy = { 'root::P': ['/prod'], 'root::C': ['/comp'] }

  it('sens accepté : ownerId = sourceId', () => {
    const { valid } = validateLinkEntries(lt, [{ type: 'implements', sourceId: 'P-1', targetId: 'C-1' }], (id) => table.get(id) ?? null, [], declaredBy)
    expect(valid[0].ownerId).toBe('P-1')
  })

  it('sens inverse : ownerId = targetId, sens fourni conservé', () => {
    const { valid } = validateLinkEntries(lt, [{ type: 'implements', sourceId: 'C-1', targetId: 'P-1' }], (id) => table.get(id) ?? null, [], declaredBy)
    expect(valid[0]).toMatchObject({ ownerId: 'P-1', dto: { sourceId: 'C-1', targetId: 'P-1' } })
  })
})
