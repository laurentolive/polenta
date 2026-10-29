import yaml from 'js-yaml'

type Obj = Record<string, unknown>

/** Same options as `GitService.writeYaml` — a merged object is written exactly like any save. */
export const YAML_DUMP_OPTIONS: yaml.DumpOptions = { lineWidth: 120 }

/** Keys in output order: the first object's order, then keys only in the next ones. */
export function orderedKeys(...objs: Obj[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const o of objs) for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); out.push(k) }
  return out
}

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

/** `at` of a history entry as ISO text (an unquoted timestamp edited by hand is loaded as a Date). */
function entryTime(e: Obj): string {
  const at = e.at
  return at instanceof Date ? at.toISOString().replace(/\.\d{3}Z$/, 'Z') : String(at ?? '')
}

function canonicalEntry(e: Obj): string {
  const value = e.value instanceof Date ? e.value.toISOString() : e.value ?? null
  return JSON.stringify([entryTime(e), e.by ?? null, value, e.source ?? null])
}

/**
 * GH77 — union of two `history` mappings (spec §8): for each key, the entries of both sides,
 * deduplicated on (at, by, value, source) and sorted by `at` (stable: left before right on a tie).
 * Never a conflict. A side that is not a mapping counts as empty.
 */
export function mergeHistories(left: unknown, right: unknown): Obj | undefined {
  const sides = [right, left].filter(isPlainObject)
  if (sides.length === 0) return undefined
  const out: Obj = {}
  // Keys in the destination's (right) order, like every other unit.
  for (const key of orderedKeys(...sides)) {
    const seen = new Set<string>()
    const entries: Obj[] = []
    for (const side of [left, right]) {
      const list = isPlainObject(side) ? side[key] : undefined
      if (!Array.isArray(list)) continue
      for (const e of list) {
        if (!isPlainObject(e)) continue
        const id = canonicalEntry(e)
        if (seen.has(id)) continue
        seen.add(id)
        entries.push(e)
      }
    }
    entries.sort((a, b) => {
      const ta = entryTime(a)
      const tb = entryTime(b)
      return ta < tb ? -1 : ta > tb ? 1 : 0
    })
    out[key] = entries
  }
  return out
}
