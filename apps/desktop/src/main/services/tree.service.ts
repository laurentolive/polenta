import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { randomUUID } from 'crypto'
import type { TypeTree, TypeTreeNode } from '@polenta/types'

export class TreeService {
  // ── Read ─────────────────────────────────────────────────────────────────────

  async get(repoPath: string, nodeId: string, typeId: string): Promise<TypeTree> {
    const filePath = this.treePath(repoPath, nodeId, typeId)
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      const parsed = yaml.load(raw) as TypeTree
      if (!parsed || !Array.isArray(parsed.root)) {
        return this.empty(nodeId, typeId)
      }
      return parsed
    } catch {
      return this.empty(nodeId, typeId)
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────────────

  async save(repoPath: string, tree: TypeTree): Promise<void> {
    const filePath = this.treePath(repoPath, tree.nodeId, tree.typeId)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, yaml.dump(tree, { lineWidth: 120 }), 'utf-8')
  }

  /**
   * Moves the display-order file for one (node, type) pair to a different node (T135 sprint 3 —
   * an element dragged onto another node in the Structure tab). Without this, the curated
   * folder/order tree a user built for that type (Vue Système) would be silently orphaned at the
   * old node/type path — the type itself moved, but its saved layout wouldn't follow it, and the
   * new node/type location would start from an empty tree (`get()`'s fallback for a missing file)
   * as if the user had never organized anything.
   *
   * No-op if `fromNodeId === toNodeId` or if the old file never existed/was already empty (an
   * empty tree carries no user-authored ordering worth moving). Best-effort: a failure here is
   * logged, not thrown — losing the curated order is a UX regression, not the kind of data-loss
   * `objectTypeRef` correctness demands, so it must never block the rest of an element move.
   */
  async moveTypeTree(repoPath: string, fromNodeId: string, toNodeId: string, typeId: string): Promise<void> {
    if (fromNodeId === toNodeId) return
    try {
      const existing = await this.get(repoPath, fromNodeId, typeId)
      if (existing.root.length > 0) {
        await this.save(repoPath, { nodeId: toNodeId, typeId, root: existing.root })
      }
      await fs.unlink(this.treePath(repoPath, fromNodeId, typeId)).catch(() => {})
    } catch (err) {
      console.error(`[TreeService] Could not move display order for ${typeId} from ${fromNodeId} to ${toNodeId}:`, err)
    }
  }

  // ── ID generation ─────────────────────────────────────────────────────────────

  generateId(): string {
    return randomUUID()
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private treePath(repoPath: string, nodeId: string, typeId: string): string {
    return path.join(repoPath, '.polenta', 'trees', nodeId, `${typeId}.yaml`)
  }

  private empty(nodeId: string, typeId: string): TypeTree {
    return { nodeId, typeId, root: [] }
  }
}

// ── Pure tree manipulation helpers (shared logic used by IPC handlers) ─────────

export function insertNode(
  root: TypeTreeNode[],
  newNode: TypeTreeNode,
  parentId: string | null,
  afterId: string | null,
): TypeTreeNode[] {
  if (parentId === null) {
    return insertAfter(root, newNode, afterId)
  }
  return root.map(n => {
    if (n.id === parentId) {
      return { ...n, children: insertAfter(n.children, newNode, afterId) }
    }
    return { ...n, children: insertNode(n.children, newNode, parentId, afterId) }
  })
}

function insertAfter(list: TypeTreeNode[], node: TypeTreeNode, afterId: string | null): TypeTreeNode[] {
  if (afterId === null) return [...list, node]
  const idx = list.findIndex(n => n.id === afterId)
  if (idx === -1) return [...list, node]
  const next = [...list]
  next.splice(idx + 1, 0, node)
  return next
}

export function removeNode(root: TypeTreeNode[], id: string): TypeTreeNode[] {
  return root
    .filter(n => n.id !== id)
    .map(n => ({ ...n, children: removeNode(n.children, id) }))
}

export function renameNode(root: TypeTreeNode[], id: string, name: string): TypeTreeNode[] {
  return root.map(n => {
    if (n.id === id) return { ...n, name }
    return { ...n, children: renameNode(n.children, id, name) }
  })
}

export function moveNodes(
  root: TypeTreeNode[],
  ids: string[],
  parentId: string | null,
  afterId: string | null,
): TypeTreeNode[] {
  // Collect nodes to move (preserving tree order)
  const collected: TypeTreeNode[] = []
  function collect(list: TypeTreeNode[]): TypeTreeNode[] {
    const result: TypeTreeNode[] = []
    for (const n of list) {
      if (ids.includes(n.id)) {
        collected.push({ ...n, children: n.children })
      } else {
        result.push({ ...n, children: collect(n.children) })
      }
    }
    return result
  }
  const pruned = collect(root)

  // Insert at destination
  return insertNodes(pruned, collected, parentId, afterId)
}

function insertNodes(
  root: TypeTreeNode[],
  nodes: TypeTreeNode[],
  parentId: string | null,
  afterId: string | null,
): TypeTreeNode[] {
  if (parentId === null) {
    if (afterId === null) return [...root, ...nodes]
    const idx = root.findIndex(n => n.id === afterId)
    if (idx === -1) return [...root, ...nodes]
    const next = [...root]
    next.splice(idx + 1, 0, ...nodes)
    return next
  }
  return root.map(n => {
    if (n.id === parentId) {
      return { ...n, children: insertNodes(n.children, nodes, null, afterId) }
    }
    return { ...n, children: insertNodes(n.children, nodes, parentId, afterId) }
  })
}

export function deepCopyWithNewIds(node: TypeTreeNode): TypeTreeNode {
  return {
    ...node,
    id: randomUUID(),
    objectId: node.kind === 'item' ? randomUUID() : undefined,
    children: node.children.map(deepCopyWithNewIds),
  }
}

export function flattenTree(root: TypeTreeNode[]): TypeTreeNode[] {
  const result: TypeTreeNode[] = []
  function walk(nodes: TypeTreeNode[]) {
    for (const n of nodes) {
      result.push(n)
      walk(n.children)
    }
  }
  walk(root)
  return result
}
