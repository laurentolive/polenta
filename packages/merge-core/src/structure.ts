import yaml from 'js-yaml'
import { isPlainObject, mergeHistories, YAML_DUMP_OPTIONS } from './object'
import { matches, pointer, type NodePath } from './path'
import type { Side } from './types'

/**
 * GH222 — descriptions de structure : ce que le moteur générique doit savoir d'un type de fichier
 * (identité des listes, granularité des blocs, réconciliations, clés de bloc). Internes à Polenta.
 */

export type ListRule =
  | { by: string; insert?: 'end' | 'after' }
  | { byValue: true; insert?: 'end' | 'after' }
  | { lcs: true; ignore?: string[]; renumber?: string }

export type Reconciled = { value: unknown; from: Side | 'both' }

export interface StructureDesc {
  /** Options de `yaml.dump` du fichier (style d'écriture de l'app). */
  dump: yaml.DumpOptions
  /** Un nœud atomique est un bloc entier : pas de fusion à l'intérieur. */
  isAtomic(path: NodePath): boolean
  /** Règle d'une liste ; `undefined` = heuristique (`listRuleOf`). */
  listRule?(path: NodePath): ListRule | undefined
  /** Mapping écrit à clés triées. */
  sorted?(path: NodePath): boolean
  /** Valeurs modifiées différemment des deux côtés et réconciliées sans conflit. */
  reconcile?(path: NodePath, b: unknown, l: unknown, r: unknown): Reconciled | undefined
  blockKey(path: NodePath): string
}

const SUIVI_DUMP: yaml.DumpOptions = { lineWidth: -1, noRefs: true }
/** The two ways the app writes YAML: `writeYaml` (most files) and the Suivi store. */
export const YAML_STYLES: yaml.DumpOptions[] = [YAML_DUMP_OPTIONS, SUIVI_DUMP]

/**
 * Dump options for which `text` is exactly what the app would write, `null` when it is not
 * (hand-written YAML: comments, other quoting…). A structural merge rewrites the file, so it is
 * kept for such canonical files only — never at the cost of a comment.
 */
export function yamlStyleOf(text: string): yaml.DumpOptions | null {
  return commonYamlStyle([text])
}

/** The first app style in which every text is written exactly (a file short enough to match both
 *  styles on one side must still match the other side's). `values`: the texts already parsed. */
export function commonYamlStyle(texts: string[], values?: unknown[]): yaml.DumpOptions | null {
  let styles = YAML_STYLES
  for (const [i, text] of texts.entries()) {
    let value: unknown
    if (values) value = values[i]
    else {
      try {
        value = yaml.load(text)
      } catch {
        return null
      }
    }
    if (value === undefined) return null
    styles = styles.filter(style => {
      try {
        return yaml.dump(value, style) === text
      } catch {
        return false
      }
    })
    if (styles.length === 0) return null
  }
  return styles[0] ?? null
}

// ─── Objets typés (exigence, test, campagne) ──────────────────────────────────────

/** Root keys merged inside (the others are one block each, as in GH37). */
const OBJECT_OPEN_ROOTS = new Set(['fields', 'steps', 'runs', 'removedRuns', 'testCaseIds'])

export const OBJECT_DESC: StructureDesc = {
  dump: YAML_DUMP_OPTIONS,
  isAtomic: p => (p.length === 1 ? !('k' in p[0] && OBJECT_OPEN_ROOTS.has(p[0].k)) : p.length >= 2),
  listRule(p) {
    if (matches('steps', p)) return { lcs: true, ignore: ['order'], renumber: 'order' }
    if (matches('runs', p) || matches('removedRuns', p)) return { by: 'entryId' }
    if (matches('testCaseIds', p)) return { byValue: true }
    return undefined
  },
  reconcile(p, _b, l, r) {
    if (p.length !== 1 || !('k' in p[0])) return undefined
    // `version` only ever grows (each save bumps it), `needsRevalidation` is written only when
    // true (T172) and an impact still to check on either side must not be lost, `history` (GH77)
    // is the union of the entries of both branches.
    switch (p[0].k) {
      case 'version':
        return typeof l === 'number' && typeof r === 'number' ? { value: Math.max(l, r), from: l > r ? 'left' : 'right' } : undefined
      case 'needsRevalidation':
        return { value: l === true || r === true ? true : undefined, from: l === true ? 'left' : 'right' }
      case 'history':
        return { value: mergeHistories(l, r), from: 'both' }
      default:
        return undefined
    }
  },
  blockKey(p) {
    const [a, b] = p
    if (p.length === 1 && 'k' in a) return a.k
    if (p.length === 2 && 'k' in a) {
      if (a.k === 'fields' && 'k' in b) return `fields.${b.k}`
      if ('i' in b) return `${a.k}~${b.i}`
      if ('id' in b) return `${a.k}~${b.id}`
    }
    return pointer(p)
  },
}

// ─── Liens, paramètres ────────────────────────────────────────────────────────────

export const LINKS_DESC: StructureDesc = {
  dump: YAML_DUMP_OPTIONS,
  isAtomic: p => p.length >= 2,
  listRule: p => (matches('links', p) ? { by: 'id', insert: 'end' } : undefined),
  blockKey: p => (p.length === 2 && 'id' in p[1] ? `link:${p[1].id}` : pointer(p)),
}

export const PARAMETERS_DESC: StructureDesc = {
  dump: YAML_DUMP_OPTIONS,
  isAtomic: p => p.length >= 2,
  sorted: p => matches('parameters', p),
  blockKey: p => (p.length === 2 && 'k' in p[1] ? `param:${p[1].k}` : pointer(p)),
}

// ─── YAML générique ───────────────────────────────────────────────────────────────

export function genericDesc(dump: yaml.DumpOptions = YAML_DUMP_OPTIONS): StructureDesc {
  return { dump, isAtomic: () => false, blockKey: pointer }
}

/** Candidate identity keys of a list of mappings, in order of preference. */
const IDENTITY_KEYS = ['id', 'entryId', 'name', 'key']

/** Canonical text of a value (mapping keys sorted), optionally without some keys. */
export function canonical(v: unknown, ignore?: string[]): string {
  return JSON.stringify(sortDeep(v, ignore))
}

function sortDeep(v: unknown, ignore?: string[]): unknown {
  if (Array.isArray(v)) return v.map(x => sortDeep(x))
  if (v instanceof Date) return v.toISOString()
  if (!isPlainObject(v)) return v
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v).sort()) {
    if (ignore?.includes(k) || v[k] === undefined) continue
    out[k] = sortDeep(v[k])
  }
  return out
}

/** Heuristic rule of a list (design §2.4): identity by a unique key, by unique scalar values, or
 *  alignment of the elements as a whole. Every side given must satisfy the identity rule. */
export function listRuleOf(sides: unknown[][]): ListRule {
  const all = sides.flat()
  if (all.length > 0 && all.every(isPlainObject)) {
    for (const k of IDENTITY_KEYS) {
      const ok = sides.every(list => {
        const seen = new Set<string>()
        return list.every(x => {
          const v = (x as Record<string, unknown>)[k]
          if (typeof v !== 'string' && typeof v !== 'number') return false
          if (seen.has(String(v))) return false
          seen.add(String(v))
          return true
        })
      })
      if (ok) return { by: k }
    }
  }
  if (all.length > 0 && all.every(x => x === null || typeof x !== 'object')) {
    if (sides.every(list => new Set(list.map(x => canonical(x))).size === list.length)) return { byValue: true }
  }
  return { lcs: true }
}

/** Identity of an element under a rule with identity. */
export function identityOf(rule: ListRule, v: unknown): string {
  if ('by' in rule) return String((v as Record<string, unknown>)[rule.by])
  return canonical(v)
}
