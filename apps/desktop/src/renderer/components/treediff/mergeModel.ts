import { useCallback, useMemo, useState } from 'react'
import yaml from 'js-yaml'
import {
  canonical, deepEqual, diffTree, isPlainObject, LINKS_DESC, OBJECT_DESC, PARAMETERS_DESC, pointer,
  type DiffNode, type OutputPath, type StructureDesc,
} from '@polenta/merge-core'
import type { MergeFileDetail } from '@polenta/types'
import type { ResolvedBlock } from '../merge/blockLocator'
import type { Presentation } from './presentation'

/**
 * GH222 sprint 4 — modèle de la vue générique en merge (sans rendu) : rangées (union des deux
 * côtés, alignées), ce que chaque côté a changé, rattachement des blocs de conflit et des blocs
 * résolus aux rangées, et lecture de la sortie au chemin d'une rangée.
 */

const IDENTITY_KEYS = ['id', 'entryId', 'name', 'key']

export interface MergeRow {
  node: DiffNode
  depth: number
  children: DiffNode[]
  expanded: boolean
  trail: string
}

export interface MergeTreeModel {
  rows: MergeRow[]
  toggle: (n: DiffNode) => void
  /** Ce que chaque côté a changé depuis l'ancêtre, par clé de rangée. */
  changedLeft: Set<string>
  changedRight: Set<string>
  /** Valeur de l'ancêtre par clé de rangée. */
  baseAt: Map<string, { has: boolean; value: unknown }>
  /** Blocs de conflit ouverts de chaque rangée (plusieurs plages d'une même liste, par ex.). */
  rowConflicts: Map<string, string[]>
  /** Blocs ouverts qui ne désignent aucune rangée : montrés en tête de la sortie. */
  unplaced: string[]
  /** Blocs résolus de chaque rangée. */
  rowResolved: Map<string, ResolvedBlock[]>
  /** Rangées à l'intérieur d'un conflit ouvert (leur valeur de sortie est dans la carte). */
  insideConflict: Set<string>
  /** Tous les nœuds, par clé (lecture de la sortie sous un élément de liste). */
  nodes: Map<string, DiffNode>
  output: unknown
  presentation: Presentation
}

export function mergeDescFor(kind: MergeFileDetail['kind']): StructureDesc | undefined {
  return kind === 'object' ? OBJECT_DESC : kind === 'links' ? LINKS_DESC : kind === 'parameters' ? PARAMETERS_DESC : undefined
}

function load(text: string | null): unknown {
  if (text === null) return undefined
  try {
    return yaml.load(text) ?? null
  } catch {
    return undefined
  }
}

/** Keys of the nodes a side changed since the ancestor. */
function changedKeys(base: unknown, side: unknown, desc?: StructureDesc): Set<string> {
  const out = new Set<string>()
  const walk = (n: DiffNode) => {
    if (n.state !== 'unchanged') out.add(n.key)
    n.children?.forEach(walk)
  }
  if (side !== undefined) walk(diffTree(base, side, desc))
  return out
}

function walkAll(root: DiffNode, fn: (n: DiffNode) => void) {
  const go = (n: DiffNode) => { fn(n); n.children?.forEach(go) }
  go(root)
}

/**
 * Row of each block key. A block is keyed by the file's description (`fields.statement`,
 * `link:<id>`, `steps~2`, a pointer); a key that names no row (a range of list elements, an order
 * block, a display tree position) goes to the row of its list, or of the node it moves. A key
 * still without a row is absent from the result (the caller shows it apart).
 */
export function blockRows(root: DiffNode, keys: string[], desc: StructureDesc | undefined): Map<string, string> {
  const byBlock = new Map<string, string>()
  const byId = new Map<string, string>()
  const all = new Set<string>()
  walkAll(root, n => {
    if (n.path.length === 0) return
    all.add(n.key)
    const last = n.path[n.path.length - 1]
    // An element of a list aligned as a whole has no stable key: its position in the merge output
    // and in this alignment differ. Its blocks go to the list's row (below).
    if (!('i' in last)) byBlock.set(desc ? desc.blockKey(n.path) : pointer(n.path), n.key)
    if ('id' in last && !byId.has(last.id)) byId.set(last.id, n.key)
  })
  const out = new Map<string, string>()
  for (const k of keys) {
    let row = byBlock.get(k)
    if (!row && /^pos:/.test(k)) row = byId.get(k.slice(4))
    if (!row && /^node:/.test(k)) {
      const [id, prop] = k.slice(5).split('/')
      const owner = byId.get(id)
      row = owner ? `${owner}/${prop}` : undefined
    }
    if (!row) {
      // `steps~2` → `steps`, `/rows/#1` → `/rows`, `<list>~order` → `<list>`.
      const parent = k.replace(/~order$/, '').replace(/~[^~/]*$/, '').replace(/\/#\d+$/, '')
      row = byBlock.get(parent) ?? (all.has(parent) ? parent : undefined)
    }
    if (row && all.has(row)) out.set(k, row)
  }
  return out
}

function group<T>(entries: Array<[string, T]>): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const [k, v] of entries) m.set(k, [...(m.get(k) ?? []), v])
  return m
}

const EMPTY_ROOT: DiffNode = { path: [], key: '', label: '', kind: 'map', state: 'unchanged', hasBefore: true, hasAfter: true, changedCount: 0 }

export function useMergeTree({ enabled, detail, presentation, openKeys, resolved, parsedOutput }: {
  /** `false` : vue Raw, fichier non YAML — rien n'est calculé. */
  enabled: boolean
  detail: MergeFileDetail
  presentation: Presentation
  openKeys: string[]
  resolved: ResolvedBlock[]
  parsedOutput: unknown
}): MergeTreeModel {
  const p = presentation
  const desc = mergeDescFor(detail.kind)
  const values = useMemo(
    () => (enabled ? { base: load(detail.base), left: load(detail.left), right: load(detail.right) } : null),
    [enabled, detail.base, detail.left, detail.right],
  )
  const root = useMemo(() => (values ? diffTree(values.left, values.right, desc) : EMPTY_ROOT), [values, desc])
  const changedLeft = useMemo(() => (values ? changedKeys(values.base, values.left, desc) : new Set<string>()), [values, desc])
  const changedRight = useMemo(() => (values ? changedKeys(values.base, values.right, desc) : new Set<string>()), [values, desc])
  const baseAt = useMemo(() => {
    const m = new Map<string, { has: boolean; value: unknown }>()
    for (const side of values ? [values.left, values.right] : []) {
      if (side === undefined) continue
      walkAll(diffTree(values!.base, side, desc), n => { if (!m.has(n.key)) m.set(n.key, { has: n.hasBefore, value: n.before }) })
    }
    return m
  }, [values, desc])
  const nodes = useMemo(() => { const m = new Map<string, DiffNode>(); walkAll(root, n => m.set(n.key, n)); return m }, [root])

  const { rowConflicts, unplaced } = useMemo(() => {
    const rows = blockRows(root, openKeys, desc)
    return {
      rowConflicts: group(openKeys.filter(k => rows.has(k)).map(k => [rows.get(k)!, k] as [string, string])),
      unplaced: openKeys.filter(k => !rows.has(k)),
    }
  }, [root, openKeys, desc])
  const rowResolved = useMemo(() => {
    const rows = blockRows(root, resolved.map(r => r.key), desc)
    return group(resolved.filter(r => rows.has(r.key)).map(r => [rows.get(r.key)!, r] as [string, ResolvedBlock]))
  }, [root, resolved, desc])

  // Rows to open: what either side changed, and the blocks (with their ancestors).
  const hot = useMemo(() => {
    const keys = new Set<string>([...changedLeft, ...changedRight, ...rowConflicts.keys(), ...rowResolved.keys()])
    const out = new Set<string>()
    walkAll(root, n => {
      if (!keys.has(n.key)) return
      for (let i = 0; i <= n.path.length; i++) out.add(pointer(n.path.slice(0, i)))
    })
    return out
  }, [root, changedLeft, changedRight, rowConflicts, rowResolved])

  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map())
  const isExpanded = useCallback((n: DiffNode) => toggled.get(n.key) ?? hot.has(n.key), [toggled, hot])
  const toggle = useCallback((n: DiffNode) => setToggled(prev => new Map(prev).set(n.key, !isExpanded(n))), [isExpanded])

  const { rows, insideConflict } = useMemo(() => {
    const out: MergeRow[] = []
    const inside = new Set<string>()
    const childrenOf = (n: DiffNode) => (p.leaf(n) ? [] : p.order(n, (n.children ?? []).filter(c => !p.hidden(c))))
    const walk = (parent: DiffNode, depth: number, trail: string, inConflict: boolean) => {
      for (const c of childrenOf(parent)) {
        const children = childrenOf(c)
        const expanded = children.length > 0 && isExpanded(c)
        const here = trail ? `${trail} › ${p.label(c)}` : p.label(c)
        if (inConflict) inside.add(c.key)
        out.push({ node: c, depth, children, expanded, trail: here })
        if (expanded) walk(c, depth + 1, here, inConflict || rowConflicts.has(c.key))
      }
    }
    walk(root, 0, '', false)
    return { rows: out, insideConflict: inside }
  }, [root, p, isExpanded, rowConflicts])

  return { rows, toggle, changedLeft, changedRight, baseAt, rowConflicts, unplaced, rowResolved, insideConflict, nodes, output: parsedOutput, presentation: p }
}

// ─── Lecture / écriture de la sortie au chemin d'une rangée ─────────────────────────

function identityMatches(x: unknown, id: string): boolean {
  if (isPlainObject(x)) return IDENTITY_KEYS.some(k => (typeof x[k] === 'string' || typeof x[k] === 'number') && String(x[k]) === id)
  return canonical(x) === id
}

const withoutOrder = (v: unknown) => (isPlainObject(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'order')) : v)

/**
 * Path of a row in the output (as `updateOutputAt` takes it), and the value there; `null` when
 * the row has no place in the output (inside a conflict, removed). An element of a list aligned
 * as a whole is found by content — the version of either side (the output may hold the left one
 * as well as the right one), `order` aside — through its row in `nodes`.
 */
export function outputAt(output: unknown, node: DiffNode, nodes?: Map<string, DiffNode>): { path: OutputPath; value: unknown } | null {
  let cur: unknown = output
  const path: OutputPath = []
  for (const [depth, step] of node.path.entries()) {
    if ('k' in step) {
      if (!isPlainObject(cur) || !(step.k in cur)) return null
      path.push(step.k)
      cur = cur[step.k]
      continue
    }
    if (!Array.isArray(cur)) return null
    let i = -1
    if ('id' in step) i = cur.findIndex(x => identityMatches(x, step.id))
    else {
      const element = depth === node.path.length - 1 ? node : nodes?.get(pointer(node.path.slice(0, depth + 1)))
      const versions = element ? [element.hasAfter ? element.after : undefined, element.hasBefore ? element.before : undefined].filter(v => v !== undefined) : []
      i = cur.findIndex(x => versions.some(v => deepEqual(withoutOrder(x), withoutOrder(v))))
    }
    if (i < 0) return null
    path.push(i)
    cur = cur[i]
  }
  return { path, value: cur }
}
