import { useCallback, useReducer } from 'react'
import type { TypeTreeNode } from '@polenta/types'

// ── Action types ──────────────────────────────────────────────────────────────

type TreeAction =
  | { type: 'SET_ROOT'; root: TypeTreeNode[] }
  | { type: 'RESET_ROOT'; root: TypeTreeNode[] }
  | { type: 'UNDO' }
  | { type: 'REDO' }

// ── State ─────────────────────────────────────────────────────────────────────

const MAX_HISTORY = 20

interface TreeHistoryState {
  past: TypeTreeNode[][]
  present: TypeTreeNode[]
  future: TypeTreeNode[][]
}

function historyReducer(state: TreeHistoryState, action: TreeAction): TreeHistoryState {
  switch (action.type) {
    case 'RESET_ROOT': {
      // Replace current state without recording history (e.g. after switching type/node or initial load)
      return { past: [], present: action.root, future: [] }
    }
    case 'SET_ROOT': {
      // Don't record if nothing changed
      if (JSON.stringify(state.present) === JSON.stringify(action.root)) return state
      const past = [...state.past, state.present].slice(-MAX_HISTORY)
      return { past, present: action.root, future: [] }
    }
    case 'UNDO': {
      if (state.past.length === 0) return state
      const past = [...state.past]
      const previous = past.pop()!
      return {
        past,
        present: previous,
        future: [state.present, ...state.future],
      }
    }
    case 'REDO': {
      if (state.future.length === 0) return state
      const [next, ...rest] = state.future
      return {
        past: [...state.past, state.present],
        present: next,
        future: rest,
      }
    }
    default:
      return state
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface TreeStateResult {
  root: TypeTreeNode[]
  canUndo: boolean
  canRedo: boolean
  setRoot: (root: TypeTreeNode[]) => void
  undo: () => void
  redo: () => void
  /** Replace the current state without recording history (e.g. after initial load) */
  resetRoot: (root: TypeTreeNode[]) => void
}

export function useTreeState(initialRoot: TypeTreeNode[] = []): TreeStateResult {
  const [state, dispatch] = useReducer(historyReducer, {
    past: [],
    present: initialRoot,
    future: [],
  })

  const setRoot = useCallback((root: TypeTreeNode[]) => {
    dispatch({ type: 'SET_ROOT', root })
  }, [])

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), [])
  const redo = useCallback(() => dispatch({ type: 'REDO' }), [])

  // Reset without recording history (used when switching node/type or on initial load)
  const resetRoot = useCallback((root: TypeTreeNode[]) => {
    dispatch({ type: 'RESET_ROOT', root })
  }, [])

  return {
    root: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    setRoot,
    undo,
    redo,
    resetRoot,
  }
}

// ── Pure tree helpers used in the renderer ────────────────────────────────────

export function treeInsertAtBeginning(
  root: TypeTreeNode[],
  newNode: TypeTreeNode,
  parentId: string | null,
): TypeTreeNode[] {
  if (parentId === null) {
    return [newNode, ...root]
  }
  return root.map(n => {
    if (n.id === parentId) {
      return { ...n, children: [newNode, ...n.children] }
    }
    return { ...n, children: treeInsertAtBeginning(n.children, newNode, parentId) }
  })
}

export function treeInsert(
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
    return { ...n, children: treeInsert(n.children, newNode, parentId, afterId) }
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

export function treeRemove(root: TypeTreeNode[], id: string): TypeTreeNode[] {
  return root
    .filter(n => n.id !== id)
    .map(n => ({ ...n, children: treeRemove(n.children, id) }))
}

export function treeRemoveMany(root: TypeTreeNode[], ids: string[]): TypeTreeNode[] {
  const idSet = new Set(ids)
  function prune(nodes: TypeTreeNode[]): TypeTreeNode[] {
    return nodes
      .filter(n => !idSet.has(n.id))
      .map(n => ({ ...n, children: prune(n.children) }))
  }
  return prune(root)
}

export function treeRename(root: TypeTreeNode[], id: string, name: string): TypeTreeNode[] {
  return root.map(n => {
    if (n.id === id) return { ...n, name }
    return { ...n, children: treeRename(n.children, id, name) }
  })
}

export function treeFindParentId(root: TypeTreeNode[], id: string): string | null {
  function search(nodes: TypeTreeNode[], parentId: string | null): string | null {
    for (const n of nodes) {
      if (n.children.some(c => c.id === id)) return n.id
      const found = search(n.children, n.id)
      if (found !== null) return found
    }
    return null
  }
  return search(root, null)
}

export function treeFindNode(root: TypeTreeNode[], id: string): TypeTreeNode | null {
  for (const n of root) {
    if (n.id === id) return n
    const found = treeFindNode(n.children, id)
    if (found) return found
  }
  return null
}

export function treeFindByObjectId(root: TypeTreeNode[], objectId: string): TypeTreeNode | null {
  for (const n of root) {
    if (n.kind === 'item' && n.objectId === objectId) return n
    const found = treeFindByObjectId(n.children, objectId)
    if (found) return found
  }
  return null
}

export function treeFlatten(root: TypeTreeNode[]): TypeTreeNode[] {
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

export function treeUpdateObjectId(root: TypeTreeNode[], nodeId: string, objectId: string): TypeTreeNode[] {
  return root.map(n => {
    if (n.id === nodeId) return { ...n, objectId }
    if (n.children.length > 0) return { ...n, children: treeUpdateObjectId(n.children, nodeId, objectId) }
    return n
  })
}

/**
 * Returns true if `ancestorId` is an ancestor of (or equal to) `nodeId` in the tree.
 * Used by drag & drop to prevent dropping a node into itself or one of its descendants.
 */
export function treeIsAncestorOrSelf(root: TypeTreeNode[], ancestorId: string, nodeId: string): boolean {
  if (ancestorId === nodeId) return true
  function search(nodes: TypeTreeNode[]): boolean {
    for (const n of nodes) {
      if (n.id === ancestorId) {
        // Check if nodeId is anywhere in this subtree
        return containsId(n.children, nodeId)
      }
      if (search(n.children)) return true
    }
    return false
  }
  function containsId(nodes: TypeTreeNode[], id: string): boolean {
    for (const n of nodes) {
      if (n.id === id) return true
      if (containsId(n.children, id)) return true
    }
    return false
  }
  return search(root)
}

export function treeDeepCopyWithNewIds(node: TypeTreeNode, generateId: () => string): TypeTreeNode {
  return {
    ...node,
    id: generateId(),
    objectId: node.kind === 'item' ? generateId() : undefined,
    children: node.children.map(c => treeDeepCopyWithNewIds(c, generateId)),
  }
}

/** Get all visible (expanded) nodes in tree order */
export function treeVisibleNodes(
  root: TypeTreeNode[],
  expandedIds: Set<string>,
  filter?: string,
  filterOptions?: { caseSensitive: boolean; wholeWord: boolean; regex: boolean },
): TypeTreeNode[] {
  if (!filter) {
    const result: TypeTreeNode[] = []
    function walk(nodes: TypeTreeNode[]) {
      for (const n of nodes) {
        result.push(n)
        if (n.kind === 'folder' && expandedIds.has(n.id)) {
          walk(n.children)
        }
      }
    }
    walk(root)
    return result
  }

  // Filter mode: show matching nodes + their parent folders
  const matchingIds = getMatchingIds(root, filter, filterOptions)
  const result: TypeTreeNode[] = []
  function walkFiltered(nodes: TypeTreeNode[]) {
    for (const n of nodes) {
      const selfMatches = matchingIds.has(n.id)
      const hasMatchingDescendant = hasMatch(n.children, matchingIds)
      if (selfMatches || hasMatchingDescendant) {
        result.push(n)
        // Always expand folders that have matching descendants
        if (n.kind === 'folder') {
          walkFiltered(n.children)
        }
      }
    }
  }
  walkFiltered(root)
  return result
}

function getMatchingIds(
  root: TypeTreeNode[],
  filter: string,
  options?: { caseSensitive: boolean; wholeWord: boolean; regex: boolean },
): Set<string> {
  const ids = new Set<string>()
  const { caseSensitive = false, wholeWord = false, regex = false } = options ?? {}

  let test: (s: string) => boolean
  try {
    if (regex) {
      const re = new RegExp(filter, caseSensitive ? '' : 'i')
      test = (s) => re.test(s)
    } else {
      const pattern = wholeWord ? `\\b${escapeRegex(filter)}\\b` : escapeRegex(filter)
      const re = new RegExp(pattern, caseSensitive ? '' : 'i')
      test = (s) => re.test(s)
    }
  } catch {
    test = () => false
  }

  function walk(nodes: TypeTreeNode[]) {
    for (const n of nodes) {
      if (test(n.name) || (n.objectId && test(n.objectId))) {
        ids.add(n.id)
      }
      walk(n.children)
    }
  }
  walk(root)
  return ids
}

function hasMatch(nodes: TypeTreeNode[], matchingIds: Set<string>): boolean {
  for (const n of nodes) {
    if (matchingIds.has(n.id)) return true
    if (hasMatch(n.children, matchingIds)) return true
  }
  return false
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function computeSectionNumbers(root: TypeTreeNode[]): Map<string, string> {
  const map = new Map<string, string>()
  function walk(nodes: TypeTreeNode[], prefix: string) {
    nodes.forEach((node, i) => {
      const section = prefix ? `${prefix}.${i + 1}` : `${i + 1}`
      map.set(node.id, section)
      if (node.children.length > 0) walk(node.children, section)
    })
  }
  walk(root, '')
  return map
}

/** Get the depth (0-based) of a node in the tree */
export function treeNodeDepth(root: TypeTreeNode[], id: string): number {
  function search(nodes: TypeTreeNode[], depth: number): number {
    for (const n of nodes) {
      if (n.id === id) return depth
      const found = search(n.children, depth + 1)
      if (found >= 0) return found
    }
    return -1
  }
  return search(root, 0)
}
