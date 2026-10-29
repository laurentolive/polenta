import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { findRegions, mergeFile, resolveRegion, resolveRegionBoth, resolveRegionWith } from '@polenta/merge-core'
import { findLines, resetBlock, resolvedBlocks, sideAnchors } from './blockLocator'

/** GH222 — repérage des blocs dans les panneaux et dans la sortie (actions, « Réinitialiser »). */

const labels = { left: 'dev', right: 'main' }
const dump = (o: unknown) => yaml.dump(o, { lineWidth: 120 })
const base = { title: 'base', rows: [['un'], ['deux']], keep: 'x' }
const left = { ...base, title: 'gauche', rows: [['un'], ['G']] }
const right = { ...base, title: 'droite', rows: [['un'], ['D']] }
const m = mergeFile(dump(base), dump(left), dump(right), labels, 'a.yaml')

describe('blockLocator', () => {
  it('findLines finds whole lines only, skipping ranges', () => {
    expect(findLines('a\nb\nc\nb\n', 'b\n')).toEqual({ from: 1, to: 1 })
    expect(findLines('a\nb\nc\nb\n', 'b\n', 0, [[1, 1]])).toEqual({ from: 3, to: 3 })
    expect(findLines('ab\n', 'b\n')).toBeNull()
    expect(findLines('a\n', '')).toBeNull()
  })

  it('sideAnchors puts each open block on its fragment line in a side', () => {
    const open = new Map(findRegions(m.output).regions.map(r => [r.key, r.start] as const))
    const anchors = sideAnchors(dump(left), m.blocks, open, 'left')
    expect(anchors.map(a => a.key)).toEqual(m.blocks.map(b => b.key))
    const lines = dump(left).split('\n')
    expect(lines[anchors[0].line]).toContain('gauche')
  })

  it('a resolved block is found with how it was taken, and reset restores the region', () => {
    const key = '/title'
    const out = resolveRegion(m.output, key, 'right')
    const found = resolvedBlocks(out, m.blocks, labels)
    expect(found).toEqual([expect.objectContaining({ key, taken: 'right' })])
    const block = m.blocks.find(b => b.key === key)!
    expect(resetBlock(out, block, found[0], labels)).toBe(m.output)
  })

  it('« les deux » is recognized before either side', () => {
    const key = m.blocks.find(b => b.key.startsWith('/rows'))!.key
    const out = resolveRegionBoth(m.output, key)
    expect(resolvedBlocks(out, m.blocks, labels)).toEqual([expect.objectContaining({ key, taken: 'both' })])
  })

  it('a short resolved text repeated elsewhere is found where its region was', () => {
    const dup = { a: 'x', b: { t: 'base' }, c: { t: 'gauche' } }
    const mm = mergeFile(dump(dup), dump({ ...dup, b: { t: 'gauche' } }), dump({ ...dup, b: { t: 'droite' } }), labels, 'd.yaml')
    const region = findRegions(mm.output).regions[0]
    const out = resolveRegion(mm.output, '/b/t', 'left')
    const [found] = resolvedBlocks(out, mm.blocks, labels, new Map([['/b/t', region.start]]))
    expect(found.from).toBe(region.start)
  })

  it('a block resolved with the ancestor is reported as such, and reset restores the region', () => {
    const block = m.blocks.find(b => b.key === '/title')!
    const out = resolveRegionWith(m.output, '/title', block.base!)
    const [found] = resolvedBlocks(out, m.blocks, labels)
    expect(found).toMatchObject({ key: '/title', taken: 'base' })
    expect(resetBlock(out, block, found, labels)).toBe(m.output)
  })

  it('a block edited by hand is not reported as resolved', () => {
    const out = resolveRegion(m.output, '/title', 'left').replace('title: gauche', 'title: autre')
    expect(resolvedBlocks(out, m.blocks, labels)).toEqual([])
  })
})
