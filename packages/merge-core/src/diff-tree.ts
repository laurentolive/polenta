import { deepEqual, isPlainObject, orderedKeys } from './object'
import { item, key, pointer, pos, type NodePath } from './path'
import { canonical, identityOf, listRuleOf, type ListRule, type StructureDesc } from './structure'

/**
 * GH222 — diff 2 voies générique d'un document YAML : un arbre de nœuds alignés entre les deux
 * versions, que la vue générique affiche une rangée par nœud (colonne Structure + valeurs).
 */

export type DiffState = 'unchanged' | 'added' | 'removed' | 'modified' | 'moved'
export type NodeKind = 'map' | 'list' | 'scalar' | 'text'

export interface DiffNode {
  path: NodePath
  /** Pointer of the path — stable key of the node (folding, scroll anchor, navigation). */
  key: string
  /** Mapping key, identity of an element, or position (`#2`, 1-based) of an element. */
  label: string
  kind: NodeKind
  state: DiffState
  /** Values of each version (`hasBefore` / `hasAfter` false = absent from that version). */
  before?: unknown
  after?: unknown
  hasBefore: boolean
  hasAfter: boolean
  children?: DiffNode[]
  /** Changed leaves below (itself included for a leaf). */
  changedCount: number
  /** `moved`: key of the node at the other place. */
  movedPeer?: string
  /** Element of a list aligned as a whole: its index in each version (`null` = absent there). */
  indexes?: [number | null, number | null]
}

type Obj = Record<string, unknown>

function kindOf(v: unknown): NodeKind {
  if (isPlainObject(v)) return 'map'
  if (Array.isArray(v)) return 'list'
  return typeof v === 'string' && v.includes('\n') ? 'text' : 'scalar'
}

/** Pairs of indexes aligning two sequences of keys: the longest common subsequence, then — when
 *  `pairLeftovers` — the elements left between two anchors paired by position (a changed element
 *  shows as modified rather than removed + added). */
export function alignSequences(a: string[], b: string[], pairLeftovers: boolean): [number | null, number | null][] {
  const n = a.length
  const m = b.length
  const lcs = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = a[i] === b[j] ? lcs[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1])
    }
  }
  const rows: [number | null, number | null][] = []
  let i = 0
  let j = 0
  let gapA: number[] = []
  let gapB: number[] = []
  const flush = () => {
    const paired = pairLeftovers ? Math.min(gapA.length, gapB.length) : 0
    for (let k = 0; k < paired; k++) rows.push([gapA[k], gapB[k]])
    for (let k = paired; k < gapA.length; k++) rows.push([gapA[k], null])
    for (let k = paired; k < gapB.length; k++) rows.push([null, gapB[k]])
    gapA = []
    gapB = []
  }
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); rows.push([i, j]); i++; j++ }
    else if (j < m && (i === n || lcs[i * (m + 1) + j + 1] >= lcs[(i + 1) * (m + 1) + j])) { gapB.push(j); j++ }
    else { gapA.push(i); i++ }
  }
  flush()
  return rows
}

class Differ {
  constructor(private desc: StructureDesc | undefined) {}

  node(path: NodePath, label: string, a: unknown, b: unknown, hasA: boolean, hasB: boolean): DiffNode {
    const base = { path, key: pointer(path), label, hasBefore: hasA, hasAfter: hasB, before: a, after: b }
    if (!hasA || !hasB) {
      const v = hasA ? a : b
      const state = hasA ? 'removed' : 'added'
      const children = this.childrenOf(path, v, hasA)
      return { ...base, kind: kindOf(v), state, children, changedCount: children ? sum(children) : 1 }
    }
    const kind = kindOf(b)
    if (deepEqual(a, b)) {
      const children = this.childrenOf(path, b, null)
      return { ...base, kind, state: 'unchanged', children, changedCount: 0 }
    }
    let children: DiffNode[] | undefined
    if (isPlainObject(a) && isPlainObject(b)) {
      children = orderedKeys(b, a).map(k => this.node([...path, key(k)], k, a[k], b[k], k in a, k in b))
    } else if (Array.isArray(a) && Array.isArray(b)) {
      children = this.list(path, a, b)
    }
    return { ...base, kind, state: 'modified', children, changedCount: children ? sum(children) : 1 }
  }

  /** Children of a value present on one side only (`side` true = before) or unchanged (`null`). */
  private childrenOf(path: NodePath, v: unknown, side: boolean | null): DiffNode[] | undefined {
    const mk = (p: NodePath, label: string, x: unknown) =>
      this.node(p, label, side === false ? undefined : x, side === true ? undefined : x, side !== false, side !== true)
    if (isPlainObject(v)) return Object.keys(v).map(k => mk([...path, key(k)], k, v[k]))
    if (Array.isArray(v)) {
      const rule = this.rule(path, [v])
      // Aligned elements keep their index on each side present (step numbers).
      const indexes = (i: number): [number | null, number | null] => [side === false ? null : i, side === true ? null : i]
      return v.map((x, i) => ('lcs' in rule
        ? { ...mk([...path, pos(i)], `#${i + 1}`, x), indexes: indexes(i) }
        : mk([...path, item(identityOf(rule, x))], identityOf(rule, x), x)))
    }
    return undefined
  }

  private rule(path: NodePath, sides: unknown[][]): ListRule {
    const declared = this.desc?.listRule?.(path)
    const rule = declared ?? listRuleOf(sides)
    if ('lcs' in rule) return rule
    const ok = sides.every(list => new Set(list.map(x => identityOf(rule, x))).size === list.length
      && ('by' in rule ? list.every(x => isPlainObject(x) && x[rule.by] !== undefined) : true))
    return ok ? rule : { lcs: true }
  }

  private list(path: NodePath, a: unknown[], b: unknown[]): DiffNode[] {
    const rule = this.rule(path, [a, b])
    if (!('lcs' in rule)) {
      const am = new Map(a.map(x => [identityOf(rule, x), x]))
      const bm = new Map(b.map(x => [identityOf(rule, x), x]))
      // After's order, then the removed elements after their predecessor in before.
      const seq = [...bm.keys()]
      const aIds = [...am.keys()]
      aIds.forEach((id, i) => {
        if (bm.has(id)) return
        let at = 0
        for (let j = i - 1; j >= 0; j--) { const p = seq.indexOf(aIds[j]); if (p >= 0) { at = p + 1; break } }
        seq.splice(at, 0, id)
      })
      return seq.map(id => this.node([...path, item(id)], id, am.get(id), bm.get(id), am.has(id), bm.has(id)))
    }
    const ignore = 'ignore' in rule ? rule.ignore : undefined
    const [ac, bc] = [a.map(x => canonical(x, ignore)), b.map(x => canonical(x, ignore))]
    // Keyed by row: a removed element and the next kept one would otherwise share an index.
    return alignSequences(ac, bc, true).map(([i, j], row) => {
      const p = [...path, pos(row)]
      const label = `#${(j ?? i!) + 1}`
      // Equal but for the ignored keys (a step whose `order` moved): unchanged.
      const indexes: [number | null, number | null] = [i, j]
      if (i !== null && j !== null && ac[i] === bc[j]) {
        return { ...this.node(p, label, b[j], b[j], true, true), before: a[i], indexes }
      }
      return { ...this.node(p, label, i === null ? undefined : a[i], j === null ? undefined : b[j], i !== null, j !== null), indexes }
    })
  }
}

function sum(children: DiffNode[]): number {
  return children.reduce((n, c) => n + c.changedCount, 0)
}

/** Marks as `moved` an element identified by its `id` removed from a list and added to a list of
 *  the same name elsewhere (display trees: an object moved under another folder). Elements of
 *  unrelated lists that merely share an identity (an enum value) are not paired. */
function markMoves(root: DiffNode): void {
  const removed = new Map<string, DiffNode[]>()
  const added = new Map<string, DiffNode[]>()
  const walk = (n: DiffNode) => {
    const last = n.path[n.path.length - 1]
    const list = n.path[n.path.length - 2]
    const v = n.state === 'removed' ? n.before : n.after
    if (last && 'id' in last && list && 'k' in list && isPlainObject(v) && String(v.id) === last.id
      && (n.state === 'removed' || n.state === 'added')) {
      const m = n.state === 'removed' ? removed : added
      // A display tree's top level (`root`) and a folder's content (`children`) are one family.
      const k = `${list.k === 'root' ? 'children' : list.k}\u0000${last.id}`
      m.set(k, [...(m.get(k) ?? []), n])
    }
    n.children?.forEach(walk)
  }
  walk(root)
  for (const [id, rs] of removed) {
    const as = added.get(id)
    if (rs.length !== 1 || as?.length !== 1) continue
    const [from, to] = [rs[0], as[0]]
    from.state = 'moved'
    to.state = 'moved'
    from.movedPeer = to.key
    to.movedPeer = from.key
  }
}

/** 2-way diff of two parsed YAML documents (`undefined` = file absent from that version). */
export function diffTree(before: unknown, after: unknown, desc?: StructureDesc): DiffNode {
  const root = new Differ(desc).node([], '', before, after, before !== undefined, after !== undefined)
  markMoves(root)
  return root
}
