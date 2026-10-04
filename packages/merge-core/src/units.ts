import yaml from 'js-yaml'
import { findRegions, splitLines } from './markers'
import { deepEqual, isPlainObject, YAML_DUMP_OPTIONS } from './object'

/**
 * GH37 sprint 2 — helpers of the "Rendu" mode, which works on the units of a typed object (root
 * keys other than `fields`, plus `fields.<name>`) rather than on lines.
 */

type Obj = Record<string, unknown>

const FIELD_PREFIX = 'fields.'

export function unitValue(o: Obj | null | undefined, unit: string): unknown {
  if (!o) return undefined
  if (!unit.startsWith(FIELD_PREFIX)) return o[unit]
  const fields = o.fields
  return isPlainObject(fields) ? fields[unit.slice(FIELD_PREFIX.length)] : undefined
}

/** Units of `side` that differ from `base` (`base` null = everything present is new). */
export function changedUnits(base: Obj | null, side: Obj): Set<string> {
  const keys = new Set<string>()
  const units = (o: Obj | null) => {
    if (!o) return
    for (const k of Object.keys(o)) {
      if (k !== 'fields') keys.add(k)
      else if (isPlainObject(o.fields)) for (const f of Object.keys(o.fields)) keys.add(FIELD_PREFIX + f)
    }
  }
  units(base)
  units(side)
  const changed = new Set<string>()
  for (const k of keys) if (!deepEqual(unitValue(base, k), unitValue(side, k))) changed.add(k)
  return changed
}

/** Left/right fragments of every open region of `text`, by key. */
export function regionFragments(text: string): Map<string, { left: string; right: string }> {
  const { regions, error } = findRegions(text)
  const out = new Map<string, { left: string; right: string }>()
  if (error) return out
  const lines = splitLines(text)
  for (const r of regions) {
    out.set(r.key, {
      left: lines.slice(r.start + 1, r.sep).join('\n'),
      right: lines.slice(r.sep + 1, r.end).join('\n'),
    })
  }
  return out
}

/**
 * Value of a fragment `<name>: <value>` (as found in a region, indented), `undefined` when the
 * fragment is empty (unit absent on that side) or unreadable.
 */
export function fragmentValue(fragment: string): unknown {
  if (fragment.trim() === '') return undefined
  const lines = fragment.split('\n')
  const indent = Math.min(...lines.filter(l => l.trim() !== '').map(l => l.length - l.trimStart().length))
  try {
    const v = yaml.load(lines.map(l => l.slice(indent)).join('\n'))
    if (!isPlainObject(v)) return undefined
    const keys = Object.keys(v)
    return keys.length === 1 ? v[keys[0]] : undefined
  } catch {
    return undefined
  }
}

const REGION_PLACEHOLDER = (i: number) => `__polenta_region_${i}__`
const REGION_PLACEHOLDER_LINE = /^ *__polenta_region_(\d+)__: null$/

/**
 * Sets (or removes, with `undefined`) one resolved unit of an object output **without touching
 * its open regions** — the form edit of the "Rendu" mode. Each region is swapped for a placeholder
 * key at its indentation, the YAML is loaded, changed and dumped again (canonical `writeYaml`
 * format), and the regions are put back verbatim. `null` when the text outside the regions is
 * not valid YAML (the caller keeps the text as is).
 */
export function updateObjectOutput(text: string, unit: string, value: unknown): string | null {
  const { regions, error } = findRegions(text)
  if (error) return null
  const lines = splitLines(text)
  const regionText: string[] = []
  const out: string[] = []
  let r = 0
  for (let i = 0; i < lines.length; i++) {
    const region = regions[r]
    if (region && i === region.start) {
      const body = [...lines.slice(region.start + 1, region.sep), ...lines.slice(region.sep + 1, region.end)]
      const first = body.find(l => l.trim() !== '') ?? ''
      const indent = first.length - first.trimStart().length
      out.push(`${' '.repeat(indent)}${REGION_PLACEHOLDER(regionText.length)}: null`)
      regionText.push(lines.slice(region.start, region.end + 1).join('\n'))
      i = region.end
      r++
      continue
    }
    out.push(lines[i])
  }

  let obj: unknown
  try {
    obj = yaml.load(out.join('\n'))
  } catch {
    return null
  }
  if (!isPlainObject(obj)) return null

  if (unit.startsWith(FIELD_PREFIX)) {
    const name = unit.slice(FIELD_PREFIX.length)
    if (!isPlainObject(obj.fields)) obj.fields = {}
    const fields = obj.fields as Obj
    if (value === undefined) delete fields[name]
    else fields[name] = value
  } else if (value === undefined) {
    delete obj[unit]
  } else {
    obj[unit] = value
  }

  return yaml
    .dump(obj, YAML_DUMP_OPTIONS)
    .split('\n')
    .map(line => {
      const m = REGION_PLACEHOLDER_LINE.exec(line)
      return m ? regionText[Number(m[1])] : line
    })
    .join('\n')
}

/**
 * Line (0-based) where each unit of an object file starts — `title` at `title: …`,
 * `fields.statement` at `  statement: …` under `fields:`, an open region at its start marker.
 * Used to keep the panes scrolled on the same unit. Empty for a text that is not an object.
 */
export function unitAnchors(text: string): { key: string; line: number }[] {
  const anchors: { key: string; line: number }[] = []
  const lines = splitLines(text)
  let inFields = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const region = /^<{7} .*\[([^\]]+)\]\r?$/.exec(line)
    if (region) { anchors.push({ key: region[1], line: i }); continue }
    const top = /^([^\s#<=>-][^:]*):/.exec(line)
    if (top) {
      inFields = top[1] === 'fields'
      anchors.push({ key: top[1], line: i })
      continue
    }
    const field = inFields ? /^ {2}([^\s#][^:]*):/.exec(line) : null
    if (field) anchors.push({ key: FIELD_PREFIX + field[1], line: i })
  }
  return anchors
}
