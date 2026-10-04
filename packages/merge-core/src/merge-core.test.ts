import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import {
  detectKind, isBinaryContent, mergeFile, parseOutput, resolveAllRegions, resolveRegion, YAML_DUMP_OPTIONS,
} from './index'

const labels = { left: 'dev-x', right: 'integration' }
const dump = (o: unknown) => yaml.dump(o, YAML_DUMP_OPTIONS)

const base = {
  id: 'SYS-0012',
  objectTypeRef: 'root::exigence-systeme',
  title: 'Démarrage rapide',
  status: 'draft',
  version: 1,
  fields: { priority: 'medium', statement: 'WHEN on\nTHE system SHALL start' },
}
const withFields = (o: typeof base, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ ...o, ...extra, fields: { ...o.fields, ...fields } })

describe('mergeObject (field level)', () => {
  it('U1 — disjoint fields are merged without block', () => {
    const left = withFields(base, { priority: 'high' })
    const right = withFields(base, { statement: 'WHEN on\nTHE system SHALL start in 500 ms' })
    const m = mergeFile(dump(base), dump(left), dump(right), labels)
    expect(m.kind).toBe('object')
    expect(m.blocks).toEqual([])
    expect(yaml.load(m.output)).toEqual(withFields(base, { priority: 'high', statement: right.fields.statement }))
    expect(m.auto).toEqual(expect.arrayContaining([
      { key: 'fields.priority', from: 'left' },
      { key: 'fields.statement', from: 'right' },
    ]))
  })

  it('U2 — same field changed differently gives one named region', () => {
    const left = withFields(base, { statement: 'WHEN on\nTHE system SHALL start in 1 s' })
    const right = withFields(base, { statement: 'WHEN on\nTHE system SHALL start in 500 ms' })
    const m = mergeFile(dump(base), dump(left), dump(right), labels)
    expect(m.blocks.map(b => b.key)).toEqual(['fields.statement'])
    expect(m.output).toContain('<<<<<<< dev-x [fields.statement]')
    expect(m.output).toContain('>>>>>>> integration [fields.statement]')
    expect(parseOutput('object', m.output)).toMatchObject({ unresolved: ['fields.statement'] })
  })

  it('U3 — identical change on both sides is not a conflict', () => {
    const both = withFields(base, { priority: 'low' })
    const m = mergeFile(dump(base), dump(both), dump(both), labels)
    expect(m.blocks).toEqual([])
    expect(m.auto).toContainEqual({ key: 'fields.priority', from: 'both' })
  })

  it('U4 — version takes the max', () => {
    const m = mergeFile(dump(base), dump({ ...base, version: 2 }), dump({ ...base, version: 3 }), labels)
    expect(m.blocks).toEqual([])
    expect((yaml.load(m.output) as typeof base).version).toBe(3)
  })

  it('U5 — needsRevalidation set on one side is kept', () => {
    const left = { ...base, version: 2, needsRevalidation: true }
    const right = { ...base, version: 2, title: 'Autre titre' }
    const m = mergeFile(dump(base), dump(left), dump(right), labels)
    expect(m.blocks).toEqual([])
    expect(yaml.load(m.output)).toMatchObject({ needsRevalidation: true, title: 'Autre titre' })
  })

  it('U6 — added on both sides: every differing unit is a block', () => {
    const left = { ...base, title: 'A' }
    const right = { ...base, title: 'B', fields: { ...base.fields, priority: 'high' } }
    const m = mergeFile(null, dump(left), dump(right), labels)
    expect(m.kind).toBe('object')
    expect(m.blocks.map(b => b.key).sort()).toEqual(['fields.priority', 'title'])
  })

  it('U7 — parseOutput with two open regions returns the rest as value', () => {
    const left = { ...base, title: 'A', fields: { ...base.fields, priority: 'high' } }
    const right = { ...base, title: 'B', fields: { ...base.fields, priority: 'low' } }
    const m = mergeFile(dump(base), dump(left), dump(right), labels)
    const p = parseOutput('object', m.output)
    expect(p.error).toBeUndefined()
    expect(p.unresolved.sort()).toEqual(['fields.priority', 'title'])
    expect(p.value).toMatchObject({ id: 'SYS-0012', fields: { statement: base.fields.statement } })
  })

  it('U8 — resolveRegion keeps the chosen fragment at the right indentation', () => {
    const left = withFields(base, { priority: 'high' })
    const right = withFields(base, { priority: 'low' })
    const m = mergeFile(dump(base), dump(left), dump(right), labels)
    const out = resolveRegion(m.output, 'fields.priority', 'left')
    const p = parseOutput('object', out)
    expect(p).toMatchObject({ unresolved: [] })
    expect(p.value).toEqual(left)
  })

  it('U9 — a fully resolved output is the canonical writeYaml dump', () => {
    const left = withFields(base, { priority: 'high' }, { title: 'A' })
    const right = withFields(base, { priority: 'low' }, { title: 'B' })
    const m = mergeFile(dump(base), dump(left), dump(right), labels)
    expect(resolveAllRegions(m.output, 'right')).toBe(dump(right))
  })

  it('U13 — multi-line richtext field in conflict is a whole region', () => {
    const left = withFields(base, { statement: '<p>ligne 1</p>\n<p>ligne 2 gauche</p>\n' })
    const right = withFields(base, { statement: '<p>ligne 1</p>\n<p>ligne 2 droite</p>\n' })
    const m = mergeFile(dump(base), dump(left), dump(right), labels)
    expect(m.blocks).toHaveLength(1)
    expect(m.blocks[0].left).toContain('ligne 2 gauche')
    expect(m.blocks[0].left).toContain('statement: |')
    const p = parseOutput('object', m.output)
    expect(p.error).toBeUndefined()
    expect(parseOutput('object', resolveRegion(m.output, 'fields.statement', 'right')).value).toEqual(right)
  })

  it('deleted field on one side is taken', () => {
    const left = { ...base, fields: { statement: base.fields.statement } }
    const m = mergeFile(dump(base), dump(left), dump(withFields(base, {}, { title: 'B' })), labels)
    expect(m.blocks).toEqual([])
    expect((yaml.load(m.output) as typeof base).fields).toEqual({ statement: base.fields.statement })
  })

  it('field removed on one side and changed on the other is a block with an empty side', () => {
    const left = { ...base, fields: { statement: base.fields.statement } }
    const right = withFields(base, { priority: 'high' })
    const m = mergeFile(dump(base), dump(left), dump(right), labels)
    expect(m.blocks).toHaveLength(1)
    expect(m.blocks[0].left).toBeUndefined()
    expect(parseOutput('object', resolveRegion(m.output, 'fields.priority', 'left')).value).toEqual(left)
  })
})

describe('mergeText (line level)', () => {
  it('U10 — disjoint lines merge cleanly', () => {
    const b = 'a\nb\nc\nd\ne\n'
    const m = mergeFile(b, 'A\nb\nc\nd\ne\n', 'a\nb\nc\nd\nE\n', labels)
    expect(m.kind).toBe('text')
    expect(m.blocks).toEqual([])
    expect(m.output).toBe('A\nb\nc\nd\nE\n')
  })

  it('U11 — same line changed on both sides is hunk:0', () => {
    const m = mergeFile('a\nb\nc\n', 'a\nB1\nc\n', 'a\nB2\nc\n', labels)
    expect(m.blocks.map(b => b.key)).toEqual(['hunk:0'])
    expect(resolveRegion(m.output, 'hunk:0', 'right')).toBe('a\nB2\nc\n')
    expect(parseOutput('text', m.output).unresolved).toEqual(['hunk:0'])
  })

  it('a last line without line break still yields well-formed regions', () => {
    const m = mergeFile('a\nb', 'a\nB1', 'a\nB2', labels)
    expect(parseOutput('text', m.output).error).toBeUndefined()
    expect(resolveRegion(m.output, 'hunk:0', 'left')).toBe('a\nB1\n')
  })
})

describe('kinds and markers', () => {
  it('U12 — NUL byte means binary', () => {
    expect(isBinaryContent(new Uint8Array([137, 80, 78, 71, 0, 1]))).toBe(true)
    expect(isBinaryContent(new TextEncoder().encode('id: SYS-0001\n'))).toBe(false)
  })

  it('detectKind needs id + objectTypeRef on every side present', () => {
    expect(detectKind([dump(base), null])).toBe('object')
    expect(detectKind([dump(base), 'links: []\n'])).toBe('text')
  })

  it('stray or half-deleted markers are reported, not parsed', () => {
    const m = mergeFile('a\nb\nc\n', 'a\nB1\nc\n', 'a\nB2\nc\n', labels)
    const broken = m.output.replace(/^=======\n/m, '')
    expect(parseOutput('text', broken).error).toBeDefined()
  })

  it('invalid YAML outside the regions is an error, not an exception', () => {
    expect(parseOutput('object', 'id: [unclosed\n').error).toBeDefined()
  })
})

describe('changedLineIndexes', () => {
  it('flags added and changed lines only', async () => {
    const { changedLineIndexes } = await import('./index')
    expect([...changedLineIndexes('a\nb\nc', 'a\nB\nc\nd')!]).toEqual([1, 3])
    expect([...changedLineIndexes(null, 'x\ny')!]).toEqual([0, 1])
  })
})

describe('Rendu helpers (units)', () => {
  const twoConflicts = () => {
    const left = { ...base, title: 'A', fields: { ...base.fields, priority: 'high' } }
    const right = { ...base, title: 'B', fields: { ...base.fields, priority: 'low' } }
    return { left, right, m: mergeFile(dump(base), dump(left), dump(right), labels) }
  }

  it('U14 — invalid YAML outside the regions gives an error, never throws', async () => {
    const { m } = twoConflicts()
    const broken = m.output.replace('status: draft', 'status: [draft')
    expect(parseOutput('object', broken).error).toBeDefined()
    const { updateObjectOutput } = await import('./index')
    expect(updateObjectOutput(broken, 'version', 2)).toBeNull()
  })

  it('updateObjectOutput edits a resolved unit and keeps the open regions verbatim', async () => {
    const { updateObjectOutput, regionFragments } = await import('./index')
    const { m } = twoConflicts()
    const before = regionFragments(m.output)
    const out = updateObjectOutput(m.output, 'fields.statement', 'THE system SHALL do X')!
    expect(regionFragments(out)).toEqual(before)
    const p = parseOutput('object', out)
    expect(p.unresolved.sort()).toEqual(['fields.priority', 'title'])
    expect((p.value as typeof base).fields.statement).toBe('THE system SHALL do X')
    // Resolving everything afterwards still gives a valid object.
    expect(parseOutput('object', resolveAllRegions(out, 'left')).value).toMatchObject({ title: 'A', fields: { priority: 'high' } })
  })

  it('fragmentValue reads the value of an indented fragment', async () => {
    const { fragmentValue, regionFragments } = await import('./index')
    const { m } = twoConflicts()
    const f = regionFragments(m.output).get('fields.priority')!
    expect(fragmentValue(f.left)).toBe('high')
    expect(fragmentValue(f.right)).toBe('low')
    expect(fragmentValue('')).toBeUndefined()
  })

  it('changedUnits lists the units a side changed', async () => {
    const { changedUnits } = await import('./index')
    expect([...changedUnits(base, withFields(base, { priority: 'high' }, { title: 'X' }))].sort()).toEqual(['fields.priority', 'title'])
  })

  it('unitAnchors finds root keys, fields and regions', async () => {
    const { unitAnchors } = await import('./index')
    const { m } = twoConflicts()
    const keys = unitAnchors(m.output).map(a => a.key)
    expect(keys).toEqual(expect.arrayContaining(['id', 'title', 'fields', 'fields.priority', 'fields.statement']))
  })
})
