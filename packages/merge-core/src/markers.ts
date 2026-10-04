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

/** Replaces the region `key` by the chosen side's fragment. Text unchanged if no such region. */
export function resolveRegion(text: string, key: string, side: Side): string {
  const { regions, error } = findRegions(text)
  if (error) return text
  const region = regions.find(r => r.key === key)
  if (!region) return text
  const lines = splitLines(text)
  const kept = side === 'left'
    ? lines.slice(region.start + 1, region.sep)
    : lines.slice(region.sep + 1, region.end)
  return [...lines.slice(0, region.start), ...kept, ...lines.slice(region.end + 1)].join('\n')
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
