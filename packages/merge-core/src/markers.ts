import yaml from 'js-yaml'
import type { MarkerLabels, Side } from './types'

/**
 * Conflict marker regions (GH37 design §2.1). A block that is not resolved yet lives in the
 * output text as
 *
 *     <<<<<<< <left label> [<key>]
 *     …left fragment…
 *     =======
 *     …right fragment…
 *     >>>>>>> <right label> [<key>]
 *
 * The key names the block, so a region can be found again after the user edited the text
 * around it. A fragment is always a whole YAML entry (or a whole text hunk), so removing a
 * region leaves the rest of an object file valid YAML.
 */

const START = /^<{7} .*\[([^\]]+)\]\r?$/
const SEP = /^={7}\r?$/
const END = /^>{7} .*\[([^\]]+)\]\r?$/
/** Any line that looks like a marker — used to reject stray/half-deleted markers. */
const ANY_MARKER = /^(<{7}|={7}|>{7})( |\r?$)/

export interface MarkerRegion {
  key: string
  /** Line indexes (0-based) of the start marker, the separator and the end marker. */
  start: number
  sep: number
  end: number
}

export function splitLines(text: string): string[] {
  return text.split('\n')
}

/** Ensures a non-empty fragment ends with a newline, so the next marker starts its own line. */
export function asFragment(text: string): string {
  return text === '' || text.endsWith('\n') ? text : `${text}\n`
}

export function renderRegion(key: string, left: string | undefined, right: string | undefined, labels: MarkerLabels): string {
  return (
    `<<<<<<< ${labels.left} [${key}]\n` +
    asFragment(left ?? '') +
    '=======\n' +
    asFragment(right ?? '') +
    `>>>>>>> ${labels.right} [${key}]\n`
  )
}

/** Finds every region of `text`; `error` when a marker is stray, unterminated or mismatched. */
export function findRegions(text: string): { regions: MarkerRegion[]; error?: string } {
  const lines = splitLines(text)
  const regions: MarkerRegion[] = []
  let open: { key: string; start: number; sep: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!ANY_MARKER.test(line)) continue
    const start = START.exec(line)
    const end = END.exec(line)
    if (start) {
      if (open) return { regions, error: `line ${i + 1}: conflict region opened inside another one` }
      open = { key: start[1], start: i, sep: -1 }
    } else if (SEP.test(line)) {
      if (!open || open.sep !== -1) return { regions, error: `line ${i + 1}: unexpected conflict separator` }
      open.sep = i
    } else if (end) {
      if (!open || open.sep === -1 || end[1] !== open.key) {
        return { regions, error: `line ${i + 1}: unexpected end of conflict region` }
      }
      regions.push({ key: open.key, start: open.start, sep: open.sep, end: i })
      open = null
    } else {
      return { regions, error: `line ${i + 1}: malformed conflict marker` }
    }
  }
  if (open) return { regions, error: `line ${open.start + 1}: conflict region is not closed` }
  return { regions }
}

/** `text` with every region removed (lines and markers). Assumes `findRegions` found no error. */
export function stripRegions(text: string, regions: MarkerRegion[]): string {
  const lines = splitLines(text)
  const drop = new Set<number>()
  for (const r of regions) for (let i = r.start; i <= r.end; i++) drop.add(i)
  return lines.filter((_, i) => !drop.has(i)).join('\n')
}

/**
 * Replaces the regions `key` by the chosen side's fragment — every region of that key: a display
 * tree's position conflict has one at each place (GH222), one choice settles both. Text unchanged
 * if no such region.
 */
export function resolveRegion(text: string, key: string, side: Side): string {
  return replaceRegions(text, key, (left, right) => (side === 'left' ? left : right))
}

function replaceRegions(text: string, key: string, pick: (left: string[], right: string[]) => string[]): string {
  const { regions, error } = findRegions(text)
  if (error) return text
  const mine = regions.filter(r => r.key === key)
  if (mine.length === 0) return text
  const lines = splitLines(text)
  // From the last region up, so the line indexes of the earlier ones stay valid.
  for (const region of mine.reverse()) {
    const kept = pick(lines.slice(region.start + 1, region.sep), lines.slice(region.sep + 1, region.end))
    lines.splice(region.start, region.end - region.start + 1, ...kept)
  }
  return lines.join('\n')
}

/** Replaces the regions `key` by `fragment` (« Prendre l'ancêtre » : the block's ancestor
 *  fragment, `''` = the node is removed). Text unchanged if no such region. */
export function resolveRegionWith(text: string, key: string, fragment: string): string {
  const lines = fragment === '' ? [] : fragment.replace(/\n$/, '').split('\n')
  return replaceRegions(text, key, () => lines)
}

// ─── « Prendre les deux » (GH222) ──────────────────────────────────────────────────

type FragmentShape =
  | { form: 'items' }
  | { form: 'entry'; indent: string; name: string; value: unknown }
  | { form: 'text' }
  | { form: 'empty' }

function shapeOf(lines: string[]): FragmentShape {
  const body = lines.filter(l => l.trim() !== '')
  if (body.length === 0) return { form: 'empty' }
  const first = body[0]
  if (/^-( |$)/.test(first.trimStart())) return { form: 'items' }
  const indent = first.slice(0, first.length - first.trimStart().length)
  try {
    const v = yaml.load(lines.map(l => l.slice(indent.length)).join('\n'))
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1) {
      const [name, value] = Object.entries(v)[0]
      return { form: 'entry', indent, name, value }
    }
  } catch {
    // Not a YAML entry: a text hunk.
  }
  return { form: 'text' }
}

const isMultiline = (v: unknown) => typeof v === 'string' && v.includes('\n')

/** Elements of an items fragment (`- …` lines at some indentation). */
function itemsOf(lines: string[]): unknown[] {
  const first = lines.find(l => l.trim() !== '') ?? ''
  const indent = first.length - first.trimStart().length
  try {
    const v = yaml.load(lines.map(l => l.slice(indent)).join('\n'))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

const IDENTITY_KEYS = ['id', 'entryId', 'name', 'key']

/** Both lists hold the same element — by an identity key, or as a whole: keeping both would
 *  write it twice (a run, a link, a tree node). */
function sharesIdentity(a: unknown[], b: unknown[]): boolean {
  const ids = (list: unknown[]) => new Set(list.flatMap(x => {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) return [JSON.stringify(x)]
    const o = x as Record<string, unknown>
    return IDENTITY_KEYS.filter(k => typeof o[k] === 'string' || typeof o[k] === 'number').map(k => `${k}=${String(o[k])}`)
  }))
  const ib = ids(b)
  return [...ids(a)].some(id => ib.has(id))
}

/** What « Prendre les deux » writes, `null` when it has no meaning (a scalar, a removed side, the
 *  same element on both sides). */
function bothOf(left: string[], right: string[]): string[] | null {
  const [l, r] = [shapeOf(left), shapeOf(right)]
  if (l.form === 'empty' || r.form === 'empty') return null
  if (l.form === 'items' && r.form === 'items') return sharesIdentity(itemsOf(left), itemsOf(right)) ? null : [...left, ...right]
  if (l.form === 'text' && r.form === 'text') return [...left, ...right]
  if (l.form !== 'entry' || r.form !== 'entry' || l.name !== r.name) return null
  let value: unknown
  if (Array.isArray(l.value) && Array.isArray(r.value)) {
    if (sharesIdentity(l.value, r.value)) return null
    value = [...l.value, ...r.value]
  }
  else if (typeof l.value === 'string' && typeof r.value === 'string' && (isMultiline(l.value) || isMultiline(r.value))) {
    value = `${l.value.replace(/\n+$/, '')}\n${r.value}`
  } else return null
  return yaml.dump({ [l.name]: value }, { lineWidth: 120 }).replace(/\n$/, '').split('\n').map(x => (x === '' ? x : l.indent + x))
}

/** « Prendre les deux » has a meaning for this block: list elements (those of both sides), a text
 *  hunk or a multi-line text (left then right), a list value (concatenated) — not a scalar. */
export function canTakeBoth(text: string, key: string): boolean {
  const { regions, error } = findRegions(text)
  const region = error ? undefined : regions.find(r => r.key === key)
  if (!region) return false
  const lines = splitLines(text)
  return bothOf(lines.slice(region.start + 1, region.sep), lines.slice(region.sep + 1, region.end)) !== null
}

/** Replaces the regions `key` by both sides (`canTakeBoth`); text unchanged otherwise. */
export function resolveRegionBoth(text: string, key: string): string {
  if (!canTakeBoth(text, key)) return text
  return replaceRegions(text, key, (left, right) => bothOf(left, right)!)
}

/** Resolves every remaining region with the same side ("Tout prendre à gauche/droite"). */
export function resolveAllRegions(text: string, side: Side): string {
  let out = text
  for (;;) {
    const { regions, error } = findRegions(out)
    if (error || regions.length === 0) return out
    out = resolveRegion(out, regions[0].key, side)
  }
}
