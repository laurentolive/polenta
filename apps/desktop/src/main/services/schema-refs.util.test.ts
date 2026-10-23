import { describe, expect, it } from 'vitest'
import type { ProjectSchema } from '@polenta/types'
import { declaresRef, dedupeRepos, mapLinkRefs } from './schema-refs.util'

// GH104 — D1 de specs/GH104-tests.md.

const schema = {
  version: 1,
  nodes: [{ name: 'root', objectTypes: [{ name: 'R' }], children: [{ name: 'A', objectTypes: [{ name: 'A_REQ' }] }] }],
  linkTypes: [
    { name: 'implements', sourceRefs: ['A::A_REQ'], targetRefs: ['root::R', 'A::A_REQ'] },
    { name: 'any', targetRefs: ['root::R'] },
  ],
} as unknown as ProjectSchema

describe('schema-refs.util', () => {
  it('mapLinkRefs — null retire, liste vidée conservée, clé absente reste absente', () => {
    const out = mapLinkRefs(schema, r => (r === 'A::A_REQ' ? null : r))
    expect(out.linkTypes).toEqual([
      { name: 'implements', sourceRefs: [], targetRefs: ['root::R'] },
      { name: 'any', targetRefs: ['root::R'] },
    ])
    expect(mapLinkRefs(schema, r => (r === 'root::R' ? 'root::S' : r)).linkTypes?.[1]).toEqual({ name: 'any', targetRefs: ['root::S'] })
  })

  it('declaresRef — nœud imbriqué compris', () => {
    expect(declaresRef(schema, 'A::A_REQ')).toBe(true)
    expect(declaresRef(schema, 'root::A_REQ')).toBe(false)
  })

  it('dedupeRepos — garde la forme du repo du type, retire les doublons', () => {
    expect(dedupeRepos('/w/prod', ['/w/prod', '/w/comp', '/w/comp/'])).toEqual(['/w/prod', '/w/comp'])
  })
})
