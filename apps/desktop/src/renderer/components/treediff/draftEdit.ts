import yaml from 'js-yaml'
import { isPlainObject, pointer, type DiffNode } from '@polenta/merge-core'
import { outputAt } from './mergeModel'

/**
 * GH222 sprint 5 — modifications du côté Après d'un diff de modification locale (spec §12), sur le
 * texte du brouillon (sans région de marqueurs) : valeur d'une rangée, « Rétablir » (la valeur
 * d'Avant), « Ajouter » (élément de liste, entrée de mapping). Chaque fonction relit le brouillon,
 * le modifie au chemin de la rangée et le réécrit dans le style YAML du fichier ; `null` quand la
 * rangée n'a pas de place dans le brouillon.
 */

type Obj = Record<string, unknown>

function rewrite(text: string, opts: yaml.DumpOptions, fn: (root: unknown) => boolean): string | null {
  let root: unknown
  try {
    root = yaml.load(text)
  } catch {
    return null
  }
  return fn(root) ? yaml.dump(root, opts) : null
}

function containerAt(root: unknown, path: (string | number)[]): unknown {
  let cur = root
  for (const step of path) cur = (cur as Record<string | number, unknown>)?.[step]
  return cur
}

/** Sets the value of a row present in the draft (`undefined` removes it). */
export function setRowValue(text: string, node: DiffNode, nodes: Map<string, DiffNode>, value: unknown, opts: yaml.DumpOptions): string | null {
  return rewrite(text, opts, root => {
    const at = outputAt(root, node, nodes)
    if (!at || at.path.length === 0) return false
    const parent = containerAt(root, at.path.slice(0, -1))
    const last = at.path[at.path.length - 1]
    if (Array.isArray(parent) && typeof last === 'number') {
      if (value === undefined) parent.splice(last, 1)
      else parent[last] = value
      return true
    }
    if (!isPlainObject(parent) || typeof last !== 'string') return false
    if (value === undefined) delete parent[last]
    else parent[last] = value
    return true
  })
}

/**
 * « Rétablir » : the row gets back its value of Avant — changed back, removed when it was added,
 * put back when it was removed (in its list, after the siblings that precede it in the diff).
 */
export function restoreRow(text: string, node: DiffNode, nodes: Map<string, DiffNode>, opts: yaml.DumpOptions): string | null {
  if (node.hasAfter) return setRowValue(text, node, nodes, node.hasBefore ? node.before : undefined, opts)
  if (!node.hasBefore) return null
  const parentNode = nodes.get(pointer(node.path.slice(0, -1)))
  if (!parentNode) return null
  return rewrite(text, opts, root => {
    const parentAt = node.path.length === 1 ? { path: [], value: root } : outputAt(root, parentNode, nodes)
    if (!parentAt) return false
    const container = parentAt.value
    const last = node.path[node.path.length - 1]
    if ('k' in last) {
      if (!isPlainObject(container)) return false
      container[last.k] = node.before
      return true
    }
    if (!Array.isArray(container)) return false
    // Place: after the siblings of Avant that are still in the draft.
    const siblings = parentNode.children ?? []
    let at = 0
    for (const s of siblings) {
      if (s.key === node.key) break
      if (s.hasAfter && outputAt(root, s, nodes)) at++
    }
    container.splice(Math.min(at, container.length), 0, node.before)
    return true
  })
}

/** « Ajouter » under a list (a copy of its last element, or an empty one) or a mapping (`key`). */
export function addUnder(text: string, node: DiffNode, nodes: Map<string, DiffNode>, opts: yaml.DumpOptions, key?: string): string | null {
  return rewrite(text, opts, root => {
    const at = node.path.length === 0 ? { path: [], value: root } : outputAt(root, node, nodes)
    if (!at) return false
    const container = at.value
    if (Array.isArray(container)) {
      const lastItem = container[container.length - 1]
      const added = lastItem === undefined ? '' : blankLike(lastItem)
      // A test step is numbered by its place.
      if (isPlainObject(added) && 'order' in added) added.order = container.length + 1
      container.push(added)
      return true
    }
    if (!isPlainObject(container) || !key || key in container) return false
    ;(container as Obj)[key] = ''
    return true
  })
}

/** A new element shaped like `v`: a mapping with the same keys, empty values; a scalar emptied. */
function blankLike(v: unknown): unknown {
  if (isPlainObject(v)) return Object.fromEntries(Object.keys(v).map(k => [k, typeof v[k] === 'number' ? 0 : '']))
  if (Array.isArray(v)) return []
  return typeof v === 'number' ? 0 : ''
}
