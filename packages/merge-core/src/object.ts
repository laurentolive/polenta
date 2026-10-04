import yaml from 'js-yaml'
import { renderRegion } from './markers'
import type { FileMerge, MarkerLabels, MergeBlock, Side } from './types'

type Obj = Record<string, unknown>

/** Same options as `GitService.writeYaml` — a merged object is written exactly like any save. */
export const YAML_DUMP_OPTIONS: yaml.DumpOptions = { lineWidth: 120 }

const FIELDS = 'fields'
const FIELD_PREFIX = 'fields.'
const PLACEHOLDER = (i: number) => `__POLENTA_MERGE_${i}__`
const PLACEHOLDER_LINE = /^( *)\S.*: __POLENTA_MERGE_(\d+)__$/

export function isPlainObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter(k => a[k] !== undefined)
    const kb = Object.keys(b).filter(k => b[k] !== undefined)
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]))
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  return false
}

/** Parses a typed object file (exigence, test, campagne…): YAML mapping with string `id` and `objectTypeRef`. */
export function parseObject(text: string): Obj | null {
  try {
    const v = yaml.load(text)
    return isPlainObject(v) && typeof v.id === 'string' && typeof v.objectTypeRef === 'string' ? v : null
  } catch {
    return null
  }
}

function fieldsOf(o: Obj | null): Obj {
  return o && isPlainObject(o[FIELDS]) ? (o[FIELDS] as Obj) : {}
}

function unitValue(o: Obj | null, unit: string): unknown {
  if (!o) return undefined
  return unit.startsWith(FIELD_PREFIX) ? fieldsOf(o)[unit.slice(FIELD_PREFIX.length)] : o[unit]
}

/** Keys in output order: right's order first (the destination's layout), then left-only keys. */
function orderedKeys(...objs: Obj[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const o of objs) for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); out.push(k) }
  return out
}

export type UnitResult =
  | { conflict: false; value: unknown; from?: Side | 'both' }
  | { conflict: true; left: unknown; right: unknown }

export function mergeUnit(unit: string, b: unknown, l: unknown, r: unknown): UnitResult {
  if (deepEqual(l, r)) return { conflict: false, value: l, from: deepEqual(l, b) ? undefined : 'both' }
  if (deepEqual(l, b)) return { conflict: false, value: r, from: 'right' }
  if (deepEqual(r, b)) return { conflict: false, value: l, from: 'left' }
  // Both sides changed differently — two fields are reconciled without asking: `version` only
  // ever grows (each save bumps it), `needsRevalidation` is written only when true (T172) and
  // an impact still to check on either side must not be lost.
  if (unit === 'version' && typeof l === 'number' && typeof r === 'number') {
    return { conflict: false, value: Math.max(l, r), from: l > r ? 'left' : 'right' }
  }
  if (unit === 'needsRevalidation') {
    return { conflict: false, value: l === true || r === true ? true : undefined, from: l === true ? 'left' : 'right' }
  }
  return { conflict: true, left: l, right: r }
}

/** YAML fragment `<name>: <value>` indented by `indent`, as it appears inside the dumped object. */
function fragment(name: string, value: unknown, indent: string): string | undefined {
  if (value === undefined) return undefined
  return yaml
    .dump({ [name]: value }, YAML_DUMP_OPTIONS)
    .split('\n')
    .map(line => (line === '' ? line : indent + line))
    .join('\n')
}

/**
 * Field-level 3-way merge of a typed object (GH37 design §2.1). Units are the root keys other
 * than `fields`, plus each `fields.<name>`; a unit changed on one side only (or identically on
 * both) is taken without asking, a unit changed differently on both sides is a block.
 */
export function mergeObject(base: Obj | null, left: Obj, right: Obj, labels: MarkerLabels): FileMerge {
  const results = new Map<string, UnitResult>()
  const merge = (unit: string) => {
    const r = mergeUnit(unit, unitValue(base, unit), unitValue(left, unit), unitValue(right, unit))
    results.set(unit, r)
    return r
  }

  const blocks: MergeBlock[] = []
  const pending: { unit: string; name: string; left: unknown; right: unknown }[] = []
  const place = (target: Obj, name: string, unit: string) => {
    const r = merge(unit)
    if (!r.conflict) {
      if (r.value !== undefined) target[name] = r.value
      return
    }
    target[name] = PLACEHOLDER(pending.length)
    pending.push({ unit, name, left: r.left, right: r.right })
  }

  const out: Obj = {}
  for (const key of orderedKeys(right, left, base ?? {})) {
    if (key !== FIELDS) {
      place(out, key, key)
      continue
    }
    const fields: Obj = {}
    for (const name of orderedKeys(fieldsOf(right), fieldsOf(left), fieldsOf(base))) {
      place(fields, name, FIELD_PREFIX + name)
    }
    const anySide = [right, left].some(o => FIELDS in o)
    if (anySide) out[FIELDS] = fields
  }

  const dumped = yaml.dump(out, YAML_DUMP_OPTIONS)
  const output = dumped
    .split('\n')
    .map(line => {
      const m = PLACEHOLDER_LINE.exec(line)
      if (!m) return line
      const p = pending[Number(m[2])]
      const indent = m[1]
      const block: MergeBlock = {
        key: p.unit,
        left: fragment(p.name, p.left, indent),
        right: fragment(p.name, p.right, indent),
      }
      blocks.push(block)
      // `renderRegion` ends with a line break, and this line is joined back with one: drop it.
      return renderRegion(block.key, block.left, block.right, labels).replace(/\n$/, '')
    })
    .join('\n')

  const auto: FileMerge['auto'] = []
  for (const [key, r] of results) if (!r.conflict && r.from) auto.push({ key, from: r.from })

  return { kind: 'object', output, blocks, auto }
}
