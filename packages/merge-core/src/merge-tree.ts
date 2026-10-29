/// <reference path="./diff3.d.ts" />
import diff3Merge from 'diff3'
import { deepEqual, isPlainObject, orderedKeys } from './object'
import { dumpWithRegions, placeholder, type Pending } from './output'
import { item, key, pos, type NodePath } from './path'
import { canonical, identityOf, listRuleOf, OBJECT_DESC, type ListRule, type StructureDesc } from './structure'
import type { FileKind, FileMerge, MarkerLabels, Side } from './types'

/**
 * GH222 — fusion 3 voies générique d'un document YAML (design §2). Récursive : un nœud modifié
 * d'un seul côté, ou à l'identique des deux, est repris tel quel ; modifié différemment des deux
 * côtés, on descend dans ses enfants (mapping, liste), sauf s'il est atomique pour la description
 * du fichier ou que c'est un scalaire : c'est alors un bloc.
 */

type Obj = Record<string, unknown>
type Slot = { name: string } | 'item'
type AlignedRule = { lcs: true; ignore?: string[]; renumber?: string }

export class MergeContext {
  private pending: Pending[] = []
  private auto: { key: string; from: Side | 'both' }[] = []

  constructor(readonly desc: StructureDesc) {}

  /** Merges one node. `slot` tells how a conflict on it is written: value of the mapping entry
   *  `name`, or list element. Returns the merged value (placeholders for the blocks), `undefined`
   *  when the node is absent from the result. */
  node(path: NodePath, slot: Slot, b: unknown, l: unknown, r: unknown): unknown {
    if (deepEqual(l, r)) {
      if (!deepEqual(l, b)) this.recordAuto(path, b, l, 'both')
      return l
    }
    if (deepEqual(l, b)) { this.recordAuto(path, b, r, 'right'); return r }
    if (deepEqual(r, b)) { this.recordAuto(path, b, l, 'left'); return l }

    const rec = this.desc.reconcile?.(path, b, l, r)
    if (rec) {
      if (path.length > 0) this.auto.push({ key: this.desc.blockKey(path), from: rec.from })
      return rec.value
    }

    if (!this.desc.isAtomic(path)) {
      if (isPlainObject(l) && isPlainObject(r) && (b === undefined || isPlainObject(b))) {
        return this.map(path, (b ?? {}) as Obj, l, r)
      }
      if (Array.isArray(l) && Array.isArray(r) && (b === undefined || Array.isArray(b))) {
        const merged = this.list(path, (b ?? []) as unknown[], l, r)
        if (merged !== 'conflict') return merged
        return this.conflict(slot, `${this.desc.blockKey(path)}~order`, l, r, b)
      }
    }
    return this.conflict(slot, this.desc.blockKey(path), l, r, b)
  }

  /** Merges a whole document whose root is a mapping on every side present. */
  root(b: unknown, l: unknown, r: unknown): unknown {
    return this.map([], (isPlainObject(b) ? b : {}) as Obj, l as Obj, r as Obj)
  }

  /** A block of list elements (`left` / `right` = the elements of each side, maybe none). */
  items(blockKey: string, left: unknown[], right: unknown[], base?: unknown[]): string {
    this.pending.push({ key: blockKey, form: 'items', left, right, ...(base ? { base } : {}) })
    return placeholder(this.pending.length - 1)
  }

  finish(kind: FileKind, value: unknown, labels: MarkerLabels): FileMerge {
    const { output, blocks } = dumpWithRegions(value, this.pending, labels, this.desc.dump)
    return { kind, output, blocks, auto: this.auto }
  }

  private conflict(slot: Slot, blockKey: string, l: unknown, r: unknown, b: unknown): string {
    if (slot === 'item') return this.items(blockKey, l === undefined ? [] : [l], r === undefined ? [] : [r], b === undefined ? [] : [b])
    this.pending.push({ key: blockKey, form: 'entry', name: slot.name, left: l, right: r, base: { value: b } })
    return placeholder(this.pending.length - 1)
  }

  /** Records a value taken from one side, at the level of the file's units: the atomic nodes, or
   *  the members of a mapping taken whole (GH37 reported `fields.priority`, not `fields`). */
  private recordAuto(path: NodePath, b: unknown, v: unknown, from: Side | 'both'): void {
    if (deepEqual(b, v)) return
    const open = path.length > 0 && !this.desc.isAtomic(path)
    if (open && isPlainObject(v) && (b === undefined || isPlainObject(b))) {
      const bo = (b ?? {}) as Obj
      for (const k of new Set([...Object.keys(bo), ...Object.keys(v)])) this.recordAuto([...path, key(k)], bo[k], v[k], from)
      return
    }
    if (path.length > 0) this.auto.push({ key: this.desc.blockKey(path), from })
  }

  private map(path: NodePath, b: Obj, l: Obj, r: Obj): Obj {
    let keys = orderedKeys(r, l, b)
    if (this.desc.sorted?.(path)) keys = [...keys].sort()
    const out: Obj = {}
    for (const k of keys) {
      const v = this.node([...path, key(k)], { name: k }, b[k], l[k], r[k])
      if (v !== undefined) out[k] = v
    }
    return out
  }

  private list(path: NodePath, b: unknown[], l: unknown[], r: unknown[]): unknown[] | 'conflict' {
    const rule = this.desc.listRule?.(path) ?? listRuleOf([b, l, r])
    if ('lcs' in rule) return this.aligned(path, b, l, r, rule)
    // A declared identity that one side does not honor (missing key, duplicate) falls back to
    // aligning the elements as a whole.
    if (!honors(rule, [b, l, r])) return this.aligned(path, b, l, r, { lcs: true })
    return this.identified(path, b, l, r, rule)
  }

  private identified(path: NodePath, b: unknown[], l: unknown[], r: unknown[], rule: ListRule): unknown[] | 'conflict' {
    const byId = (list: unknown[]) => new Map(list.map(x => [identityOf(rule, x), x]))
    const [bm, lm, rm] = [byId(b), byId(l), byId(r)]
    const order = mergedOrder([...bm.keys()], [...lm.keys()], [...rm.keys()], 'insert' in rule && rule.insert ? rule.insert : 'after')
    if (order === 'conflict') return order
    const out: unknown[] = []
    for (const id of order) {
      const v = this.node([...path, item(id)], 'item', bm.get(id), lm.get(id), rm.get(id))
      if (v !== undefined) out.push(v)
    }
    return out
  }

  /** Elements aligned as a whole (`diff3` on their canonical text — the library git uses for
   *  lines): disjoint changes merge, a range changed differently on both sides is one block. */
  private aligned(path: NodePath, b: unknown[], l: unknown[], r: unknown[], rule: AlignedRule): unknown[] {
    const value = new Map<string, unknown>()
    const canon = (list: unknown[]) => list.map(x => {
      const c = canonical(x, rule.ignore)
      if (!value.has(c)) value.set(c, x)
      return c
    })
    // Right first: an element equal up to the ignored keys keeps the destination's version.
    const rc = canon(r)
    const lc = canon(l)
    const bc = canon(b)
    const out: unknown[] = []
    for (const chunk of diff3Merge(lc, bc, rc)) {
      if (chunk.ok) {
        for (const c of chunk.ok) out.push(value.get(c))
        continue
      }
      const blockKey = this.desc.blockKey([...path, pos(out.length)])
      out.push(this.items(blockKey, chunk.conflict.a.map(c => value.get(c)), chunk.conflict.b.map(c => value.get(c)), chunk.conflict.o.map(c => value.get(c))))
    }
    if (rule.renumber) renumber(out, rule.renumber)
    return out
  }
}

function honors(rule: ListRule, sides: unknown[][]): boolean {
  return sides.every(list => {
    if ('by' in rule) {
      const ids = list.map(x => (isPlainObject(x) ? x[rule.by] : undefined))
      if (ids.some(v => typeof v !== 'string' && typeof v !== 'number')) return false
      return new Set(ids.map(String)).size === ids.length
    }
    return new Set(list.map(x => canonical(x))).size === list.length
  })
}

/**
 * Output order of identified elements: the order of the side that reordered the common elements
 * (the destination's when neither or both did), then the elements of the other side inserted after
 * their predecessor there — or at the end (`insert: 'end'`). Both sides reordering the common
 * elements differently is an order conflict.
 */
export function mergedOrder(bIds: string[], lIds: string[], rIds: string[], insert: 'end' | 'after'): string[] | 'conflict' {
  const inAll = new Set(bIds.filter(id => lIds.includes(id) && rIds.includes(id)))
  const common = (ids: string[]) => ids.filter(id => inAll.has(id)).join('\u0000')
  const [bo, lo, ro] = [common(bIds), common(lIds), common(rIds)]
  if (lo !== bo && ro !== bo && lo !== ro) return 'conflict'
  const [primary, secondary] = lo !== bo && ro === bo ? [lIds, rIds] : [rIds, lIds]
  const seq = [...primary]
  for (let i = 0; i < secondary.length; i++) {
    const id = secondary[i]
    if (seq.includes(id)) continue
    if (insert === 'end') { seq.push(id); continue }
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const p = seq.indexOf(secondary[j])
      if (p >= 0) { at = p + 1; break }
    }
    seq.splice(at, 0, id)
  }
  // Elements only in the base (removed on both sides) are in neither list: nothing to add.
  return seq
}

/** Sets `<field>: <position>` (1-based) on the elements that carry it (test steps' `order`).
 *  Elements still inside a block are numbered when the output is finalized (`canonicalOutput`). */
export function renumber(list: unknown[], field: string): void {
  list.forEach((x, i) => {
    if (isPlainObject(x) && field in x) list[i] = { ...x, [field]: i + 1 }
  })
}

/** 3-way merge of parsed YAML documents whose root is a mapping (`base` undefined = added on both
 *  sides). */
export function mergeTree(
  kind: FileKind, desc: StructureDesc, base: unknown, left: unknown, right: unknown, labels: MarkerLabels,
): FileMerge {
  const ctx = new MergeContext(desc)
  return ctx.finish(kind, ctx.root(base, left, right), labels)
}

/** Field-level 3-way merge of a typed object (GH37 design §2.1), on the generic engine. */
export function mergeObject(base: Obj | null, left: Obj, right: Obj, labels: MarkerLabels): FileMerge {
  return mergeTree('object', OBJECT_DESC, base ?? undefined, left, right, labels)
}
