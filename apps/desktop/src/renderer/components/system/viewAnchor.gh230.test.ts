import { describe, expect, it } from 'vitest'
import type { TypeTreeNode } from '@polenta/types'
import { scrollCandidates } from './viewAnchor'

const item = (id: string): TypeTreeNode => ({ id, kind: 'item', name: id, objectId: id.toUpperCase(), children: [] })
const folder = (id: string, children: TypeTreeNode[]): TypeTreeNode => ({ id, kind: 'folder', name: id, children })

// a ─ a1 ─ x
//   └ a2
// b
const root = [folder('a', [folder('a1', [item('x')]), item('a2')]), item('b')]

describe('GH230 — scrollCandidates', () => {
  it('U1 — nœud, ancêtres du plus proche au plus haut, puis suivants et précédents', () => {
    expect(scrollCandidates(root, 'x')).toEqual(['x', 'a1', 'a', 'a2', 'b'])
  })

  it('U1 — dossier : ses descendants avant les nœuds suivants', () => {
    expect(scrollCandidates(root, 'a1')).toEqual(['a1', 'a', 'x', 'a2', 'b'])
  })

  it('U1 — dernier nœud : précédents en sens inverse, chacun une fois', () => {
    expect(scrollCandidates(root, 'b')).toEqual(['b', 'a2', 'x', 'a1', 'a'])
  })

  it('U1 — nœud inconnu : lui seul', () => {
    expect(scrollCandidates(root, 'zz')).toEqual(['zz'])
  })
})
