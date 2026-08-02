import type { SystemNode } from './schema'

// ── SystemNode tree traversal (T123) ──────────────────────────────────────────
//
// SystemNode.children lets a repo nest local components at unlimited depth
// (root's siblings, and any local component's own children). These helpers
// centralize the recursive traversal so it isn't duplicated across the main
// process (schema.service.ts, schema-lookup.util.ts) and the renderer
// (SystemViewContext.tsx, useWorkspaceStructure.ts) — this package has no
// Node.js dependency, so it's importable from both.

/** Recursive lookup by name anywhere in the SystemNode tree (root + local descendants). */
export function findSystemNode(nodes: SystemNode[], name: string): SystemNode | undefined {
  for (const n of nodes) {
    if (n.name === name) return n
    const found = findSystemNode(n.children ?? [], name)
    if (found) return found
  }
  return undefined
}

/** A SystemNode flattened out of the tree, with the chain of its ancestors (from the top-level
 *  array down to — but excluding — the node itself; `root` included like any other ancestor).
 *  Callers building a user-facing path label (e.g. the "Composant" combobox, Sprint 3) are
 *  expected to drop a leading `root` themselves — it's already represented by the owning repo's
 *  own name in the UI, cf. specs/T123-design.md §9. */
export interface FlatSystemNode {
  node: SystemNode
  ancestors: SystemNode[]
}

/** Flattens the tree in pre-order, pairing each node with its ancestor chain. */
export function flattenSystemNodes(nodes: SystemNode[], ancestors: SystemNode[] = []): FlatSystemNode[] {
  const out: FlatSystemNode[] = []
  for (const n of nodes) {
    out.push({ node: n, ancestors })
    out.push(...flattenSystemNodes(n.children ?? [], [...ancestors, n]))
  }
  return out
}

/** Immutably replaces the node named `targetName` (wherever it is in the tree) with `fn(node)`.
 *  A no-op (same array reference returned) if `targetName` isn't found — callers that need to
 *  distinguish "not found" should check with `findSystemNode` first. */
export function mapSystemNode(
  nodes: SystemNode[],
  targetName: string,
  fn: (node: SystemNode) => SystemNode,
): SystemNode[] {
  return nodes.map(n => {
    if (n.name === targetName) return fn(n)
    if (!n.children?.length) return n
    const children = mapSystemNode(n.children, targetName, fn)
    return children === n.children ? n : { ...n, children }
  })
}

/** Immutably removes the node named `targetName` from the tree, along with its whole subtree. */
export function removeSystemNode(nodes: SystemNode[], targetName: string): SystemNode[] {
  return nodes
    .filter(n => n.name !== targetName)
    .map(n => (!n.children?.length ? n : { ...n, children: removeSystemNode(n.children, targetName) }))
}

/** Counts local sub-components in a node's own subtree (the node itself not included) — used to
 *  word the cascade-delete confirmation (Sprint 2). Element counts (requirements/tests/
 *  campaigns) aren't stored in schema.yaml/SystemNode and aren't covered by this helper — the
 *  confirmation only names the sub-component count, cf. specs/T123-sprint2.md divergence. */
export function countSubComponents(node: SystemNode): number {
  const children = node.children ?? []
  return children.reduce((acc, child) => acc + 1 + countSubComponents(child), 0)
}

// ── Drag & drop reordering (T135) ──────────────────────────────────────────────

/** Reorders `keys` (a stable per-item identity — a name, or an original index captured before
 *  any mutation) so `draggedKey` ends up immediately before/after `targetKey`, matching the drop
 *  convention used throughout the Structure tab's drag & drop: filter the dragged key out, locate
 *  the target among what's left, insert before or after it. No-op (same array, by value) if
 *  either key is missing from `keys` or they're the same key. */
export function reorderByKey<K>(keys: K[], draggedKey: K, targetKey: K, position: 'before' | 'after'): K[] {
  if (draggedKey === targetKey || !keys.includes(draggedKey) || !keys.includes(targetKey)) return keys
  const rest = keys.filter(k => k !== draggedKey)
  const targetIdx = rest.indexOf(targetKey)
  const insertAt = position === 'before' ? targetIdx : targetIdx + 1
  rest.splice(insertAt, 0, draggedKey)
  return rest
}

/**
 * Reorders local components (`SystemNode`s) among their siblings by drag & drop (T135). `parentName`
 * identifies the sibling *group* being reordered, not a rendering position — `null` means the
 * top-level siblings of `root` in `nodes` itself (root is excluded from the reorder and always
 * kept in place; nothing else lives outside `root`/`children[]` at that level); a real name means
 * that node's own `children[]`.
 *
 * Important: a component nested in `root`'s own `children[]` (T123, e.g. added via the MCP
 * `add_component` tool with `parentName: 'root'`) is a *different* group from the top-level
 * siblings of `root` — reorder it by passing `parentName: 'root'`, not `null` — even though the
 * Structure tab renders both as one merged visual list (`rootNode.children` then top-level
 * `schema.nodes`, cf. `StructureTab.tsx`'s `RepoRow`). They're two distinct underlying arrays;
 * mixing them into a single reorder can't be expressed by (and must not be attempted through)
 * this function — the caller is responsible for tagging each row with its real origin group.
 */
export function reorderSystemNodes(
  nodes: SystemNode[], parentName: string | null, draggedName: string, targetName: string, position: 'before' | 'after',
): SystemNode[] {
  if (parentName !== null) {
    return mapSystemNode(nodes, parentName, p => {
      const children = p.children ?? []
      const byName = new Map(children.map(c => [c.name, c]))
      const reorderedNames = reorderByKey(children.map(c => c.name), draggedName, targetName, position)
      return { ...p, children: reorderedNames.map(n => byName.get(n)!) }
    })
  }

  const topLevel = nodes.filter(n => n.name !== 'root')
  const byName = new Map(topLevel.map(n => [n.name, n]))
  const reorderedNames = reorderByKey(topLevel.map(n => n.name), draggedName, targetName, position)
  const reorderedTopLevel = reorderedNames.map(n => byName.get(n)!)
  const rootNode = nodes.find(n => n.name === 'root')
  return rootNode ? [rootNode, ...reorderedTopLevel] : reorderedTopLevel
}

// ── Drag & drop reparenting (T135 sprint 2) ─────────────────────────────────────

/** True when `candidateName` is `ancestorName` itself or lives anywhere in its subtree
 *  (`children[]`, at any depth) — the anti-cycle guard `moveSystemNode` needs before letting a
 *  local component be dropped onto one of its own descendants (it would otherwise detach its own
 *  parent chain from the tree). */
export function isDescendant(nodes: SystemNode[], ancestorName: string, candidateName: string): boolean {
  if (ancestorName === candidateName) return true
  const ancestor = findSystemNode(nodes, ancestorName)
  if (!ancestor) return false
  return findSystemNode(ancestor.children ?? [], candidateName) !== undefined
}

/**
 * Moves a local component (with its whole subtree) to become the last child of `toParentName`
 * (or a top-level sibling of `root`, appended last, if `toParentName` is `null`) — T135 sprint 2,
 * "drop onto a folder row to reparent". No-op (same array, by value) if `name` isn't found, if
 * `toParentName === name` (can't become its own parent), if `toParentName` doesn't exist in the
 * tree at all, or if `toParentName` is one of `name`'s own descendants (`isDescendant` — would
 * otherwise silently detach the moved subtree, since `removeSystemNode` below deletes it as part
 * of `toParentName`'s own subtree before it can be reinserted).
 *
 * The existence check matters on its own, separately from the cycle check: `removeSystemNode`
 * unconditionally deletes `name` first, and `mapSystemNode` silently no-ops when `toParentName`
 * isn't found (by design, for callers that already know it exists) — without checking here first,
 * a `toParentName` that's gone stale (e.g. its own row was deleted in a race with this drop) would
 * make the moved node, and its whole subtree, vanish: removed from its old spot, never reinserted
 * anywhere.
 */
export function moveSystemNode(nodes: SystemNode[], name: string, toParentName: string | null): SystemNode[] {
  if (name === toParentName) return nodes
  if (toParentName !== null && (isDescendant(nodes, name, toParentName) || !findSystemNode(nodes, toParentName))) return nodes
  const moving = findSystemNode(nodes, name)
  if (!moving) return nodes

  const withoutMoving = removeSystemNode(nodes, name)
  if (toParentName === null) return [...withoutMoving, moving]
  return mapSystemNode(withoutMoving, toParentName, p => ({ ...p, children: [...(p.children ?? []), moving] }))
}
