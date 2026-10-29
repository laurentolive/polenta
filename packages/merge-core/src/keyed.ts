import yaml from 'js-yaml'
import { isPlainObject } from './object'

/**
 * GH37 sprint 3 — collections keyed by an identifier, merged entry by entry instead of line by
 * line: `links/links.yaml` (`{ links: ObjectLink[] }`, one unit per link `id`) and
 * `parameters/parameters.yaml` (`{ parameters: { <name>: {...} } }`, one unit per name, written
 * sorted — T171). Entries added on both sides are all kept (union); an entry changed or removed
 * differently on the two sides is a block (`link:<id>`, `param:<name>`).
 */

export type KeyedKind = 'links' | 'parameters'

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
