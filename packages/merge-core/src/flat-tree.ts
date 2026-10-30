import { deepEqual, isPlainObject } from './object'
import { MergeContext, mergedOrder } from './merge-tree'
import { item, key } from './path'
import { genericDesc, type StructureDesc } from './structure'
import type { FileMerge, MarkerLabels } from './types'

/**
 * GH222 — arbres d'affichage `.polenta/trees/**` (`{ nodeId, typeId, root: TypeTreeNode[] }`,
 * nœuds `{ id, kind, objectId?, children }` imbriqués). Fusionnés **à plat** : chaque nœud a un
 * parent et des propriétés, fusionnés par `id`. Un nœud déplacé sous deux parents différents est un
 * conflit de position `pos:<id>` : deux régions de même clé, une à chaque place, qu'un seul choix
 * résout ensemble (`resolveRegion` traite toutes les régions d'une clé). Ainsi aucun choix ne peut
 * dupliquer ni perdre le nœud. Un cas qui ne se laisse pas écrire ainsi (cycle, conflit de position
 * dans le sous-arbre d'un autre) devient un seul bloc sur toute la liste `root`.
 */

type Obj = Record<string, unknown>
type Flat = { parent: string; props: Obj }
const ROOT = ''

export function isTreeFile(path: string | undefined): boolean {
  return !!path && /(^|\/)\.polenta\/trees\/.+\.ya?ml$/.test(path.split('\\').join('/'))
}

function validNodes(list: unknown): boolean {
  return Array.isArray(list) && list.every(n => isPlainObject(n) && typeof n.id === 'string'
    && (n.children === undefined || validNodes(n.children)))
}

/** `{ root: [...] }` with well-formed nodes and unique ids. */
export function isTreeDoc(v: unknown): v is Obj {
  if (!isPlainObject(v) || !validNodes(v.root)) return false
  const ids: string[] = []
  const walk = (list: Obj[]) => list.forEach(n => { ids.push(n.id as string); walk((n.children ?? []) as Obj[]) })
  walk(v.root as Obj[])
  return new Set(ids).size === ids.length
}

function flatten(doc: Obj | undefined): { nodes: Map<string, Flat>; siblings: Map<string, string[]> } {
  const nodes = new Map<string, Flat>()
  const siblings = new Map<string, string[]>()
  const walk = (list: Obj[], parent: string) => {
    siblings.set(parent, list.map(n => n.id as string))
    for (const n of list) {
      const { children, ...props } = n
      nodes.set(n.id as string, { parent, props })
      walk((children ?? []) as Obj[], n.id as string)
    }
  }
  if (doc) walk(doc.root as Obj[], ROOT)
  return { nodes, siblings }
}

const TREE_DESC: StructureDesc = {
  ...genericDesc(),
  blockKey: p => (p.length === 3 && 'id' in p[1] && 'k' in p[2] ? `node:${p[1].id}/${p[2].k}` : genericDesc().blockKey(p)),
}

export function mergeTreeFile(base: Obj | undefined, left: Obj, right: Obj, labels: MarkerLabels): FileMerge {
  const b = flatten(base)
  const l = flatten(left)
  const r = flatten(right)
  const ctx = new MergeContext(TREE_DESC)

  // Header (nodeId, typeId…): ordinary entries.
  const header: Obj = {}
  for (const k of new Set([...Object.keys(right), ...Object.keys(left), ...Object.keys(base ?? {})])) {
    if (k === 'root') { header.root = []; continue }
    const v = ctx.node([key(k)], { name: k }, base?.[k], left[k], right[k])
    if (v !== undefined) header[k] = v
  }

  // Parent of each node: undefined = absent (deleted); a position conflict keeps both places.
  const ids = [...new Set([...r.nodes.keys(), ...l.nodes.keys(), ...b.nodes.keys()])]
  const parent = new Map<string, string>()
  const conflicted = new Map<string, { left?: string; right?: string }>()
  const props = new Map<string, Obj>()
  for (const id of ids) {
    const [bp, lp, rp] = [b.nodes.get(id)?.parent, l.nodes.get(id)?.parent, r.nodes.get(id)?.parent]
    const [bo, lo, ro] = [b.nodes.get(id)?.props, l.nodes.get(id)?.props, r.nodes.get(id)?.props]
    let p: string | undefined
    if (lp === rp) p = lp
    else if (lp === bp) p = rp
    else if (rp === bp) p = lp
    else conflicted.set(id, { left: lp, right: rp })
    // Deleted on one side, edited on the other: a conflict, as for any other node.
    if (p === undefined && bp !== undefined && !conflicted.has(id)
      && ((lp === undefined && rp !== undefined && !deepEqual(ro, bo)) || (rp === undefined && lp !== undefined && !deepEqual(lo, bo)))) {
      conflicted.set(id, { left: lp, right: rp })
    }
    if (p !== undefined) parent.set(id, p)
    const kept = p !== undefined || conflicted.has(id)
    if (!kept) continue
    const out: Obj = {}
    for (const k of new Set([...Object.keys(ro ?? {}), ...Object.keys(lo ?? {}), ...Object.keys(bo ?? {})])) {
      // A node present on one side only (moved/kept against a deletion) keeps that side's props.
      const v = lo && ro
        ? ctx.node([key('nodes'), item(id), key(k)], { name: k }, bo?.[k], lo[k], ro[k])
        : (lo ?? ro)![k]
      if (v !== undefined) out[k] = v
    }
    props.set(id, out)
  }
  // A node left under a deleted parent goes to the root — a conflicting place too.
  const present = (p: string | undefined) => p === undefined || p === ROOT || parent.has(p) || conflicted.has(p)
  for (const [id, p] of parent) if (!present(p)) parent.set(id, ROOT)
  for (const [id, c] of conflicted) {
    const places = { left: present(c.left) ? c.left : ROOT, right: present(c.right) ? c.right : ROOT }
    if (places.left === places.right) { conflicted.delete(id); parent.set(id, places.left!) }
    else conflicted.set(id, places)
  }

  let unwritable = false
  const visited = new Set<string>()
  const subtree = (id: string): Obj => {
    visited.add(id)
    return { ...props.get(id), children: build(id) }
  }
  const build = (p: string): unknown[] => {
    const under = (side: Map<string, string[]>) => side.get(p) ?? []
    let order = mergedOrder(under(b.siblings), under(l.siblings), under(r.siblings), 'after')
    // Two different reorderings of the same siblings: the destination's order (no order block
    // for display trees — the placement is what matters).
    if (order === 'conflict') order = under(r.siblings)
    const listed = new Set(order)
    const placedHere = (id: string) => parent.get(id) === p || conflicted.get(id)?.left === p || conflicted.get(id)?.right === p
    const here = [...order, ...ids.filter(id => !listed.has(id) && placedHere(id))]
    const out: unknown[] = []
    for (const id of here) {
      const c = conflicted.get(id)
      if (c && (c.left === p || c.right === p)) {
        const node = subtree(id)
        if (JSON.stringify(node).includes('__POLENTA_MERGE_')) unwritable = true
        out.push(ctx.items(`pos:${id}`, c.left === p ? [node] : [], c.right === p ? [node] : []))
      } else if (!c && parent.get(id) === p) {
        out.push(subtree(id))
      }
    }
    return out
  }
  header.root = build(ROOT)
  // A node never reached from the root sits in a cycle.
  for (const id of [...parent.keys(), ...conflicted.keys()]) if (!visited.has(id)) unwritable = true

  if (unwritable) {
    const whole = new MergeContext({ ...genericDesc(), isAtomic: p => p.length === 1 && 'k' in p[0] && p[0].k === 'root' })
    return whole.finish('trees', whole.root(base, left, right), labels)
  }
  return ctx.finish('trees', header, labels)
}
