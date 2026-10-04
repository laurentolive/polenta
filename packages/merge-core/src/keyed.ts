import yaml from 'js-yaml'
import { renderRegion } from './markers'
import { isPlainObject, mergeUnit, YAML_DUMP_OPTIONS } from './object'
import type { FileMerge, MarkerLabels, MergeBlock } from './types'

/**
 * GH37 sprint 3 — collections keyed by an identifier, merged entry by entry instead of line by
 * line: `links/links.yaml` (`{ links: ObjectLink[] }`, one unit per link `id`) and
 * `parameters/parameters.yaml` (`{ parameters: { <name>: {...} } }`, one unit per name, written
 * sorted — T171). Entries added on both sides are all kept (union); an entry changed or removed
 * differently on the two sides is a block (`link:<id>`, `param:<name>`).
 */

export type KeyedKind = 'links' | 'parameters'

const PLACEHOLDER = (i: number) => `__POLENTA_MERGE_${i}__`
const LIST_PLACEHOLDER_LINE = /^( *)- __POLENTA_MERGE_(\d+)__$/
const MAP_PLACEHOLDER_LINE = /^( *)\S.*: __POLENTA_MERGE_(\d+)__$/

export function keyedKindOf(path: string | undefined): KeyedKind | null {
  if (!path) return null
  const p = path.split('\\').join('/')
  if (p === 'links/links.yaml' || p.endsWith('/links/links.yaml')) return 'links'
  if (p === 'parameters/parameters.yaml' || p.endsWith('/parameters/parameters.yaml')) return 'parameters'
  return null
}

const ROOT: Record<KeyedKind, string> = { links: 'links', parameters: 'parameters' }
export const blockKeyOf = (kind: KeyedKind, id: string) => `${kind === 'links' ? 'link' : 'param'}:${id}`

/** Entries of a keyed file, in file order — `null` when the content is not of that shape. */
export function parseKeyed(kind: KeyedKind, text: string | null): Map<string, unknown> | null {
  if (text === null) return new Map()
  let v: unknown
  try {
    v = yaml.load(text)
  } catch {
    return null
  }
  if (v === undefined || v === null) return new Map()
  if (!isPlainObject(v) || Object.keys(v).some(k => k !== ROOT[kind])) return null
  return entriesOf(kind, v[ROOT[kind]])
}

/** Entries of the collection value (`links` array or `parameters` mapping); `null` if malformed. */
export function entriesOf(kind: KeyedKind, collection: unknown): Map<string, unknown> | null {
  const out = new Map<string, unknown>()
  if (collection === undefined || collection === null) return out
  if (kind === 'links') {
    if (!Array.isArray(collection)) return null
    for (const link of collection) {
      if (!isPlainObject(link) || typeof link.id !== 'string' || out.has(link.id)) return null
      out.set(link.id, link)
    }
    return out
  }
  if (!isPlainObject(collection)) return null
  for (const [k, val] of Object.entries(collection)) out.set(k, val)
  return out
}

function fragment(kind: KeyedKind, id: string, value: unknown, indent: string): string | undefined {
  if (value === undefined) return undefined
  const dumped = kind === 'links' ? yaml.dump([value], YAML_DUMP_OPTIONS) : yaml.dump({ [id]: value }, YAML_DUMP_OPTIONS)
  return dumped.split('\n').map(l => (l === '' ? l : indent + l)).join('\n')
}

export function mergeKeyed(
  kind: KeyedKind, base: Map<string, unknown>, left: Map<string, unknown>, right: Map<string, unknown>, labels: MarkerLabels,
): FileMerge {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const m of [right, left, base]) for (const id of m.keys()) if (!seen.has(id)) { seen.add(id); ids.push(id) }
  if (kind === 'parameters') ids.sort()

  const auto: FileMerge['auto'] = []
  const pending: { id: string; left: unknown; right: unknown }[] = []
  const values: { id: string; value: unknown }[] = []
  for (const id of ids) {
    const r = mergeUnit('', base.get(id), left.get(id), right.get(id))
    const key = blockKeyOf(kind, id)
    if (!r.conflict) {
      if (r.from) auto.push({ key, from: r.from })
      if (r.value !== undefined) values.push({ id, value: r.value })
      continue
    }
    values.push({ id, value: PLACEHOLDER(pending.length) })
    pending.push({ id, left: r.left, right: r.right })
  }

  const collection = kind === 'links'
    ? values.map(v => v.value)
    : Object.fromEntries(values.map(v => [v.id, v.value]))
  const placeholderLine = kind === 'links' ? LIST_PLACEHOLDER_LINE : MAP_PLACEHOLDER_LINE
  const blocks: MergeBlock[] = []
  const output = yaml
    .dump({ [ROOT[kind]]: collection }, YAML_DUMP_OPTIONS)
    .split('\n')
    .map(line => {
      const m = placeholderLine.exec(line)
      if (!m) return line
      const p = pending[Number(m[2])]
      const block: MergeBlock = {
        key: blockKeyOf(kind, p.id),
        left: fragment(kind, p.id, p.left, m[1]),
        right: fragment(kind, p.id, p.right, m[1]),
      }
      blocks.push(block)
      return renderRegion(block.key, block.left, block.right, labels).replace(/\n$/, '')
    })
    .join('\n')
  return { kind, output, blocks, auto }
}
