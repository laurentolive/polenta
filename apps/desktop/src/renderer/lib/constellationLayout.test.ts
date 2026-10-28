import { describe, expect, it } from 'vitest'
import { buildConstellation, lineage, type ConstellationInputNode } from './constellationLayout'

const node = (id: string, type: string, covered = false): ConstellationInputNode =>
  ({ id, title: id, objectTypeRef: `root::${type}`, covered })
const link = (sourceId: string, targetId: string, i = 0) =>
  ({ id: `L${i}-${sourceId}-${targetId}`, type: 'raffinement', sourceId, targetId })

describe('buildConstellation (GH183)', () => {
  const nodes = [
    node('EM-1', 'metier'), node('EM-2', 'metier'),
    node('EF-1', 'fonct'), node('EF-2', 'fonct'), node('EF-3', 'fonct'),
    node('ET-1', 'tech', true), node('ET-2', 'tech'),
  ]
  const links = [
    link('EF-1', 'EM-1'), link('EF-2', 'EM-1'), link('EF-3', 'EM-2'),
    link('ET-1', 'EF-1'), link('ET-2', 'EF-1'),
  ]

  it('place les types par profondeur moyenne : métier au centre, technique au bord', () => {
    const { nodes: out, ringRadii } = buildConstellation(nodes, links)
    expect(ringRadii).toHaveLength(3)
    expect(out.get('EM-1')!.ring).toBe(0)
    expect(out.get('EF-3')!.ring).toBe(1)
    expect(out.get('ET-2')!.ring).toBe(2)
    expect(out.get('ET-1')!.root).toBe('EM-1')
  })

  it('un pétale par racine, secteurs disjoints', () => {
    const { petals } = buildConstellation(nodes, links)
    expect(petals.map(p => p.rootId)).toEqual(['EM-1', 'EM-2'])
    expect(petals[0].end).toBeLessThan(petals[1].start)
  })

  it('couverture : part des exigences terminales couvertes sous chaque nœud', () => {
    const { nodes: out } = buildConstellation(nodes, links)
    expect(out.get('EF-1')).toMatchObject({ leaves: 2, leavesCovered: 1 })
    expect(out.get('EM-1')).toMatchObject({ leaves: 3, leavesCovered: 1 }) // ET-1, ET-2, EF-2
    expect(out.get('EM-2')).toMatchObject({ leaves: 1, leavesCovered: 0 })
    expect(out.get('ET-1')).toMatchObject({ leaves: 1, leavesCovered: 1 })
  })

  it('sens inversé : la cible raffine la source', () => {
    const reversed = links.map((l, i) => link(l.targetId, l.sourceId, i))
    const { nodes: out } = buildConstellation(nodes, reversed, { childIs: 'target' })
    expect(out.get('EF-1')!.parents).toEqual(['EM-1'])
    expect(out.get('EF-1')!.children).toEqual(['ET-1', 'ET-2'])
  })

  it('ignore les liens vers un objet inconnu et les boucles sur soi', () => {
    const { links: kept } = buildConstellation(nodes, [...links, link('EF-1', 'TC-1'), link('EF-2', 'EF-2')])
    expect(kept).toHaveLength(links.length)
  })

  it('un cycle sans racine est quand même placé', () => {
    const { nodes: out } = buildConstellation([node('A', 't'), node('B', 't')], [link('A', 'B'), link('B', 'A')])
    expect(out.get('A')!.depth).toBe(0)
    expect(out.get('B')!.depth).toBe(1)
    expect(Number.isFinite(out.get('B')!.x)).toBe(true)
  })

  it('un seul type : un anneau par profondeur', () => {
    const { ringRadii, nodes: out } = buildConstellation(
      [node('S-1', 'sys'), node('S-2', 'sys'), node('S-3', 'sys')],
      [link('S-2', 'S-1'), link('S-3', 'S-2')],
    )
    expect(ringRadii).toHaveLength(3)
    expect(out.get('S-3')!.ring).toBe(2)
  })

  it('lignée : ancêtres et descendants, pas les cousins', () => {
    const { nodes: out } = buildConstellation(nodes, links)
    expect([...lineage(out, 'EF-1')].sort()).toEqual(['EF-1', 'EM-1', 'ET-1', 'ET-2'])
  })
})
