import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { diffTree, OBJECT_DESC, type DiffNode } from '@polenta/merge-core'
import { addUnder, restoreRow, setRowValue } from './draftEdit'

/** GH222 sprint 5 — modifications du brouillon depuis la vue générique (spec §12). */

const opts = { lineWidth: 120 }
const dump = (o: unknown) => yaml.dump(o, opts)

function index(before: unknown, after: unknown, desc = OBJECT_DESC) {
  const root = diffTree(before, after, desc)
  const nodes = new Map<string, DiffNode>()
  const walk = (n: DiffNode) => { nodes.set(n.key, n); n.children?.forEach(walk) }
  walk(root)
  return { root, nodes, at: (k: string) => nodes.get(k)! }
}

describe('draftEdit', () => {
  const before = { title: 'avant', fields: { a: 1, gone: 'x' }, list: [{ id: 'k', v: 1 }] }
  const after = { title: 'après', fields: { a: 1, added: 'y' }, list: [{ id: 'k', v: 2 }, { id: 'n', v: 3 }] }
  const { nodes, at } = index(before, after)

  it('sets a value at a row', () => {
    const out = setRowValue(dump(after), at('/list/@k/v'), nodes, 7, opts)!
    expect((yaml.load(out) as typeof after).list[0].v).toBe(7)
  })

  it('restores a changed, an added and a removed row', () => {
    let text = dump(after)
    text = restoreRow(text, at('/title'), nodes, opts)!
    text = restoreRow(text, at('/fields/added'), nodes, opts)!
    text = restoreRow(text, at('/fields/gone'), nodes, opts)!
    text = restoreRow(text, at('/list/@n'), nodes, opts)!
    expect(yaml.load(text)).toEqual({ title: 'avant', fields: { a: 1, gone: 'x' }, list: [{ id: 'k', v: 2 }] })
  })

  it('adds under a list (shaped like its last element, steps numbered) and a mapping', () => {
    const steps = { steps: [{ order: 1, action: 'a', expectedResult: 'r' }], fields: { a: 1 } }
    const { nodes: n2, at: at2 } = index(steps, steps)
    const withStep = addUnder(dump(steps), at2('/steps'), n2, opts)!
    expect((yaml.load(withStep) as typeof steps).steps[1]).toEqual({ order: 2, action: '', expectedResult: '' })
    const withKey = addUnder(dump(steps), at2('/fields'), n2, opts, 'nouveau')!
    expect((yaml.load(withKey) as typeof steps).fields).toEqual({ a: 1, nouveau: '' })
    expect(addUnder(dump(steps), at2('/fields'), n2, opts, 'a')).toBeNull()
  })
})
