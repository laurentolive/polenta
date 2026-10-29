import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { diffTree, LINKS_DESC, mergeFile, OBJECT_DESC, parseOutput, type DiffNode } from '@polenta/merge-core'
import { blockRows, outputAt } from './mergeModel'

/** GH222 sprint 4 — vue générique en merge : blocs rattachés aux rangées, sortie lue par rangée. */

const labels = { left: 'dev', right: 'main' }
const dump = (o: unknown) => yaml.dump(o, { lineWidth: 120 })

function find(root: DiffNode, key: string): DiffNode {
  const go = (n: DiffNode): DiffNode | undefined => (n.key === key ? n : n.children?.map(go).find(Boolean))
  return go(root)!
}

describe('blockRows', () => {
  it('object units, links and pointers map to their row', () => {
    const base = { id: 'SYS-1', objectTypeRef: 'r::t', title: 'b', fields: { p: 'm' } }
    const left = { ...base, title: 'L', fields: { p: 'h' } }
    const right = { ...base, title: 'R', fields: { p: 'l' } }
    const m = mergeFile(dump(base), dump(left), dump(right), labels, 'requirements/SYS-1.yaml')
    const root = diffTree(left, right, OBJECT_DESC)
    const rows = blockRows(root, m.blocks.map(b => b.key), OBJECT_DESC)
    expect(rows.get('title')).toBe('/title')
    expect(rows.get('fields.p')).toBe('/fields/p')

    const L = (target: string) => ({ links: [{ id: 'A', type: 'v', sourceId: 'T', targetId: target }] })
    const linkRoot = diffTree(L('X'), L('Y'), LINKS_DESC)
    expect(blockRows(linkRoot, ['link:A'], LINKS_DESC).get('link:A')).toBe('/links/@A')
    expect(blockRows(diffTree({ a: { b: 1 } }, { a: { b: 2 } }), ['/a/b'], undefined).get('/a/b')).toBe('/a/b')
  })

  it('a block of a list aligned as a whole goes to its list row', () => {
    const steps = (a: string) => ({ steps: [{ order: 1, action: a }] })
    const root = diffTree(steps('L'), steps('R'), OBJECT_DESC)
    expect(blockRows(root, ['steps~0'], OBJECT_DESC).get('steps~0')).toBe('/steps')
  })
})

describe('outputAt', () => {
  it('finds identified elements by identity and aligned ones by content', () => {
    const left = { links: [{ id: 'A', t: 1 }, { id: 'B', t: 1 }], steps: [{ order: 1, action: 'x' }, { order: 2, action: 'y' }] }
    const right = { links: [{ id: 'B', t: 2 }, { id: 'A', t: 1 }], steps: [{ order: 1, action: 'x' }, { order: 2, action: 'y' }] }
    const root = diffTree(left, right)
    expect(outputAt(right, find(root, '/links/@B/t'))).toEqual({ path: ['links', 0, 't'], value: 2 })
    const out = { steps: [{ order: 1, action: 'new' }, { order: 2, action: 'x' }, { order: 3, action: 'y' }] }
    const stepY = root.children!.find(c => c.key === '/steps')!.children![1]
    expect(outputAt(out, stepY)?.path).toEqual(['steps', 2])
  })

  it('a row inside an open region has no place in the parsed output', () => {
    const base = { a: { x: 1 }, b: 1 }
    const m = mergeFile(dump(base), dump({ a: { x: 2 }, b: 1 }), dump({ a: { x: 3 }, b: 1 }), labels, 'f.yaml')
    const out = parseOutput('yaml', m.output).value
    const root = diffTree({ a: { x: 2 }, b: 1 }, { a: { x: 3 }, b: 1 })
    expect(outputAt(out, find(root, '/a/x'))).toBeNull()
    expect(outputAt(out, find(root, '/b'))).toEqual({ path: ['b'], value: 1 })
  })
})

describe('outputAt — revue sprint 4', () => {
  it('a field of a test step is found in the output, whichever side the output holds', () => {
    const step = (a: string, r: string) => ({ order: 1, action: a, expectedResult: r })
    const left = { steps: [step('a', 'L')] }
    const right = { steps: [step('a', 'R')] }
    const root = diffTree(left, right, OBJECT_DESC)
    const nodes = new Map<string, DiffNode>()
    const walk = (n: DiffNode) => { nodes.set(n.key, n); n.children?.forEach(walk) }
    walk(root)
    const action = [...nodes.values()].find(n => n.key.endsWith('/action'))!
    // The output took the left version of the step.
    expect(outputAt(left, action, nodes)).toEqual({ path: ['steps', 0, 'action'], value: 'a' })
    expect(outputAt(right, action, nodes)).toEqual({ path: ['steps', 0, 'action'], value: 'a' })
  })
})
