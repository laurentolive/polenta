import yaml from 'js-yaml'
import { findRegions, stripRegions } from './markers'
import { isPlainObject, YAML_DUMP_OPTIONS } from './object'
import { mergeText } from './text'
import { entriesOf, keyedKindOf, type KeyedKind } from './keyed'
import { mergeTree, renumber } from './merge-tree'
import { isTreeDoc, isTreeFile, mergeTreeFile } from './flat-tree'
import { mergeDrawio, parseDrawio } from './drawio'
import { commonYamlStyle, genericDesc, LINKS_DESC, OBJECT_DESC, PARAMETERS_DESC } from './structure'
import { key } from './path'
import type { FileKind, FileMerge, MarkerLabels, ParsedOutput } from './types'

export * from './types'
export { renderRegion, findRegions, resolveRegion, resolveAllRegions, resolveRegionBoth, resolveRegionWith, canTakeBoth } from './markers'
export { mergeHistories, parseObject, deepEqual, isPlainObject, YAML_DUMP_OPTIONS } from './object'
export { mergeObject, mergeTree, MergeContext } from './merge-tree'
export { mergeText, linesWithBreaks, changedLineIndexes } from './text'
export { keyedKindOf, parseKeyed, entriesOf, blockKeyOf, type KeyedKind } from './keyed'
export { diffTree, alignSequences, type DiffNode, type DiffState, type NodeKind } from './diff-tree'
export { pointer, type NodePath, type PathStep } from './path'
export {
  canonical, commonYamlStyle, genericDesc, listRuleOf, yamlStyleOf, OBJECT_DESC, LINKS_DESC, PARAMETERS_DESC,
  type ListRule, type StructureDesc,
} from './structure'
export { updateOutputAt, type OutputPath } from './output'
export { parseDrawio, type DrawioFile, type DrawioPage } from './drawio'
export { isTreeFile } from './flat-tree'

/** Same heuristic as git: a NUL byte in the first 8000 bytes means binary. */
export function isBinaryContent(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
  return false
}

const isYamlPath = (path?: string) => !!path && /\.ya?ml$/i.test(path)
const isDrawioPath = (path?: string) => !!path && /\.drawio$/i.test(path)

function load(text: string | null): unknown {
  if (text === null) return undefined
  try {
    return yaml.load(text)
  } catch {
    return undefined
  }
}

function isTypedObject(v: unknown): boolean {
  return isPlainObject(v) && typeof v.id === 'string' && typeof v.objectTypeRef === 'string'
}

/** `{ links: [...] }` / `{ parameters: {...} }` of a keyed file's parsed value (an empty file
 *  counts as empty), `undefined` when it has another shape. */
function keyedDoc(kind: KeyedKind, v: unknown): Record<string, unknown> | undefined {
  if (v === undefined || v === null) return kind === 'links' ? { links: [] } : { parameters: {} }
  if (!isPlainObject(v) || Object.keys(v).some(k => k !== kind)) return undefined
  const entries = entriesOf(kind, v[kind])
  if (!entries) return undefined
  return kind === 'links' ? { links: [...entries.values()] } : { parameters: Object.fromEntries(entries) }
}

interface Analysis {
  kind: Exclude<FileKind, 'binary'>
  /** Parsed value of each side (`undefined` = absent or not YAML) — each side is parsed once. */
  values: unknown[]
}

function analyze(sides: (string | null)[], path?: string): Analysis {
  const values = sides.map(s => (s === null ? undefined : load(s)))
  const present = sides.map((s, i) => [s, values[i]] as const).filter((x): x is readonly [string, unknown] => x[0] !== null)
  const result = (kind: Analysis['kind']) => ({ kind, values })
  const keyed = keyedKindOf(path)
  if (keyed && present.every(([s, v]) => (v === undefined && s.trim() !== '' ? false : keyedDoc(keyed, v) !== undefined))) return result(keyed)
  if (present.length > 0 && present.every(([, v]) => isTypedObject(v))) return result('object')
  if (keyed || present.length === 0) return result('text')
  if (isDrawioPath(path)) return result(present.every(([s]) => parseDrawio(s) !== null) ? 'drawio' : 'text')
  if (isYamlPath(path) && present.every(([, v]) => isPlainObject(v))
    && commonYamlStyle(present.map(([s]) => s), present.map(([, v]) => v)) !== null) {
    return result(isTreeFile(path) && present.every(([, v]) => isTreeDoc(v)) ? 'trees' : 'yaml')
  }
  return result('text')
}

/**
 * How a file is merged:
 * - `links` / `parameters` for those two files when every side present has their shape;
 * - `object` when every side present is a typed object (mapping with `id` and `objectTypeRef`);
 * - `drawio` for a `.drawio` whose sides all have pages (GH222);
 * - `trees` / `yaml` for a YAML mapping (`.polenta/trees/**` / any other path) whose sides are all
 *   written exactly as the app writes them, in the same style — a structural merge rewrites the
 *   file and must never drop a comment (GH222 design §2.5);
 * - `text` otherwise. Binary is decided on the raw bytes by the caller.
 */
export function detectKind(sides: (string | null)[], path?: string): Exclude<FileKind, 'binary'> {
  return analyze(sides, path).kind
}

/** 3-way merge of a file present on both sides (`base` null = added on both sides). */
export function mergeFile(base: string | null, left: string, right: string, labels: MarkerLabels, path?: string): FileMerge {
  const { kind, values: [l, r] } = analyze([left, right], path)
  const b = kind === 'text' || kind === 'drawio' ? undefined : load(base)
  switch (kind) {
    case 'links':
    case 'parameters':
      // A base of another shape (rare) is treated as absent, like for objects.
      return mergeTree(kind, kind === 'links' ? LINKS_DESC : PARAMETERS_DESC, base === null ? undefined : keyedDoc(kind, b), keyedDoc(kind, l), keyedDoc(kind, r), labels)
    case 'object':
      // A base that is not a typed object (the file changed nature) is treated as absent.
      return mergeTree('object', OBJECT_DESC, isTypedObject(b) ? b : undefined, l, r, labels)
    case 'trees':
      return mergeTreeFile(isTreeDoc(b) ? b : undefined, l as Record<string, unknown>, r as Record<string, unknown>, labels)
    case 'yaml':
      return mergeTree('yaml', genericDesc(commonYamlStyle([left, right], [l, r])!), isPlainObject(b) ? b : undefined, l, r, labels)
    case 'drawio':
      return mergeDrawio(base, left, right, labels) ?? mergeText(base, left, right, labels)
    default:
      return mergeText(base, left, right, labels)
  }
}

const YAML_KINDS = new Set<FileKind>(['object', 'links', 'parameters', 'yaml', 'trees'])

/** Reads an output back: open regions, and for a YAML kind the YAML outside them. */
export function parseOutput(kind: FileKind, text: string): ParsedOutput {
  const { regions, error } = findRegions(text)
  // A position conflict of a display tree has two regions of the same key (GH222).
  const unresolved = [...new Set(regions.map(r => r.key))]
  if (error) return { unresolved, error }
  if (!YAML_KINDS.has(kind)) return { unresolved }
  try {
    const value = yaml.load(stripRegions(text, regions))
    if (!isPlainObject(value)) return { unresolved, error: 'the content is not a YAML mapping' }
    return { unresolved, value }
  } catch (err) {
    return { unresolved, error: err instanceof Error ? err.message.split('\n')[0] : String(err) }
  }
}

/**
 * The text written at finalization for a fully resolved output. A YAML output is rewritten as the
 * app writes it only when it has to be: the region of a nested block left a `-` on its own line or
 * an `!!seq` tag, or test steps are out of order (`order` renumbered). Otherwise the user's text
 * is kept verbatim. `sides` (left, right) give the style of a generic YAML file.
 */
export function canonicalOutput(kind: FileKind, text: string, sides: (string | null)[] = []): string {
  if (!YAML_KINDS.has(kind) || findRegions(text).regions.length > 0) return text
  const value = load(text)
  if (!isPlainObject(value)) return text
  let needed = /^ *-$/m.test(text) || /: !!seq$/m.test(text)
  if (kind === 'object' && Array.isArray(value.steps)) {
    const rule = OBJECT_DESC.listRule?.([key('steps')])
    if (rule && 'renumber' in rule && rule.renumber) {
      const field = rule.renumber
      const steps = value.steps
      if (steps.some((x, i) => isPlainObject(x) && field in x && x[field] !== i + 1)) {
        renumber(steps, field)
        needed = true
      }
    }
  }
  if (!needed) return text
  const style = kind === 'yaml' || kind === 'trees'
    ? commonYamlStyle(sides.filter((s): s is string => s !== null)) ?? YAML_DUMP_OPTIONS
    : YAML_DUMP_OPTIONS
  return yaml.dump(value, style)
}

export { changedUnits, regionFragments, fragmentValue, updateObjectOutput, unitAnchors, unitValue } from './units'
export { formatCounterId, renumberText, renumberPath, nextFreeId, prefixOf, shortRef } from './renumber'
