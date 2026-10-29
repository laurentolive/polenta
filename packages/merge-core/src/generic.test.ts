import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import {
  canonicalOutput, canTakeBoth, detectKind, diffTree, findRegions, mergeFile, parseOutput, pointer, resolveAllRegions,
  resolveRegion, resolveRegionBoth, updateOutputAt, YAML_DUMP_OPTIONS,
} from './index'

// GH222 — moteur YAML générique (scénarios M2–M24 de specs/GH222-tests.md).

const labels = { left: 'dev-x', right: 'integration' }
const dump = (o: unknown) => yaml.dump(o, YAML_DUMP_OPTIONS)
const loadOut = (s: string) => yaml.load(s) as Record<string, any>

describe('YAML générique — schema.yaml', () => {
  const schema = {
    version: 1,
    nodes: [{
      name: 'root',
      label: 'Produit',
      objectTypes: [{
        name: 'exigence-systeme',
        prefix: 'SYS',
        fields: [{ name: 'priority', label: 'Priorité', type: 'enum' }, { name: 'statement', label: 'Énoncé', type: 'richtext' }],
        statuses: [{ name: 'draft', label: 'Brouillon' }],
      }],
    }],
  }
  const P = '.polenta/schema.yaml'
  const clone = () => JSON.parse(JSON.stringify(schema))

  it('M2 — status added on one side, field label changed on the other: no block', () => {
    const left = clone()
    left.nodes[0].objectTypes[0].statuses.push({ name: 'obsolete', label: 'Obsolète' })
    const right = clone()
    right.nodes[0].objectTypes[0].fields[0].label = 'Priorité métier'
    const m = mergeFile(dump(schema), dump(left), dump(right), labels, P)
    expect(m.kind).toBe('yaml')
    expect(m.blocks).toEqual([])
    const out = loadOut(m.output)
    expect(out.nodes[0].objectTypes[0].statuses.map((s: { name: string }) => s.name)).toEqual(['draft', 'obsolete'])
    expect(out.nodes[0].objectTypes[0].fields[0].label).toBe('Priorité métier')
  })

  it('M3 — same field label changed differently: one block keyed by pointer', () => {
    const left = clone()
    left.nodes[0].objectTypes[0].fields[0].label = 'A'
    const right = clone()
    right.nodes[0].objectTypes[0].fields[0].label = 'B'
    const m = mergeFile(dump(schema), dump(left), dump(right), labels, P)
    expect(m.blocks.map(b => b.key)).toEqual(['/nodes/@root/objectTypes/@exigence-systeme/fields/@priority/label'])
    expect(loadOut(resolveRegion(m.output, m.blocks[0].key, 'left')).nodes[0].objectTypes[0].fields[0].label).toBe('A')
  })
})

describe('YAML générique — listes', () => {
  const P = 'dashboards/main/dashboard.yaml'

  it('M4 — identified elements added on both sides: union, after their predecessor', () => {
    const base = { widgets: [{ id: 'a', title: 'A' }, { id: 'z', title: 'Z' }] }
    const left = { widgets: [{ id: 'a', title: 'A' }, { id: 'l', title: 'L' }, { id: 'z', title: 'Z' }] }
    const right = { widgets: [{ id: 'a', title: 'A' }, { id: 'z', title: 'Z' }, { id: 'r', title: 'R' }] }
    const m = mergeFile(dump(base), dump(left), dump(right), labels, P)
    expect(m.blocks).toEqual([])
    expect(loadOut(m.output).widgets.map((w: { id: string }) => w.id)).toEqual(['a', 'l', 'z', 'r'])
  })

  it('M5 — unique scalars added differently on each side: union', () => {
    const m = mergeFile(dump({ ids: ['A', 'B'] }), dump({ ids: ['A', 'B', 'L'] }), dump({ ids: ['A', 'R', 'B'] }), labels, 'x.yaml')
    expect(m.blocks).toEqual([])
    expect(loadOut(m.output).ids).toEqual(['A', 'R', 'B', 'L'])
  })

  it('M6 — unidentified elements changed at both ends merge (diff3)', () => {
    const base = { rows: [[1], [2], [3], [4]] }
    const m = mergeFile(dump(base), dump({ rows: [[0], [2], [3], [4]] }), dump({ rows: [[1], [2], [3], [5]] }), labels, 'x.yaml')
    expect(m.blocks).toEqual([])
    expect(loadOut(m.output).rows).toEqual([[0], [2], [3], [5]])
  })

  it('M7 — same unidentified element changed differently: one range block, valid once removed', () => {
    const base = { rows: [[1], [2], [3]] }
    const m = mergeFile(dump(base), dump({ rows: [[1], ['L'], [3]] }), dump({ rows: [[1], ['R'], [3]] }), labels, 'x.yaml')
    expect(m.blocks.map(b => b.key)).toEqual(['/rows/#1'])
    expect(m.blocks[0].left).toMatch(/^ {2}- - L/m)
    expect(parseOutput('yaml', m.output).error).toBeUndefined()
    expect(loadOut(resolveRegion(m.output, '/rows/#1', 'right')).rows).toEqual([[1], ['R'], [3]])
  })

  it('M19 — both sides reorder the same elements differently: an order block', () => {
    const base = { w: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
    const m = mergeFile(dump(base), dump({ w: [{ id: 'b' }, { id: 'a' }, { id: 'c' }] }), dump({ w: [{ id: 'a' }, { id: 'c' }, { id: 'b' }] }), labels, 'x.yaml')
    expect(m.blocks.map(b => b.key)).toEqual(['/w~order'])
    expect(loadOut(resolveRegion(m.output, '/w~order', 'left')).w.map((x: { id: string }) => x.id)).toEqual(['b', 'a', 'c'])
  })

  it('M20 — deep node removed on one side, changed on the other: block with an empty side', () => {
    const base = { a: { b: { c: 1, d: 2 } } }
    const m = mergeFile(dump(base), dump({ a: { b: { d: 2 } } }), dump({ a: { b: { c: 3, d: 2 } } }), labels, 'x.yaml')
    expect(m.blocks.map(b => b.key)).toEqual(['/a/b/c'])
    expect(m.blocks[0].left).toBeUndefined()
    expect(loadOut(resolveRegion(m.output, '/a/b/c', 'left'))).toEqual({ a: { b: { d: 2 } } })
  })

  it('a conflict on the first key of a list element leaves valid YAML, canonical once finalized', () => {
    const m = mergeFile(dump({ w: [{ t: 0, id: 'a' }] }), dump({ w: [{ t: 2, id: 'a' }] }), dump({ w: [{ t: 3, id: 'a' }] }), labels, 'x.yaml')
    expect(m.blocks.map(b => b.key)).toEqual(['/w/@a/t'])
    const resolved = resolveRegion(m.output, '/w/@a/t', 'left')
    expect(loadOut(resolved)).toEqual({ w: [{ t: 2, id: 'a' }] })
    expect(canonicalOutput('yaml', resolved, [dump({ w: [{ t: 2, id: 'a' }] })])).toBe(dump({ w: [{ t: 2, id: 'a' }] }))
  })
})

describe('Objets — étapes et campagnes', () => {
  const test = (steps: { action: string }[], extra: Record<string, unknown> = {}) => ({
    id: 'TEST-0001', objectTypeRef: 'root::test', title: 'T', status: 'draft', version: 1,
    steps: steps.map((s, i) => ({ order: i + 1, action: s.action, expectedResult: `ok ${s.action}`, notes: null })),
    ...extra,
  })
  const s = (...actions: string[]) => actions.map(action => ({ action }))

  it('M8 — step inserted on one side, another step changed on the other: merged, renumbered', () => {
    const m = mergeFile(dump(test(s('a', 'b', 'c', 'd'))), dump(test(s('a', 'NEW', 'b', 'c', 'd'))), dump(test(s('a', 'b', 'c', 'D'))), labels, 'tests/TEST-0001.yaml')
    expect(m.blocks).toEqual([])
    const steps = loadOut(m.output).steps
    expect(steps.map((x: { action: string }) => x.action)).toEqual(['a', 'NEW', 'b', 'c', 'D'])
    expect(steps.map((x: { order: number }) => x.order)).toEqual([1, 2, 3, 4, 5])
  })

  it('M9 — same step changed differently: one block steps~<n>, other steps merged', () => {
    // Adjacent changes conflict, as with git: the left change of step 0 is apart from step 2.
    const m = mergeFile(dump(test(s('a', 'b', 'c', 'd'))), dump(test(s('A', 'b', 'L', 'd'))), dump(test(s('a', 'b', 'R', 'd'))), labels, 'tests/TEST-0001.yaml')
    expect(m.blocks.map(b => b.key)).toEqual(['steps~2'])
    const out = canonicalOutput('object', resolveRegion(m.output, 'steps~2', 'right'))
    expect(loadOut(out).steps.map((x: { action: string; order: number }) => `${x.order}${x.action}`)).toEqual(['1A', '2b', '3R', '4d'])
  })

  const camp = (runs: Record<string, unknown>[]) => ({
    id: 'CAMP-0001', objectTypeRef: 'root::campagne', title: 'C', status: 'draft', testCaseIds: ['TEST-0001'], runs,
  })
  const run = (entryId: string, status = 'pending') => ({ entryId, testCaseId: 'TEST-0001', status })

  it('M10 — runs added on different entries: union, no block', () => {
    const m = mergeFile(dump(camp([run('E1')])), dump(camp([run('E1'), run('E2')])), dump(camp([run('E1'), run('E3')])), labels, 'campaigns/CAMP-0001.yaml')
    expect(m.blocks).toEqual([])
    expect(loadOut(m.output).runs.map((r: { entryId: string }) => r.entryId)).toEqual(['E1', 'E2', 'E3'])
  })

  it('M11 — same run changed differently: one block runs~<entryId>', () => {
    const m = mergeFile(dump(camp([run('E1'), run('E2')])), dump(camp([run('E1', 'PASS'), run('E2', 'PASS')])), dump(camp([run('E1', 'FAIL'), run('E2')])), labels, 'campaigns/CAMP-0001.yaml')
    expect(m.blocks.map(b => b.key)).toEqual(['runs~E1'])
    expect(loadOut(resolveRegion(m.output, 'runs~E1', 'right')).runs).toEqual([run('E1', 'FAIL'), run('E2', 'PASS')])
  })
})

describe('Arbres d\'affichage', () => {
  const P = '.polenta/trees/root/exigence-systeme.yaml'
  type N = { id: string; kind: string; objectId?: string; children: N[] }
  const leaf = (id: string): N => ({ id, kind: 'item', objectId: id.toUpperCase(), children: [] })
  const folder = (id: string, ...children: N[]): N => ({ id, kind: 'folder', children })
  const tree = (...root: N[]) => dump({ nodeId: 'root', typeId: 'exigence-systeme', root })
  const ids = (out: string) => JSON.stringify(loadOut(out).root, (k, v) => (k === 'kind' || k === 'objectId' ? undefined : v))

  it('M12 — two different nodes moved: no block, tree rebuilt', () => {
    const base = tree(folder('f1', leaf('a')), folder('f2', leaf('b')), leaf('c'))
    const left = tree(folder('f1'), folder('f2', leaf('b'), leaf('a')), leaf('c'))
    const right = tree(folder('f1', leaf('a'), leaf('c')), folder('f2', leaf('b')))
    const m = mergeFile(base, left, right, labels, P)
    expect(m.kind).toBe('trees')
    expect(m.blocks).toEqual([])
    expect(ids(m.output)).toBe(ids(tree(folder('f1', leaf('c')), folder('f2', leaf('b'), leaf('a')))))
  })

  it('M13 — same node moved under two parents: pos block, never duplicated nor lost', () => {
    const base = tree(folder('f1'), folder('f2'), leaf('a'))
    const m = mergeFile(base, tree(folder('f1', leaf('a')), folder('f2')), tree(folder('f1'), folder('f2', leaf('a'))), labels, P)
    expect([...new Set(m.blocks.map(b => b.key))]).toEqual(['pos:a'])
    expect(parseOutput('trees', m.output).unresolved).toEqual(['pos:a'])
    for (const side of ['left', 'right'] as const) {
      const out = resolveRegion(m.output, 'pos:a', side)
      expect(findRegions(out).regions).toEqual([])
      expect(ids(out).match(/"a"/g)).toHaveLength(1)
    }
    expect(ids(resolveRegion(m.output, 'pos:a', 'left'))).toBe(ids(tree(folder('f1', leaf('a')), folder('f2'))))
  })

  it('M14 — a cycle becomes one block on the whole list, resolved without cycle', () => {
    const base = tree(folder('A'), folder('B'))
    const m = mergeFile(base, tree(folder('B', folder('A'))), tree(folder('A', folder('B'))), labels, P)
    expect(m.blocks.map(b => b.key)).toEqual(['/root'])
    expect(ids(resolveRegion(m.output, '/root', 'right'))).toBe(ids(tree(folder('A', folder('B')))))
  })
})

describe('Style et repli texte', () => {
  it('M15 — a YAML with a comment is merged as text, comment kept', () => {
    const b = '# réglages\na: 1\nx: 0\nb: 2\n'
    const m = mergeFile(b, '# réglages\na: 10\nx: 0\nb: 2\n', '# réglages\na: 1\nx: 0\nb: 20\n', labels, 'config/x.yaml')
    expect(m.kind).toBe('text')
    expect(m.output).toBe('# réglages\na: 10\nx: 0\nb: 20\n')
  })

  it('M16 — a Suivi file (lineWidth -1) is merged structurally and written in its style', () => {
    const long = 'x'.repeat(150)
    const S = (o: unknown) => yaml.dump(o, { lineWidth: -1, noRefs: true })
    const base = { title: long, a: 1, b: 2 }
    const m = mergeFile(S(base), S({ ...base, a: 10 }), S({ ...base, b: 20 }), labels, 'queries/q/query.yaml')
    expect(m.kind).toBe('yaml')
    expect(m.output).toBe(S({ title: long, a: 10, b: 20 }))
  })

  it('two sides in different styles fall back to text', () => {
    const long = 'x'.repeat(150)
    expect(detectKind([yaml.dump({ t: long }, { lineWidth: 120 }), yaml.dump({ t: long }, { lineWidth: -1 })], 'a.yaml')).toBe('text')
  })
})

describe('.drawio par page', () => {
  const page = (id: string, body: string) => `  <diagram id="${id}" name="Page ${id}">\n    <mxGraphModel>${body}</mxGraphModel>\n  </diagram>`
  const file = (...pages: string[]) => `<mxfile host="app">\n${pages.join('\n')}\n</mxfile>\n`

  it('M17 — different pages changed: no block', () => {
    const m = mergeFile(file(page('p1', 'a'), page('p2', 'b')), file(page('p1', 'A'), page('p2', 'b')), file(page('p1', 'a'), page('p2', 'B')), labels, 'diagrams/x.drawio')
    expect(m.kind).toBe('drawio')
    expect(m.blocks).toEqual([])
    expect(m.output).toContain('<mxGraphModel>A</mxGraphModel>')
    expect(m.output).toContain('<mxGraphModel>B</mxGraphModel>')
  })

  it('M18 — same page changed on the same line: block page:<id> around the whole element', () => {
    const m = mergeFile(file(page('p1', 'a')), file(page('p1', 'L')), file(page('p1', 'R')), labels, 'diagrams/x.drawio')
    expect(m.blocks.map(b => b.key)).toEqual(['page:p1'])
    const out = resolveRegion(m.output, 'page:p1', 'left')
    expect(out).toContain('<mxGraphModel>L</mxGraphModel>')
    expect(out).toMatch(/^<mxfile host="app">\n[\s\S]*<\/diagram>\n<\/mxfile>\n$/)
  })

  it('a page removed on one side and unchanged on the other is removed', () => {
    const m = mergeFile(file(page('p1', 'a'), page('p2', 'b')), file(page('p1', 'a')), file(page('p1', 'a'), page('p2', 'b')), labels, 'diagrams/x.drawio')
    expect(m.blocks).toEqual([])
    expect(m.output).not.toContain('p2')
  })
})

describe('Édition et choix', () => {
  it('M21 — updateOutputAt on a deep path keeps the open regions', () => {
    const base = { a: { x: 1, y: 1 }, list: [{ id: 'k', v: 1 }, { id: 'm', v: 1 }] }
    const m = mergeFile(dump(base), dump({ ...base, a: { x: 2, y: 1 }, list: [{ id: 'k', v: 2 }, { id: 'm', v: 1 }] }),
      dump({ ...base, a: { x: 3, y: 1 }, list: [{ id: 'k', v: 3 }, { id: 'm', v: 1 }] }), labels, 'x.yaml')
    expect(m.blocks.map(b => b.key).sort()).toEqual(['/a/x', '/list/@k/v'])
    const out = updateOutputAt(m.output, ['list', 1, 'v'], 9)!
    expect(out).not.toBeNull()
    expect(findRegions(out).regions.map(r => r.key).sort()).toEqual(['/a/x', '/list/@k/v'])
    const done = resolveAllRegions(out, 'left')
    expect(loadOut(done)).toEqual({ a: { x: 2, y: 1 }, list: [{ id: 'k', v: 2 }, { id: 'm', v: 9 }] })
  })

  it('M22 — take both: list elements, multi-line text; not a scalar', () => {
    const items = mergeFile(dump({ rows: [[1]] }), dump({ rows: [['L']] }), dump({ rows: [['R']] }), labels, 'x.yaml')
    const key = items.blocks[0].key
    expect(canTakeBoth(items.output, key)).toBe(true)
    expect(loadOut(resolveRegionBoth(items.output, key)).rows).toEqual([['L'], ['R']])

    const text = mergeFile(dump({ d: 'a\nb\n' }), dump({ d: 'a\nL\n' }), dump({ d: 'a\nR\n' }), labels, 'x.yaml')
    expect(canTakeBoth(text.output, '/d')).toBe(true)
    expect(loadOut(resolveRegionBoth(text.output, '/d')).d).toBe('a\nL\na\nR\n')

    const scalar = mergeFile(dump({ n: 1 }), dump({ n: 2 }), dump({ n: 3 }), labels, 'x.yaml')
    expect(canTakeBoth(scalar.output, '/n')).toBe(false)
    expect(resolveRegionBoth(scalar.output, '/n')).toBe(scalar.output)
  })

  it('M24 — identities with / ~ ] are escaped in block keys and markers read back', () => {
    expect(pointer([{ k: 'a/b' }, { id: 'x~]' }, { k: '@at' }, { i: 2 }])).toBe('/a~1b/@x~0~2/~3at/#2')
    const base = { w: [{ id: 'p/q]', v: 1 }] }
    const m = mergeFile(dump(base), dump({ w: [{ id: 'p/q]', v: 2 }] }), dump({ w: [{ id: 'p/q]', v: 3 }] }), labels, 'x.yaml')
    expect(m.blocks.map(b => b.key)).toEqual(['/w/@p~1q~2/v'])
    expect(parseOutput('yaml', m.output).unresolved).toEqual(['/w/@p~1q~2/v'])
  })
})

describe('diffTree', () => {
  it('M23 — added / removed / modified / moved, changed counts', () => {
    const before = { t: 'x', gone: 1, list: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }], f: { root: [{ id: 'n', children: [] }] } }
    const after = { t: 'y', added: 2, list: [{ id: 'a', v: 2 }, { id: 'b', v: 1 }], f: { root: [{ id: 'g', children: [{ id: 'n', children: [] }] }] } }
    const root = diffTree(before, after)
    const by = (k: string) => {
      const find = (n: typeof root): typeof root | undefined => (n.key === k ? n : n.children?.map(find).find(Boolean))
      return find(root)!
    }
    expect(by('/t').state).toBe('modified')
    expect(by('/gone').state).toBe('removed')
    expect(by('/added').state).toBe('added')
    expect(by('/list/@a').state).toBe('modified')
    expect(by('/list/@b').state).toBe('unchanged')
    expect(by('/list').changedCount).toBe(1)
    expect(by('/f/root/@n').state).toBe('moved')
    expect(by('/f/root/@g/children/@n').movedPeer).toBe('/f/root/@n')
  })

  it('steps aligned ignoring order: an inserted step is the only change', () => {
    const steps = (...a: string[]) => a.map((action, i) => ({ order: i + 1, action }))
    const root = diffTree({ steps: steps('a', 'b') }, { steps: steps('a', 'new', 'b') }, {
      dump: YAML_DUMP_OPTIONS, isAtomic: () => false, blockKey: pointer,
      listRule: () => ({ lcs: true, ignore: ['order'] }),
    })
    const states = root.children![0].children!.map(c => c.state)
    expect(states).toEqual(['unchanged', 'added', 'unchanged'])
  })
})

describe('Revue de code — non-régressions', () => {
  const P = '.polenta/trees/root/exigence-systeme.yaml'
  type N = { id: string; kind: string; label?: string; children: N[] }
  const folder = (id: string, ...children: N[]): N => ({ id, kind: 'folder', children })
  const tree = (...root: N[]) => dump({ nodeId: 'root', typeId: 't', root })

  it('tree: a node moved under a folder deleted by the other side lands at the root, never lost', () => {
    const base = tree(folder('A', folder('X')), folder('B'), folder('C'))
    const left = tree(folder('A'), folder('B', folder('X')), folder('C'))
    const right = tree(folder('A'), folder('C', folder('X')))
    const m = mergeFile(base, left, right, labels, P)
    for (const side of ['left', 'right'] as const) {
      const out = resolveAllRegions(m.output, side)
      expect(JSON.stringify(loadOut(out).root).match(/"X"/g)).toHaveLength(1)
    }
  })

  it('tree: a node deleted on one side and edited on the other is a block', () => {
    const base = tree({ ...folder('F'), label: 'Old' }, folder('G'))
    const m = mergeFile(base, tree(folder('G')), tree({ ...folder('F'), label: 'New' }, folder('G')), labels, P)
    expect(m.blocks.map(b => b.key)).toEqual(['pos:F'])
    expect(loadOut(resolveRegion(m.output, 'pos:F', 'right')).root[0].label).toBe('New')
    expect(loadOut(resolveRegion(m.output, 'pos:F', 'left')).root.map((n: N) => n.id)).toEqual(['G'])
  })

  it('take both is refused when both sides hold the same identified element', () => {
    const camp = (status: string) => dump({ id: 'CAMP-0001', objectTypeRef: 'root::c', title: 'C', status: 'draft', runs: [{ entryId: 'E1', status }] })
    const m = mergeFile(camp('pending'), camp('PASS'), camp('FAIL'), labels, 'campaigns/CAMP-0001.yaml')
    expect(canTakeBoth(m.output, 'runs~E1')).toBe(false)
  })

  it('drawio: a self-closing page does not swallow the next one', async () => {
    const { parseDrawio } = await import('./index')
    const f = parseDrawio('<mxfile>\n  <diagram id="a" name="P1"/>\n  <diagram id="b" name="P2"><x/></diagram>\n</mxfile>\n')!
    expect(f.pages.map(p => p.id)).toEqual(['a', 'b'])
  })

  it('diffTree: rows of an aligned list have unique keys', () => {
    const root = diffTree({ l: [['x'], ['y']] }, { l: [['y']] })
    const keys = root.children![0].children!.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('diffTree: equal identities in unrelated lists are not a move', () => {
    const root = diffTree({ a: { values: ['high'] }, b: { values: [] } }, { a: { values: [] }, b: { values: ['high'] } })
    const states: string[] = []
    const walk = (n: typeof root) => { states.push(n.state); n.children?.forEach(walk) }
    walk(root)
    expect(states).not.toContain('moved')
  })

  it('canonicalOutput keeps a resolved text verbatim when nothing requires a rewrite', () => {
    const text = 'id: SYS-0001\nobjectTypeRef: root::x\n# note\ntitle: T\n'
    expect(canonicalOutput('object', text)).toBe(text)
  })
})
