import { useState, useCallback, useRef, useEffect, useMemo, type KeyboardEvent } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Plus } from 'lucide-react'
import type { TypeTreeNode } from '@polenta/types'
import {
  treeInsert,
  treeInsertAtBeginning,
  treeRemoveMany,
  treeRename,
  treeFindNode,
  treeFindParentId,
  treeVisibleNodes,
  treeDeepCopyWithNewIds,
  treeIsAncestorOrSelf,
} from '../../hooks/useTreeState'

// ── Types ─────────────────────────────────────────────────────────────────────

export type SelectionMode = 'single' | 'multi'

interface ClipboardData {
  nodes: TypeTreeNode[]
  cut: boolean
}

interface ContextMenuState {
  nodeId: string
  x: number
  y: number
}

interface DropIndicator {
  parentId: string | null
  afterId: string | null
  targetNodeId: string
  position: 'before' | 'after' | 'inside'
}

interface Props {
  root: TypeTreeNode[]
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  onDoubleClick?: (nodeId: string) => void
  onRootChange: (root: TypeTreeNode[]) => void
  generateId: () => string
  typeName: string
  filter?: string
  filterOptions?: { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
  readOnly?: boolean
  onItemNodeAdded?: (nodeId: string, sourceObjectId?: string) => void
}

// ── BgContextMenu ─────────────────────────────────────────────────────────────

function BgContextMenu({
  x, y, hasClipboard, onAction, onClose,
}: {
  x: number; y: number; hasClipboard: boolean
  onAction: (action: 'create-item' | 'create-folder' | 'paste') => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onClose])

  const items: Array<{ id: 'create-item' | 'create-folder' | 'paste'; label: string }> = [
    { id: 'create-item', label: 'Créer un élément' },
    { id: 'create-folder', label: 'Créer un dossier' },
    ...(hasClipboard ? [{ id: 'paste' as const, label: 'Coller' }] : []),
  ]

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl py-1 w-44 text-xs"
      style={{ left: x, top: y }}
    >
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          onClick={() => { onAction(item.id); onClose() }}
          className="w-full text-left px-3 py-1.5 hover:bg-hover transition-colors text-ink"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

// ── ContextMenu ───────────────────────────────────────────────────────────────

function ContextMenu({
  x, y, nodeId, node, clipboard, onAction, onClose,
}: {
  x: number; y: number; nodeId: string; node: TypeTreeNode | null
  clipboard: ClipboardData | null
  onAction: (action: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onClose])

  const items = [
    { id: 'create-item', label: 'Créer un élément' },
    { id: 'create-folder', label: 'Créer un dossier' },
    { id: 'rename', label: 'Renommer' },
    'separator',
    { id: 'copy', label: 'Copier' },
    { id: 'cut', label: 'Couper' },
    ...(clipboard ? [{ id: 'paste', label: 'Coller' }] : []),
    'separator',
    { id: 'delete', label: 'Supprimer', danger: true },
  ] as const

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl py-1 w-44 text-xs"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="border-t border-edge my-1" />
        ) : (
          <button
            key={item.id}
            type="button"
            onClick={() => { onAction(item.id); onClose() }}
            className={[
              'w-full text-left px-3 py-1.5 hover:bg-hover transition-colors',
              'danger' in item && item.danger ? 'text-red-500' : 'text-ink',
            ].join(' ')}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}

// ── TreeRow ───────────────────────────────────────────────────────────────────

function TreeRow({
  node,
  depth,
  isSelected,
  isExpanded,
  isRenaming,
  isDragging,
  dropIndicatorBefore,
  dropIndicatorAfterRow,
  dropIndicatorInside,
  onSelect,
  onExpand,
  onDoubleClick,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
  onHoverPlus,
  hoveredForPlus,
  onPlusClick,
  readOnly,
}: {
  node: TypeTreeNode
  depth: number
  isSelected: boolean
  isExpanded: boolean
  isRenaming: boolean
  isDragging: boolean
  dropIndicatorBefore: boolean
  dropIndicatorAfterRow: boolean
  dropIndicatorInside: boolean
  onSelect: (e: React.MouseEvent) => void
  onExpand: () => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onRenameCommit: (name: string) => void
  onRenameCancel: () => void
  onHoverPlus: (id: string | null) => void
  hoveredForPlus: boolean
  onPlusClick: (e: React.MouseEvent, nodeId: string, inside: boolean) => void
  readOnly: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [renameValue, setRenameValue] = useState(node.name)

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(node.name)
      setTimeout(() => { inputRef.current?.select() }, 0)
    }
  }, [isRenaming, node.name])

  const Icon = node.kind === 'folder'
    ? (isExpanded ? FolderOpen : Folder)
    : FileText

  return (
    <div
      className="relative"
      onMouseEnter={() => onHoverPlus(node.id)}
      onMouseLeave={() => onHoverPlus(null)}
    >
      {/* Drop indicator before (above row) */}
      {dropIndicatorBefore && (
        <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-500 z-10 pointer-events-none" />
      )}

      {/* Row */}
      <div
        className={[
          'flex items-center gap-1 px-2 py-1 text-xs cursor-pointer select-none',
          isSelected ? 'bg-blue-600 text-white' : 'text-ink hover:bg-hover',
          isDragging ? 'opacity-50' : '',
          dropIndicatorInside ? 'ring-1 ring-blue-400 ring-inset' : '',
        ].join(' ')}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={onSelect}
        onDoubleClick={() => { if (node.kind === 'folder') onExpand(); else onDoubleClick() }}
        onContextMenu={onContextMenu}
        draggable={!readOnly}
      >
        {/* Expand toggle */}
        {node.kind === 'folder' ? (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onExpand() }}
            className={`shrink-0 ${isSelected ? 'text-white' : 'text-ink-3'}`}
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Icon */}
        <Icon size={13} className={`shrink-0 ${isSelected ? 'text-white' : node.kind === 'folder' ? 'text-amber-500' : 'text-ink-3'}`} />

        {/* Name / rename input */}
        {isRenaming ? (
          <input
            ref={inputRef}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); onRenameCommit(renameValue) }
              if (e.key === 'Escape') { e.preventDefault(); onRenameCancel() }
            }}
            onBlur={() => onRenameCommit(renameValue)}
            onClick={e => e.stopPropagation()}
            className="flex-1 bg-surface text-ink text-xs border border-blue-400 rounded px-1 outline-none"
            autoFocus
          />
        ) : (
          <span className="flex-1 truncate">{node.name}</span>
        )}

        {/* Inline + button : dossiers uniquement */}
        {!readOnly && hoveredForPlus && !isRenaming && node.kind === 'folder' && (
          <button
            type="button"
            title="Créer dans ce dossier"
            onClick={e => onPlusClick(e, node.id, true)}
            className={`shrink-0 p-0.5 rounded hover:bg-black/10 ${isSelected ? 'text-white' : 'text-ink-3 hover:text-ink'}`}
          >
            <Plus size={12} />
          </button>
        )}
      </div>

      {/* Drop indicator after (below row) */}
      {dropIndicatorAfterRow && (
        <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500 z-10 pointer-events-none" />
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ElementTree({
  root,
  selectedIds,
  onSelect,
  onDoubleClick,
  onRootChange,
  generateId,
  typeName,
  filter,
  filterOptions,
  readOnly = false,
  onItemNodeAdded,
}: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null)
  const [hoveredForPlus, setHoveredForPlus] = useState<string | null>(null)
  const [hoveredGap, setHoveredGap] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null)
  const [draggingIds, setDraggingIds] = useState<string[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; hasContent: boolean } | null>(null)
  const [bgContextMenu, setBgContextMenu] = useState<{ x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const visibleNodes = treeVisibleNodes(root, expandedIds, filter, filterOptions)

  // Pre-compute parent and depth maps to avoid O(n²) lookups in the render loop
  const parentIdMap = useMemo(() => {
    const map = new Map<string, string | null>()
    const walk = (nodes: TypeTreeNode[], parentId: string | null) => {
      for (const n of nodes) {
        map.set(n.id, parentId)
        walk(n.children, n.id)
      }
    }
    walk(root, null)
    return map
  }, [root])

  const depthMap = useMemo(() => {
    const map = new Map<string, number>()
    const walk = (nodes: TypeTreeNode[], depth: number) => {
      for (const n of nodes) {
        map.set(n.id, depth)
        walk(n.children, depth + 1)
      }
    }
    walk(root, 0)
    return map
  }, [root])

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  // ── Selection ─────────────────────────────────────────────────────────────

  const handleSelect = useCallback((nodeId: string, e: React.MouseEvent) => {
    if (e.shiftKey && selectedIds.length > 0) {
      // Contiguous selection
      const lastId = selectedIds[selectedIds.length - 1]
      const visibleIds = visibleNodes.map(n => n.id)
      const from = visibleIds.indexOf(lastId)
      const to = visibleIds.indexOf(nodeId)
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from]
        onSelect(visibleIds.slice(start, end + 1))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      // Toggle
      if (selectedIds.includes(nodeId)) {
        onSelect(selectedIds.filter(id => id !== nodeId))
      } else {
        onSelect([...selectedIds, nodeId])
      }
      return
    }
    onSelect([nodeId])
  }, [selectedIds, visibleNodes, onSelect])

  const handleClickEmpty = useCallback(() => {
    onSelect([])
  }, [onSelect])

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const visibleIds = visibleNodes.map(n => n.id)
    const lastSelected = selectedIds[selectedIds.length - 1]
    const currentIdx = lastSelected ? visibleIds.indexOf(lastSelected) : -1

    // Priority: if a field is focused, let native undo/redo work
    const focused = document.activeElement
    if (focused && focused !== containerRef.current && focused.tagName === 'INPUT') return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const nextIdx = Math.min(currentIdx + 1, visibleIds.length - 1)
      if (nextIdx >= 0) onSelect([visibleIds[nextIdx]])
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prevIdx = Math.max(currentIdx - 1, 0)
      if (prevIdx >= 0 && visibleIds.length > 0) onSelect([visibleIds[prevIdx]])
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (lastSelected) {
        const node = treeFindNode(root, lastSelected)
        if (node?.kind === 'folder') setExpandedIds(prev => new Set([...prev, lastSelected]))
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (lastSelected) {
        const node = treeFindNode(root, lastSelected)
        if (node?.kind === 'folder' && expandedIds.has(lastSelected)) {
          setExpandedIds(prev => { const n = new Set(prev); n.delete(lastSelected); return n })
        } else {
          const parentId = treeFindParentId(root, lastSelected)
          if (parentId) onSelect([parentId])
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIds.length === 1 && onDoubleClick) onDoubleClick(selectedIds[0])
    } else if (e.key === 'F2') {
      e.preventDefault()
      if (selectedIds.length === 1) setRenamingId(selectedIds[0])
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!readOnly && selectedIds.length > 0) {
        e.preventDefault()
        initiateDelete(selectedIds)
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      if (selectedIds.length > 0) {
        e.preventDefault()
        copyToClipboard(selectedIds, false)
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
      if (!readOnly && selectedIds.length > 0) {
        e.preventDefault()
        copyToClipboard(selectedIds, true)
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      if (!readOnly && clipboard && selectedIds.length === 1) {
        e.preventDefault()
        paste(selectedIds[0])
      }
    } else if (e.key === 'Escape') {
      if (renamingId) {
        setRenamingId(null)
      } else if (draggingIds.length > 0) {
        setDraggingIds([])
        setDropIndicator(null)
        document.dispatchEvent(new Event('dragend'))
      }
    }
  }, [visibleNodes, selectedIds, root, expandedIds, renamingId, draggingIds, clipboard, readOnly, onSelect, onDoubleClick])

  // ── CRUD operations ───────────────────────────────────────────────────────

  function createItem(parentId: string | null, afterId: string | null, kind: 'folder' | 'item') {
    const id = generateId()
    const defaultName = kind === 'folder' ? 'Nouveau dossier' : `Nouvel élément`
    const newNode: TypeTreeNode = { id, kind, name: defaultName, children: [] }
    const newRoot = treeInsert(root, newNode, parentId, afterId)
    onRootChange(newRoot)
    if (parentId) setExpandedIds(prev => new Set([...prev, parentId]))
    onSelect([id])
    setTimeout(() => setRenamingId(id), 50)
    if (kind === 'item') onItemNodeAdded?.(id)
  }

  function initiateDelete(ids: string[]) {
    const allEmptyFolders = ids.every(id => {
      const node = treeFindNode(root, id)
      return node?.kind === 'folder' && node.children.length === 0
    })

    if (allEmptyFolders) {
      onRootChange(treeRemoveMany(root, ids))
      onSelect([])
      return
    }

    const hasContent = ids.some(id => {
      const node = treeFindNode(root, id)
      return node?.kind === 'folder' && node.children.length > 0
    })
    setDeleteConfirm({ ids, hasContent })
  }

  function confirmDelete() {
    if (!deleteConfirm) return
    onRootChange(treeRemoveMany(root, deleteConfirm.ids))
    onSelect([])
    setDeleteConfirm(null)
  }

  function copyToClipboard(ids: string[], cut: boolean) {
    const nodes = ids.map(id => treeFindNode(root, id)).filter(Boolean) as TypeTreeNode[]
    setClipboard({ nodes, cut })
  }

  /** Collect all item nodes from a subtree in pre-order */
  function collectItemNodes(nodes: TypeTreeNode[]): TypeTreeNode[] {
    const result: TypeTreeNode[] = []
    for (const n of nodes) {
      if (n.kind === 'item') result.push(n)
      result.push(...collectItemNodes(n.children))
    }
    return result
  }

  /** After paste: notify parent for each copied item node so it creates the backend object.
   *  If this is not a cut operation, pass the source objectId so the backend object is cloned. */
  function notifyPastedItems(copies: TypeTreeNode[], originals: TypeTreeNode[], isCut: boolean) {
    if (!onItemNodeAdded) return
    const copiedItems = collectItemNodes(copies)
    const originalItems = collectItemNodes(originals)
    copiedItems.forEach((copy, i) => {
      const sourceObjectId = isCut ? undefined : originalItems[i]?.objectId
      onItemNodeAdded(copy.id, sourceObjectId)
    })
  }

  function paste(targetId: string) {
    if (!clipboard) return
    const target = treeFindNode(root, targetId)
    if (!target) return

    const originalNodes = clipboard.nodes  // capture before any state mutation
    const copies = originalNodes.map(n => treeDeepCopyWithNewIds(n, generateId))

    let newRoot: TypeTreeNode[]
    if (target.kind === 'folder') {
      // Paste inside the folder
      newRoot = root.map(function insertInto(n): TypeTreeNode {
        if (n.id === targetId) {
          return { ...n, children: [...n.children, ...copies] }
        }
        return { ...n, children: n.children.map(insertInto) }
      })
      setExpandedIds(prev => new Set([...prev, targetId]))
    } else {
      // Paste after the target
      const parentId = treeFindParentId(root, targetId)
      newRoot = treeInsert(root, copies[0], parentId, targetId)
      for (let i = 1; i < copies.length; i++) {
        newRoot = treeInsert(newRoot, copies[i], parentId, copies[i - 1].id)
      }
    }

    const isCut = clipboard.cut
    if (isCut) {
      const cutIds = originalNodes.map(n => n.id)
      newRoot = treeRemoveMany(newRoot, cutIds)
      setClipboard(null)
    }

    onRootChange(newRoot)
    onSelect(copies.map(n => n.id))
    // T65: create backend objects for all copied item nodes
    notifyPastedItems(copies, originalNodes, isCut)
  }

  // ── Background context menu handler ──────────────────────────────────────

  function handleBgContextAction(action: 'create-item' | 'create-folder' | 'paste') {
    if (action === 'create-item') {
      createItem(null, null, 'item')
    } else if (action === 'create-folder') {
      createItem(null, null, 'folder')
    } else if (action === 'paste' && clipboard) {
      const originalNodes = clipboard.nodes  // capture before any state mutation
      const copies = originalNodes.map(n => treeDeepCopyWithNewIds(n, generateId))
      let newRoot = root
      for (const c of copies) {
        newRoot = treeInsert(newRoot, c, null, null)
      }
      const isCut = clipboard.cut
      if (isCut) {
        newRoot = treeRemoveMany(newRoot, originalNodes.map(n => n.id))
        setClipboard(null)
      }
      onRootChange(newRoot)
      onSelect(copies.map(n => n.id))
      // T65: create backend objects for all copied item nodes
      notifyPastedItems(copies, originalNodes, isCut)
    }
  }

  // ── Context menu handler ──────────────────────────────────────────────────

  function handleContextMenu(e: React.MouseEvent, nodeId: string) {
    e.preventDefault()
    e.stopPropagation()
    if (!selectedIds.includes(nodeId)) onSelect([nodeId])
    setContextMenu({ nodeId, x: e.clientX, y: e.clientY })
  }

  function handleContextAction(action: string) {
    const targetId = contextMenu?.nodeId ?? null
    if (!targetId) return
    const target = treeFindNode(root, targetId)
    const parentId = treeFindParentId(root, targetId)

    switch (action) {
      case 'create-item':
        if (target?.kind === 'folder') createItem(targetId, null, 'item')
        else createItem(parentId, targetId, 'item')
        break
      case 'create-folder':
        if (target?.kind === 'folder') createItem(targetId, null, 'folder')
        else createItem(parentId, targetId, 'folder')
        break
      case 'rename':
        setRenamingId(targetId)
        break
      case 'copy':
        copyToClipboard(selectedIds.includes(targetId) ? selectedIds : [targetId], false)
        break
      case 'cut':
        copyToClipboard(selectedIds.includes(targetId) ? selectedIds : [targetId], true)
        break
      case 'paste':
        paste(targetId)
        break
      case 'delete':
        initiateDelete(selectedIds.includes(targetId) ? selectedIds : [targetId])
        break
    }
  }

  // ── Plus button handler ───────────────────────────────────────────────────

  function handlePlusClick(e: React.MouseEvent, nodeId: string, inside: boolean) {
    e.stopPropagation()
    if (inside) {
      // Create item inside folder
      createItem(nodeId, null, 'item')
    } else {
      // Create item after this node
      const parentId = treeFindParentId(root, nodeId)
      createItem(parentId, nodeId, 'item')
    }
  }

  // ── Gap + button handler ──────────────────────────────────────────────────

  function handleGapPlusClick(e: React.MouseEvent, afterNodeId: string) {
    e.stopPropagation()
    const parentId = treeFindParentId(root, afterNodeId)
    createItem(parentId, afterNodeId, 'item')
  }

  // ── Drag & Drop (simplified) ──────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, nodeId: string) {
    const ids = selectedIds.includes(nodeId) ? selectedIds : [nodeId]

    // Bug 2: do not start drag if selected nodes span multiple levels
    if (ids.length > 1) {
      const firstParent = parentIdMap.get(ids[0])
      const allSameLevel = ids.every(id => parentIdMap.get(id) === firstParent)
      if (!allSameLevel) {
        e.preventDefault()
        return
      }
    }

    setDraggingIds(ids)
    e.dataTransfer.setData('text/plain', ids.join(','))
    e.dataTransfer.effectAllowed = 'move'

    // Ghost image with badge count
    const ghost = document.createElement('div')
    ghost.className = 'text-xs bg-blue-600 text-white px-2 py-1 rounded shadow'
    ghost.textContent = ids.length > 1 ? `${ids.length} éléments` : (treeFindNode(root, ids[0])?.name ?? '')
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 0)
    setTimeout(() => document.body.removeChild(ghost), 0)
  }

  function handleDragOver(e: React.DragEvent, nodeId: string) {
    e.preventDefault()
    const target = treeFindNode(root, nodeId)
    if (!target) return
    const parentId = treeFindParentId(root, nodeId)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const relY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5

    if (target.kind === 'folder' && relY > 0.25 && relY < 0.75) {
      setDropIndicator({ parentId: nodeId, afterId: null, targetNodeId: nodeId, position: 'inside' })
    } else if (relY < 0.5) {
      const siblings = parentId ? (treeFindNode(root, parentId)?.children ?? root) : root
      const idx = siblings.findIndex(n => n.id === nodeId)
      const prevId = idx > 0 ? siblings[idx - 1].id : null
      setDropIndicator({ parentId, afterId: prevId, targetNodeId: nodeId, position: 'before' })
    } else {
      setDropIndicator({ parentId, afterId: nodeId, targetNodeId: nodeId, position: 'after' })
    }
  }

  function handleDrop(e: React.DragEvent, nodeId: string) {
    e.preventDefault()
    if (!dropIndicator) return
    const ids = e.dataTransfer.getData('text/plain').split(',').filter(Boolean)
    if (ids.length === 0) return

    const { parentId, afterId, position } = dropIndicator

    // No-op: drop on self (before/after position where afterId is the node itself)
    if (afterId !== null && ids.includes(afterId)) {
      setDraggingIds([])
      setDropIndicator(null)
      return
    }

    // Guard: prevent dropping a node into itself or any of its descendants.
    // This covers two cases:
    //   1. Drag a folder onto itself (position='inside', parentId === dragged id)
    //   2. Drag a folder into one of its sub-folders (parentId is a descendant of the dragged node)
    if (parentId !== null && ids.some(id => treeIsAncestorOrSelf(root, id, parentId))) {
      setDraggingIds([])
      setDropIndicator(null)
      return
    }

    const nodesToMove = ids.map(id => treeFindNode(root, id)).filter(Boolean) as TypeTreeNode[]
    const pruned = treeRemoveMany(root, ids)
    let newRoot = pruned

    if (position === 'before' && afterId === null) {
      for (const n of [...nodesToMove].reverse()) {
        newRoot = treeInsertAtBeginning(newRoot, n, parentId)
      }
    } else {
      let lastAfterId = afterId
      for (const n of nodesToMove) {
        newRoot = treeInsert(newRoot, n, parentId, lastAfterId)
        lastAfterId = n.id
      }
    }

    onRootChange(newRoot)
    setDraggingIds([])
    setDropIndicator(null)
  }

  function handleDragEnd() {
    setDraggingIds([])
    setDropIndicator(null)
  }

  // ── Empty state message ───────────────────────────────────────────────────

  if (root.length === 0 && !readOnly) {
    return (
      <div
        ref={containerRef}
        className="flex-1 flex flex-col items-center justify-center gap-3 text-ink-3 text-xs py-8"
        onClick={handleClickEmpty}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <p>Aucun élément</p>
        <button
          type="button"
          onClick={() => createItem(null, null, 'item')}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          + Créer le premier élément
        </button>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={e => {
        // Click on empty space below items
        if (e.target === containerRef.current) handleClickEmpty()
      }}
    >
      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-ink mb-2">Supprimer ?</h2>
            <p className="text-xs text-ink-2 mb-5">
              {deleteConfirm.hasContent
                ? `Ce dossier contient des éléments. Tout le contenu sera supprimé en cascade.`
                : `${deleteConfirm.ids.length > 1 ? 'Ces éléments seront supprimés.' : 'Cet élément sera supprimé.'}`}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteConfirm(null)}
                className="text-sm px-4 py-1.5 border border-edge rounded text-ink-2 hover:text-ink transition-colors">
                Annuler
              </button>
              <button type="button" onClick={confirmDelete} autoFocus
                className="text-sm px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white transition-colors">
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          nodeId={contextMenu.nodeId}
          node={treeFindNode(root, contextMenu.nodeId)}
          clipboard={clipboard}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Background context menu (clic droit dans le vide) */}
      {bgContextMenu && (
        <BgContextMenu
          x={bgContextMenu.x}
          y={bgContextMenu.y}
          hasClipboard={clipboard !== null}
          onAction={handleBgContextAction}
          onClose={() => setBgContextMenu(null)}
        />
      )}

      {/* Tree rows */}
      {visibleNodes.map((node, visibleIdx) => {
        const depth = depthMap.get(node.id) ?? 0
        const isExpanded = expandedIds.has(node.id)
        const isSelected = selectedIds.includes(node.id)
        const isDragging = draggingIds.includes(node.id)
        const dropIndicatorBefore = dropIndicator?.targetNodeId === node.id && dropIndicator.position === 'before'
        const dropIndicatorAfterRow = dropIndicator?.targetNodeId === node.id && dropIndicator.position === 'after'
        const dropIndicatorInside = dropIndicator?.targetNodeId === node.id && dropIndicator.position === 'inside'
        const isLastVisible = visibleIdx === visibleNodes.length - 1

        return (
          <div key={node.id}>
            <div
              draggable={!readOnly}
              onDragStart={e => handleDragStart(e, node.id)}
              onDragOver={e => handleDragOver(e, node.id)}
              onDrop={e => handleDrop(e, node.id)}
              onDragEnd={handleDragEnd}
            >
              <TreeRow
                node={node}
                depth={depth}
                isSelected={isSelected}
                isExpanded={isExpanded}
                isRenaming={renamingId === node.id}
                isDragging={isDragging}
                dropIndicatorBefore={!!dropIndicatorBefore}
                dropIndicatorAfterRow={!!dropIndicatorAfterRow}
                dropIndicatorInside={!!dropIndicatorInside}
                onSelect={e => handleSelect(node.id, e)}
                onExpand={() => toggleExpand(node.id)}
                onDoubleClick={() => { if (onDoubleClick && selectedIds.length <= 1) onDoubleClick(node.id) }}
                onContextMenu={e => handleContextMenu(e, node.id)}
                onRenameCommit={name => {
                  if (name.trim()) onRootChange(treeRename(root, node.id, name.trim()))
                  setRenamingId(null)
                }}
                onRenameCancel={() => setRenamingId(null)}
                onHoverPlus={id => setHoveredForPlus(id)}
                hoveredForPlus={hoveredForPlus === node.id}
                onPlusClick={handlePlusClick}
                readOnly={readOnly}
              />
            </div>

            {/* Gap between nodes — shows + button on hover */}
            {!readOnly && !isLastVisible && (
              <div
                className="h-2 flex items-center justify-center relative"
                onMouseEnter={() => setHoveredGap(node.id)}
                onMouseLeave={() => setHoveredGap(null)}
              >
                {hoveredGap === node.id && (
                  <button
                    type="button"
                    title="Créer un élément ici"
                    onClick={e => handleGapPlusClick(e, node.id)}
                    className="absolute flex items-center justify-center w-4 h-4 rounded-full bg-blue-500 hover:bg-blue-600 text-white z-10"
                  >
                    <Plus size={10} />
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Bouton + permanent en fin d'arbre */}
      {!readOnly && (
        <div className="flex items-center px-3 py-1.5">
          <button
            type="button"
            onClick={() => createItem(null, null, 'item')}
            className="flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink transition-colors"
          >
            <Plus size={12} />
            <span>Nouvel élément</span>
          </button>
        </div>
      )}

      {/* Empty area click handler */}
      <div
        className="min-h-12"
        onClick={handleClickEmpty}
        onContextMenu={e => { e.preventDefault(); setBgContextMenu({ x: e.clientX, y: e.clientY }) }}
      />
    </div>
  )
}
