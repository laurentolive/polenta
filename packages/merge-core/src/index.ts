import yaml from 'js-yaml'
import { findRegions, stripRegions } from './markers'
import { isPlainObject, mergeObject, parseObject } from './object'
import { mergeText } from './text'
import type { FileKind, FileMerge, MarkerLabels, ParsedOutput } from './types'

export * from './types'
export { renderRegion, findRegions, resolveRegion, resolveAllRegions } from './markers'
export { mergeObject, parseObject, deepEqual, YAML_DUMP_OPTIONS } from './object'
export { mergeText, linesWithBreaks, changedLineIndexes } from './text'

/** Same heuristic as git: a NUL byte in the first 8000 bytes means binary. */
export function isBinaryContent(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
  return false
}

/**
 * `object` when every side present is a typed object (YAML mapping with `id` and
 * `objectTypeRef`), `text` otherwise. Binary is decided on the raw bytes by the caller.
 */
export function detectKind(sides: (string | null)[]): Exclude<FileKind, 'binary'> {
  const present = sides.filter((s): s is string => s !== null)
  return present.length > 0 && present.every(s => parseObject(s) !== null) ? 'object' : 'text'
}

/** 3-way merge of a file present on both sides (`base` null = added on both sides). */
export function mergeFile(base: string | null, left: string, right: string, labels: MarkerLabels): FileMerge {
  if (detectKind([left, right]) === 'object') {
    const b = base === null ? null : parseObject(base)
    // A base that is not a typed object (rare: the file changed nature) is treated as absent.
    return mergeObject(b, parseObject(left)!, parseObject(right)!, labels)
  }
  return mergeText(base, left, right, labels)
}

/** Reads an output back: open regions, and for an object the YAML outside them. */
export function parseOutput(kind: FileKind, text: string): ParsedOutput {
  const { regions, error } = findRegions(text)
  if (error) return { unresolved: regions.map(r => r.key), error }
  const unresolved = regions.map(r => r.key)
  if (kind !== 'object') return { unresolved }
  try {
    const value = yaml.load(stripRegions(text, regions))
    if (!isPlainObject(value)) return { unresolved, error: 'the content is not a YAML mapping' }
    return { unresolved, value }
  } catch (err) {
    return { unresolved, error: err instanceof Error ? err.message.split('\n')[0] : String(err) }
  }
}
export { changedUnits, regionFragments, fragmentValue, updateObjectOutput, unitAnchors, unitValue } from './units'
