import { describe, expect, it } from 'vitest'
import { adoptExternal, changedKeys, draftFields, externalConflicts, fieldKeys } from './draftSync'

describe('GH342 draftSync (C1)', () => {
  const base = { title: 'T', 'field:a': 'a0', 'field:b': 'b0' }

  it('changement extérieur d’une clé non saisie : adopté, sans conflit', () => {
    const r = adoptExternal(base, { ...base }, { ...base, 'field:a': 'a1' })
    expect(r.conflicts).toEqual([])
    expect(r.draft['field:a']).toBe('a1')
    expect(r.base['field:a']).toBe('a1')
    expect(changedKeys(r.base, r.draft)).toEqual([])
  })

  it('saisie ici seulement : gardée, toujours à envoyer', () => {
    const draft = { ...base, 'field:b': 'b-ici' }
    const r = adoptExternal(base, draft, { ...base })
    expect(r.draft['field:b']).toBe('b-ici')
    expect(changedKeys(r.base, r.draft)).toEqual(['field:b'])
  })

  it('autre champ modifié ailleurs pendant la saisie d’un champ : les deux conservés (CA5)', () => {
    const draft = { ...base, 'field:b': 'b-ici' }
    const r = adoptExternal(base, draft, { ...base, 'field:a': 'a-ailleurs' })
    expect(r.conflicts).toEqual([])
    expect(r.draft).toEqual({ title: 'T', 'field:a': 'a-ailleurs', 'field:b': 'b-ici' })
    expect(changedKeys(r.base, r.draft)).toEqual(['field:b'])
  })

  it('même valeur des deux côtés : pas de conflit, plus rien à envoyer', () => {
    const draft = { ...base, title: 'T2' }
    const r = adoptExternal(base, draft, { ...base, title: 'T2' })
    expect(r.conflicts).toEqual([])
    expect(changedKeys(r.base, r.draft)).toEqual([])
  })

  it('même clé modifiée des deux côtés, différemment : conflit (CA6)', () => {
    const draft = { ...base, title: 'ici' }
    const server = { ...base, title: 'ailleurs' }
    expect(externalConflicts(base, draft, server)).toEqual(['title'])
    const r = adoptExternal(base, draft, server)
    expect(r.conflicts).toEqual(['title'])
    expect(r.draft.title).toBe('ici')
    expect(r.base.title).toBe('T')
  })

  it('clé absente d’un côté vaut chaîne vide', () => {
    const r = adoptExternal({}, {}, { 'field:new': 'x' })
    expect(r.draft['field:new']).toBe('x')
    expect(changedKeys({ 'field:z': '' }, {})).toEqual([])
  })

  it('draftFields / fieldKeys', () => {
    expect(draftFields({ title: 'T', 'field:a': '1' })).toEqual({ a: '1' })
    expect(fieldKeys({ a: '1' })).toEqual({ 'field:a': '1' })
  })
})
