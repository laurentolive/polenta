import React, { useState, useCallback, useRef, useEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { LinkCombobox } from './LinkCombobox'
import type { Candidate } from './LinkCombobox'
import { api } from '../../api'
import { ChevronRight, ChevronDown, Pencil, Filter as FilterIcon } from 'lucide-react'
import type { TypeTreeNode, ObjectTypeDefinition, LinkTypeDefinition, ObjectLink, Requirement, TestCase, SchemaField } from '@polenta/types'
import { treeFindNode, treeFindParentId, treeRemoveMany, treeInsert, treeInsertAtBeginning, treeDeepCopyWithNewIds } from '../../hooks/useTreeState'
import { matchesRefs, filterCandidatesByRefs, getLinkTypeLabel, getPeerId, isLinkTypeValid } from './linkUtils'
import { RichTextField } from '../RichTextField'
import { StepsTable } from '../StepsTable'
import type { StepDraft } from '../StepsTable'
import { getExportColumnLabel } from '../../lib/exportColumns'
import { FilterOptionsToggle } from '../FilterOptionsToggle'
import { buildFilterRegex, type FilterOptions } from '../../lib/textFilter'

// ── Types ─────────────────────────────────────────────────────────────────────

type AnyObject = Requirement | TestCase | Record<string, unknown>

interface RowDropIndicator {
  targetNodeId: string
  position: 'before' | 'after' | 'inside'
  parentId: string | null
  afterId: string | null
}

interface Props {
  root: TypeTreeNode[]
  typeDef: ObjectTypeDefinition | undefined
  objects: AnyObject[]
  visibleFields: string[]
  sectionNumbers?: Map<string, string>
  linkTypes?: LinkTypeDefinition[]
  linksByObjectId?: Map<string, ObjectLink[]>
  repoPath?: string
  candidateObjects?: Candidate[]
  onLinkChange?: () => void
  onInlineEdit?: (objectId: string, field: string, value: string) => void
  onRenameNode?: (nodeId: string, name: string) => void
  onEditOpen?: (nodeId: string) => void
  onRootChange?: (root: TypeTreeNode[]) => void
  onColumnsReorder?: (newOrder: string[]) => void
  filter?: string
  selectedIds?: string[]
  onSelect?: (ids: string[]) => void
  generateId?: () => string
  stepsByObjectId?: Map<string, { action: string; expectedResult: string }[]>
  onStepsChange?: (objectId: string, steps: StepDraft[]) => void
  onNavigateToObject?: (peerId: string) => void
  onItemNodeAdded?: (nodeId: string, sourceObjectId?: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getObjectId(obj: AnyObject): string {
  return (obj as Record<string, unknown>)['id'] as string ?? ''
}

function getFieldValue(obj: AnyObject, field: string): string {
  const val = (obj as Record<string, unknown>)[field]
  if (val === undefined || val === null) return ''
  return String(val)
}

function isSystemField(field: string): boolean {
  return ['section', 'id', 'createdAt', 'updatedAt', 'author', 'objectTypeRef', 'version'].includes(field)
}

function isDescendantOf(node: TypeTreeNode, targetId: string): boolean {
  return node.children.some(c => c.id === targetId || isDescendantOf(c, targetId))
}

// ── Column filters (T51) ───────────────────────────────────────────────────────

interface ColumnFilterState {
  text: string
  options: FilterOptions
}

const DEFAULT_FILTER_OPTIONS: FilterOptions = { caseSensitive: false, wholeWord: false, regex: false }

/** Colonnes sans valeur texte pertinente à filtrer. */
function isFilterableColumn(col: string): boolean {
  return col !== 'steps'
}

// ── NameCell ──────────────────────────────────────────────────────────────────

function NameCell({
  value,
  nodeId,
  onRename,
}: {
  value: string
  nodeId: string
  onRename?: (nodeId: string, name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const commit = () => {
    if (draft.trim() && draft !== value) onRename?.(nodeId, draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <td className="border border-edge px-0 py-0">
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(value); setEditing(false) }
          }}
          className="w-full px-2 py-1 text-xs text-ink bg-blue-50 dark:bg-blue-950 border-0 outline-none"
        />
      </td>
    )
  }

  return (
    <td
      className={[
        'border border-edge px-2 py-1 text-xs text-ink max-w-xs truncate',
        onRename ? 'cursor-text hover:ring-1 hover:ring-inset hover:ring-blue-400' : '',
      ].join(' ')}
      onClick={onRename ? () => { setDraft(value); setEditing(true) } : undefined}
      title={onRename ? 'Cliquer pour modifier' : undefined}
    >
      {value || <span className="text-ink-3 italic">—</span>}
    </td>
  )
}

// ── InlineCell ────────────────────────────────────────────────────────────────

function InlineCell({
  value,
  field,
  objectId,
  isSystem,
  fieldDef,
  onEdit,
  onRichtextEdit,
}: {
  value: string
  field: string
  objectId: string
  isSystem: boolean
  fieldDef?: SchemaField
  onEdit?: (objectId: string, field: string, value: string) => void
  onRichtextEdit?: (objectId: string, field: string, rect: DOMRect) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (isSystem || !onEdit) {
    return (
      <td className="border border-edge px-2 py-1 text-xs text-ink-3 bg-hover max-w-xs truncate">
        {value}
      </td>
    )
  }

  // Richtext: preview in read mode, open popover on click
  if (fieldDef?.type === 'richtext') {
    const firstLine = value.split('\n').find(l => l.trim()) ?? ''
    const hasMore = value.trim().split('\n').filter(l => l.trim()).length > 1
    return (
      <td
        className="border border-edge px-2 py-1 text-xs text-ink cursor-text max-w-xs truncate hover:ring-1 hover:ring-inset hover:ring-blue-400"
        onClick={e => {
          if (onRichtextEdit) {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onRichtextEdit(objectId, field, rect)
          }
        }}
        title="Cliquer pour modifier"
      >
        {value ? (
          <span className="text-xs text-ink truncate">
            {firstLine}
            {hasMore && <span className="text-ink-3 ml-1">¶</span>}
          </span>
        ) : (
          <span className="text-ink-3 italic">—</span>
        )}
      </td>
    )
  }

  if (editing) {
    if (fieldDef?.type === 'enum') {
      return (
        <td className="border border-edge px-0 py-0">
          <select
            autoFocus
            ref={el => { if (el) el.showPicker?.() }}
            value={draft}
            onChange={e => { onEdit(objectId, field, e.target.value); setEditing(false) }}
            onBlur={() => setEditing(false)}
            onKeyDown={e => { if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
            className="w-full px-2 py-1 text-xs text-ink bg-surface border-0 outline-none"
          >
{(fieldDef.values ?? []).map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </td>
      )
    }
    return (
      <td className="border border-edge px-0 py-0">
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { onEdit(objectId, field, draft); setEditing(false) }}
          onKeyDown={e => {
            if (e.key === 'Enter') { onEdit(objectId, field, draft); setEditing(false) }
            if (e.key === 'Escape') { setDraft(value); setEditing(false) }
          }}
          className="w-full px-2 py-1 text-xs text-ink bg-blue-50 dark:bg-blue-950 border-0 outline-none"
        />
      </td>
    )
  }

  return (
    <td
      className="border border-edge px-2 py-1 text-xs text-ink cursor-text max-w-xs truncate hover:ring-1 hover:ring-inset hover:ring-blue-400"
      onClick={() => { setDraft(value); setEditing(true) }}
      title="Cliquer pour modifier"
    >
      {value || <span className="text-ink-3 italic">—</span>}
    </td>
  )
}

// ── FolderNameText — inline-editable name for folder rows ────────────────────

function FolderNameText({
  node,
  onRename,
  editing: editingProp,
  onEditingChange,
}: {
  node: TypeTreeNode
  onRename?: (nodeId: string, name: string) => void
  editing?: boolean
  onEditingChange?: (v: boolean) => void
}) {
  const [editingLocal, setEditingLocal] = useState(false)
  const editing = editingProp ?? editingLocal
  const setEditing = onEditingChange ?? setEditingLocal
  const [draft, setDraft] = useState(node.name)

  useEffect(() => {
    if (editing) setDraft(node.name)
  }, [editing, node.name])

  const commit = (e: React.SyntheticEvent) => {
    e.stopPropagation()
    const next = draft.trim() || node.name
    if (next !== node.name) onRename?.(node.id, next)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter') commit(e)
          if (e.key === 'Escape') { setEditing(false) }
        }}
        onClick={e => e.stopPropagation()}
        className="bg-transparent outline-none text-xs font-semibold text-ink min-w-[4rem]"
        style={{ width: `${Math.max(draft.length, 4)}ch` }}
      />
    )
  }

  return (
    <span className={onRename ? 'cursor-text' : undefined}>
      {node.name}
    </span>
  )
}

// ── ExcelContextMenu ──────────────────────────────────────────────────────────

type ClipboardData = { nodes: TypeTreeNode[]; cut: boolean }
type ExcelMenuItem = { id: string; label: string; danger?: true } | { separator: true }

function ExcelContextMenu({
  x, y, canEdit, clipboard, onAction, onClose,
}: {
  x: number; y: number
  canEdit: boolean
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

  const items: ExcelMenuItem[] = [{ id: 'copy', label: 'Copier' }]
  if (canEdit) items.push({ id: 'cut', label: 'Couper' })
  if (canEdit && clipboard) items.push({ id: 'paste', label: 'Coller' })
  items.push({ separator: true })
  if (canEdit) items.push({ id: 'delete', label: 'Supprimer', danger: true })

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl py-1 w-40 text-xs"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        'separator' in item ? (
          <div key={i} className="border-t border-edge my-1" />
        ) : (
          <button
            key={item.id}
            type="button"
            onClick={() => { onAction(item.id); onClose() }}
            className={[
              'w-full text-left px-3 py-1.5 hover:bg-hover transition-colors',
              item.danger ? 'text-red-500' : 'text-ink',
            ].join(' ')}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}

// ── GroupRow (folder) ─────────────────────────────────────────────────────────

function GroupRow({
  node,
  depth,
  columns,
  isExpanded,
  section,
  hasActions,
  onToggle,
  onRename,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  dropStyle,
  dropInside,
  isSelected,
  onSelectRow,
  onContextMenu,
}: {
  node: TypeTreeNode
  depth: number
  columns: string[]
  isExpanded: boolean
  section?: string
  hasActions: boolean
  onToggle: () => void
  onRename?: (nodeId: string, name: string) => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent<HTMLTableRowElement>) => void
  onDragOver?: (e: React.DragEvent<HTMLTableRowElement>) => void
  onDrop?: (e: React.DragEvent<HTMLTableRowElement>) => void
  onDragEnd?: (e: React.DragEvent<HTMLTableRowElement>) => void
  isDragging?: boolean
  dropStyle?: React.CSSProperties
  dropInside?: boolean
  isSelected?: boolean
  onSelectRow?: (e: React.MouseEvent<HTMLTableRowElement>) => void
  onContextMenu?: (e: React.MouseEvent<HTMLTableRowElement>) => void
}) {
  const [folderEditing, setFolderEditing] = useState(false)

  return (
    <tr
      className={[
        'cursor-pointer select-none',
        isSelected ? 'bg-blue-100 dark:bg-blue-900' : 'bg-folder-row',
        isDragging ? 'opacity-50' : '',
        dropInside ? 'outline outline-1 outline-blue-400' : '',
      ].filter(Boolean).join(' ')}
      style={dropStyle}
      draggable={draggable}
      onClick={e => { e.stopPropagation(); onSelectRow?.(e) }}
      onDoubleClick={onToggle}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {hasActions && (
        <td
          className="border border-edge w-8 bg-folder-row px-1 text-center text-ink-2"
          onClick={e => { e.stopPropagation(); onToggle() }}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </td>
      )}
      {(() => {
        const firstCol = columns[0]
        const restCount = columns.length - 1

        const chevron = !hasActions && (
          <span onClick={e => { e.stopPropagation(); onToggle() }}>
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )

        if (firstCol === 'section') {
          return (
            <>
              <td className="border border-edge px-2 py-1.5 text-xs font-semibold text-ink-2">
                <span className="flex items-center gap-1.5">
                  {chevron}
                  <span className="text-ink-3 font-mono font-normal">{section ?? ''}</span>
                </span>
              </td>
              <td
                colSpan={restCount || 1}
                className={['border border-edge px-2 py-1.5 text-xs font-semibold text-ink-2', onRename ? 'hover:ring-1 hover:ring-inset hover:ring-blue-400 cursor-text' : ''].join(' ')}
                onClick={onRename ? e => { e.stopPropagation(); setFolderEditing(true) } : undefined}
              >
                <FolderNameText node={node} onRename={onRename} editing={folderEditing} onEditingChange={setFolderEditing} />
              </td>
            </>
          )
        }

        return (
          <>
            <td
              colSpan={columns.length}
              className={['border border-edge px-2 py-1.5 text-xs font-semibold text-ink-2', onRename ? 'hover:ring-1 hover:ring-inset hover:ring-blue-400 cursor-text' : ''].join(' ')}
              onClick={onRename ? e => { e.stopPropagation(); setFolderEditing(true) } : undefined}
            >
              <span className="flex items-center gap-1.5">
                {chevron}
                <FolderNameText node={node} onRename={onRename} editing={folderEditing} onEditingChange={setFolderEditing} />
              </span>
            </td>
          </>
        )
      })()}
    </tr>
  )
}

// ── StepsPanel — local-state wrapper around StepsTable ────────────────────────

function StepsPanel({
  objectId,
  steps,
  onStepsChange,
  repoPath,
}: {
  objectId: string
  steps: StepDraft[]
  onStepsChange?: (objectId: string, steps: StepDraft[]) => void
  repoPath?: string
}) {
  const [localSteps, setLocalSteps] = useState<StepDraft[]>(
    steps.length > 0 ? steps : [{ action: '', expectedResult: '' }]
  )
  useEffect(() => {
    setLocalSteps(steps.length > 0 ? steps : [{ action: '', expectedResult: '' }])
  }, [objectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (newSteps: StepDraft[]) => {
    setLocalSteps(newSteps)
    onStepsChange?.(objectId, newSteps)
  }

  return (
    <StepsTable
      steps={localSteps}
      onChange={handleChange}
      disabled={!onStepsChange}
      repoPath={repoPath}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ExcelView({
  root,
  typeDef,
  objects,
  visibleFields,
  sectionNumbers,
  linkTypes = [],
  linksByObjectId,
  repoPath,
  candidateObjects = [],
  onLinkChange,
  onInlineEdit,
  onRenameNode,
  onEditOpen,
  onRootChange,
  onColumnsReorder,
  filter,
  selectedIds,
  onSelect,
  generateId,
  stepsByObjectId,
  onStepsChange,
  onNavigateToObject,
  onItemNodeAdded,
}: Props) {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(new Set())
  const toggleStepExpand = useCallback((nodeId: string) => {
    setExpandedStepIds(prev => {
      const next = new Set(prev)
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId)
      return next
    })
  }, [])
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>([])
  const effectiveSelectedIds = selectedIds ?? localSelectedIds
  const effectiveOnSelect = onSelect ?? setLocalSelectedIds
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; hasContent: boolean } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const colDragState = useRef<{ startX: number; startWidth: number; col: string } | null>(null)
  const autoColWidthsRef = useRef<Record<string, number>>({})
  const frozenAutoWidthsRef = useRef<Record<string, number> | null>(null)
  const [activeLinkPopover, setActiveLinkPopover] = useState<{ nodeId: string; typeName: string; top: number; left: number; width: number } | null>(null)
  useEffect(() => {
    if (!activeLinkPopover) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-link-popover]')) setActiveLinkPopover(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [activeLinkPopover])

  const [activeRichtextPopover, setActiveRichtextPopover] = useState<{
    objectId: string
    field: string
    top: number
    left: number
    width: number
  } | null>(null)
  const richtextOriginalValueRef = useRef<string>('')
  useEffect(() => {
    if (!activeRichtextPopover) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-richtext-popover]') && !target.closest('[data-richtext-toolbar]')) {
        setActiveRichtextPopover(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [activeRichtextPopover])

  // T51 — filtre par colonne : état local (texte + options), non persisté
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilterState>>({})
  const [activeColumnFilterPopover, setActiveColumnFilterPopover] = useState<{
    column: string
    top: number
    left: number
    width: number
  } | null>(null)
  useEffect(() => {
    if (!activeColumnFilterPopover) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-column-filter-popover]') && !target.closest('[data-column-filter-icon]')) {
        setActiveColumnFilterPopover(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [activeColumnFilterPopover])

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    const ro = new ResizeObserver(entries => {
      setContainerWidth(Math.floor(entries[0].contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [rowDropIndicator, setRowDropIndicator] = useState<RowDropIndicator | null>(null)
  const [draggingCol, setDraggingCol] = useState<string | null>(null)
  const [dropColTarget, setDropColTarget] = useState<{ col: string; position: 'before' | 'after' } | null>(null)

  const handleColResizeStart = useCallback((e: ReactMouseEvent, col: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!frozenAutoWidthsRef.current) {
      frozenAutoWidthsRef.current = { ...autoColWidthsRef.current }
    }
    const startWidth = colWidths[col] ?? autoColWidthsRef.current[col] ?? 200
    colDragState.current = { startX: e.clientX, startWidth, col }

    const onMouseMove = (ev: MouseEvent) => {
      const state = colDragState.current
      if (!state) return
      const dx = ev.clientX - state.startX
      const newWidth = Math.max(20, state.startWidth + dx)
      setColWidths((prev: Record<string, number>) => ({ ...prev, [state.col]: newWidth }))
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      colDragState.current = null
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [colWidths])

  const toggleFolder = useCallback((id: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  // Build object map for quick lookup
  const objectMap = new Map<string, AnyObject>()
  for (const obj of objects) {
    objectMap.set(getObjectId(obj), obj)
  }

  const viewObjectTypeRef = objects.length > 0
    ? (objects[0] as Record<string, string>)?.objectTypeRef
    : undefined

  // Column order follows visibleFields as-is (enables DnD reorder persistence)
  const columns = visibleFields.length > 0 ? visibleFields : ['id', 'name']

  // T51 — oublie le filtre d'une colonne qui n'est plus affichée (pas de filtre "fantôme")
  useEffect(() => {
    setColumnFilters(prev => {
      const staleKeys = Object.keys(prev).filter(col => !columns.includes(col))
      if (staleKeys.length === 0) return prev
      const next = { ...prev }
      for (const col of staleKeys) delete next[col]
      return next
    })
    // Ferme aussi le popover s'il pointait sur la colonne qui vient de disparaître —
    // sinon il reste affiché, détaché, au-dessus d'un en-tête qui n'existe plus.
    setActiveColumnFilterPopover(prev => (prev && !columns.includes(prev.column) ? null : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns.join(',')])

  // T51 — changer de composant/type réinitialise entièrement les filtres de colonnes,
  // même si le nouveau type partage un nom de colonne avec le précédent (ex. "status")
  useEffect(() => {
    setColumnFilters({})
    setActiveColumnFilterPopover(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeDef?.prefix, repoPath])

  // Labels système délégués à `getExportColumnLabel` (apps/desktop/src/renderer/lib/exportColumns.ts)
  // — seule source de vérité partagée avec l'export, pour que les deux ne puissent jamais diverger.
  function getColumnLabel(col: string): string {
    if (col.startsWith('link::')) {
      const typeName = col.slice(6)
      const lt = linkTypes.find(l => l.name === typeName)
      if (!lt) return typeName
      return getLinkTypeLabel(lt, viewObjectTypeRef, typeDef?.category)
    }
    return getExportColumnLabel(col, typeDef)
  }

  function getLinkCellValue(objectId: string, linkTypeName: string): string {
    if (!linksByObjectId || !objectId) return ''
    const links = linksByObjectId.get(objectId) ?? []
    const filtered = links.filter(l => l.type === linkTypeName)
    const outgoing = filtered.filter(l => l.sourceId === objectId).map(l => l.targetId)
    const incoming = filtered.filter(l => l.targetId === objectId).map(l => l.sourceId)
    const parts: string[] = []
    if (outgoing.length > 0) {
      parts.push(outgoing.join(', '))
    }
    if (incoming.length > 0) {
      parts.push(incoming.join(', '))
    }
    return parts.join(' | ')
  }

  // Valeur texte affichée pour une colonne donnée — point de vérité unique partagé par le
  // calcul de largeur auto, le rendu de cellule et le filtrage (global + par colonne, T51).
  function getCellText(node: TypeTreeNode, obj: AnyObject | null | undefined, col: string): string {
    if (col === 'section') return sectionNumbers?.get(node.id) ?? ''
    if (col === 'name') return node.name
    if (col.startsWith('link::')) return getLinkCellValue(node.objectId ?? '', col.slice(6))
    return obj ? getFieldValue(obj, col) : (col === 'id' ? node.objectId ?? '' : '')
  }

  // Flatten tree to render rows in order
  const rows: Array<{ kind: 'folder' | 'item'; node: TypeTreeNode; depth: number }> = []
  function flatten(nodes: TypeTreeNode[], depth: number, parentCollapsed: boolean) {
    for (const n of nodes) {
      if (parentCollapsed) continue
      rows.push({ kind: n.kind, node: n, depth })
      if (n.kind === 'folder') {
        flatten(n.children, depth + 1, collapsedFolders.has(n.id))
      }
    }
  }
  flatten(root, 0, false)

  // Auto-fit column widths from content (capped at 1/4 screen width)
  const maxAutoWidth = typeof window !== 'undefined' ? Math.floor(window.innerWidth / 4) : 400
  const autoColWidths: Record<string, number> = {}
  for (const col of columns) {
    let maxLen = getColumnLabel(col).length
    for (const { node, kind } of rows) {
      if (kind === 'folder') continue
      const obj = node.objectId ? objectMap.get(node.objectId) : null
      const val = getCellText(node, obj, col)
      if (val.length > maxLen) maxLen = val.length
    }
    autoColWidths[col] = Math.min(Math.max(maxLen * 7 + 24, 60), maxAutoWidth)
  }
  autoColWidthsRef.current = autoColWidths
  const baseWidths = frozenAutoWidthsRef.current ?? autoColWidths
  const effectiveColWidths = { ...baseWidths, ...colWidths }
  const totalTableWidth = columns.reduce((sum, col) => sum + (effectiveColWidths[col] ?? 120), 0) + (onEditOpen ? 32 : 0)

  // Last column expands to fill the container when the table is narrower than the viewport
  const lastCol = columns[columns.length - 1]
  const lastColNaturalWidth = effectiveColWidths[lastCol] ?? 120
  const othersTotalWidth = totalTableWidth - lastColNaturalWidth
  const lastColWidth = containerWidth > totalTableWidth
    ? containerWidth - othersTotalWidth
    : lastColNaturalWidth
  const effectiveTableWidth = Math.max(totalTableWidth, containerWidth)

  // Apply filter if active
  const filterLower = filter?.toLowerCase() ?? ''

  // T51 — filtres par colonne actifs (texte non vide, colonne toujours visible)
  const activeColumnFilters = Object.entries(columnFilters)
    .filter(([col, f]) => columns.includes(col) && f.text.trim())
    .map(([col, f]) => ({ col, re: buildFilterRegex(f.text, f.options) }))
    .filter((f): f is { col: string; re: RegExp } => f.re !== null)

  // ── Row Drag & Drop ──────────────────────────────────────────────────────────

  const dndEnabled = !!onRootChange && !filterLower && activeColumnFilters.length === 0

  function handleRowDragStart(e: React.DragEvent, nodeId: string) {
    setDraggingNodeId(nodeId)
    e.dataTransfer.setData('text/plain', nodeId)
    e.dataTransfer.effectAllowed = 'move'
    const node = treeFindNode(root, nodeId)
    const ghost = document.createElement('div')
    ghost.style.cssText = 'position:fixed;top:-100px;font-size:12px;background:#2563eb;color:#fff;padding:2px 8px;border-radius:4px;'
    ghost.textContent = node?.name ?? ''
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 0)
    setTimeout(() => document.body.removeChild(ghost), 0)
  }

  function handleRowDragOver(e: React.DragEvent, nodeId: string) {
    e.preventDefault()
    if (draggingCol) return
    const targetNode = treeFindNode(root, nodeId)
    if (!targetNode) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const relY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5
    const parentId = treeFindParentId(root, nodeId)

    if (targetNode.kind === 'folder' && relY > 0.33 && relY < 0.67) {
      setRowDropIndicator({ targetNodeId: nodeId, position: 'inside', parentId: nodeId, afterId: null })
    } else if (relY < 0.5) {
      const siblings = parentId ? (treeFindNode(root, parentId)?.children ?? root) : root
      const idx = siblings.findIndex(n => n.id === nodeId)
      const prevId = idx > 0 ? siblings[idx - 1].id : null
      setRowDropIndicator({ targetNodeId: nodeId, position: 'before', parentId, afterId: prevId })
    } else {
      setRowDropIndicator({ targetNodeId: nodeId, position: 'after', parentId, afterId: nodeId })
    }
  }

  function handleRowDrop(e: React.DragEvent) {
    e.preventDefault()
    if (draggingCol) { setDraggingNodeId(null); setRowDropIndicator(null); return }
    const draggedId = e.dataTransfer.getData('text/plain')
    if (!draggedId || !rowDropIndicator || !onRootChange) { setDraggingNodeId(null); setRowDropIndicator(null); return }
    if (draggedId === rowDropIndicator.targetNodeId) { setDraggingNodeId(null); setRowDropIndicator(null); return }

    const draggedNode = treeFindNode(root, draggedId)
    if (!draggedNode) { setDraggingNodeId(null); setRowDropIndicator(null); return }
    if (isDescendantOf(draggedNode, rowDropIndicator.targetNodeId)) { setDraggingNodeId(null); setRowDropIndicator(null); return }

    const { parentId, afterId, position } = rowDropIndicator
    const pruned = treeRemoveMany(root, [draggedId])
    let newRoot: TypeTreeNode[]
    if (position === 'inside' || (position === 'before' && afterId === null)) {
      newRoot = treeInsertAtBeginning(pruned, draggedNode, parentId)
    } else {
      newRoot = treeInsert(pruned, draggedNode, parentId, afterId)
    }
    onRootChange(newRoot)
    setDraggingNodeId(null)
    setRowDropIndicator(null)
  }

  function handleRowDragEnd() {
    setDraggingNodeId(null)
    setRowDropIndicator(null)
  }

  // ── Column Drag & Drop ───────────────────────────────────────────────────────

  function handleColDragStart(e: React.DragEvent, col: string) {
    setDraggingCol(col)
    e.dataTransfer.setData('text/plain', col)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleColDragOver(e: React.DragEvent, col: string) {
    e.preventDefault()
    if (col === draggingCol) { setDropColTarget(null); return }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const relX = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5
    setDropColTarget({ col, position: relX < 0.5 ? 'before' : 'after' })
  }

  function handleColDrop(e: React.DragEvent, col: string) {
    e.preventDefault()
    const draggedCol = e.dataTransfer.getData('text/plain')
    // Bail si pas une colonne valide ou même colonne
    if (!draggedCol || !onColumnsReorder || !columns.includes(draggedCol) || draggedCol === col) {
      setDraggingCol(null); setDropColTarget(null); return
    }
    // Recompute position from event coordinates — plus fiable que l'état React
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const relX = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5
    const position: 'before' | 'after' = relX < 0.5 ? 'before' : 'after'
    const newOrder = [...columns]
    const fromIdx = newOrder.indexOf(draggedCol)
    const toIdx = newOrder.indexOf(col)
    if (fromIdx < 0 || toIdx < 0) { setDraggingCol(null); setDropColTarget(null); return }
    newOrder.splice(fromIdx, 1)
    const insertIdx = position === 'before'
      ? (fromIdx < toIdx ? toIdx - 1 : toIdx)
      : (fromIdx < toIdx ? toIdx : toIdx + 1)
    newOrder.splice(insertIdx, 0, draggedCol)
    onColumnsReorder(newOrder)
    setDraggingCol(null)
    setDropColTarget(null)
  }

  function handleColDragEnd() {
    setDraggingCol(null)
    setDropColTarget(null)
  }

  // ── Copy / Cut / Paste / Delete ──────────────────────────────────────────────

  const canEdit = !!onRootChange

  function copyToClipboard(ids: string[], cut: boolean) {
    const nodes = ids.map(id => treeFindNode(root, id)).filter(Boolean) as TypeTreeNode[]
    setClipboard({ nodes, cut })
  }

  function initiateDelete(ids: string[]) {
    const allEmptyFolders = ids.every(id => {
      const node = treeFindNode(root, id)
      return node?.kind === 'folder' && node.children.length === 0
    })
    if (allEmptyFolders) {
      onRootChange!(treeRemoveMany(root, ids))
      effectiveOnSelect([])
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
    onRootChange!(treeRemoveMany(root, deleteConfirm.ids))
    effectiveOnSelect([])
    setDeleteConfirm(null)
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

  function paste(targetId: string) {
    if (!clipboard || !onRootChange || !generateId) return
    const target = treeFindNode(root, targetId)
    if (!target) return

    const originalNodes = clipboard.nodes  // capture before any state mutation
    const copies = originalNodes.map(n => treeDeepCopyWithNewIds(n, generateId))
    let newRoot: TypeTreeNode[]

    if (target.kind === 'folder') {
      newRoot = root.map(function insertInto(n): TypeTreeNode {
        if (n.id === targetId) return { ...n, children: [...n.children, ...copies] }
        return { ...n, children: n.children.map(insertInto) }
      })
      setCollapsedFolders(prev => { const s = new Set(prev); s.delete(targetId); return s })
    } else {
      const parentId = treeFindParentId(root, targetId)
      newRoot = treeInsert(root, copies[0], parentId, targetId)
      for (let i = 1; i < copies.length; i++) {
        newRoot = treeInsert(newRoot, copies[i], parentId, copies[i - 1].id)
      }
    }

    const isCut = clipboard.cut
    if (isCut) {
      newRoot = treeRemoveMany(newRoot, originalNodes.map(n => n.id))
      setClipboard(null)
    }

    onRootChange(newRoot)
    effectiveOnSelect(copies.map(n => n.id))

    // T65: create backend objects for all copied item nodes
    if (onItemNodeAdded) {
      const copiedItems = collectItemNodes(copies)
      const originalItems = collectItemNodes(originalNodes)
      copiedItems.forEach((copy, i) => {
        const sourceObjectId = isCut ? undefined : originalItems[i]?.objectId
        onItemNodeAdded(copy.id, sourceObjectId)
      })
    }
  }

  function handleContextMenu(e: React.MouseEvent, nodeId: string) {
    e.preventDefault()
    e.stopPropagation()
    if (!effectiveSelectedIds.includes(nodeId)) effectiveOnSelect([nodeId])
    setContextMenu({ nodeId, x: e.clientX, y: e.clientY })
  }

  function handleContextAction(action: string) {
    const targetId = contextMenu?.nodeId ?? null
    if (!targetId) return
    const ids = effectiveSelectedIds.includes(targetId) ? effectiveSelectedIds : [targetId]
    switch (action) {
      case 'copy': copyToClipboard(ids, false); break
      case 'cut': copyToClipboard(ids, true); break
      case 'paste': paste(targetId); break
      case 'delete': initiateDelete(ids); break
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const focused = document.activeElement
    if (focused && focused !== containerRef.current &&
      (focused.tagName === 'INPUT' || focused.tagName === 'SELECT' || focused.tagName === 'TEXTAREA' ||
        (focused as HTMLElement).isContentEditable)) return

    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      if (effectiveSelectedIds.length > 0) { e.preventDefault(); copyToClipboard(effectiveSelectedIds, false) }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
      if (canEdit && effectiveSelectedIds.length > 0) { e.preventDefault(); copyToClipboard(effectiveSelectedIds, true) }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      if (canEdit && generateId && clipboard && effectiveSelectedIds.length > 0) {
        e.preventDefault(); paste(effectiveSelectedIds[0])
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) {
      if (effectiveSelectedIds.length > 0) { e.preventDefault(); initiateDelete(effectiveSelectedIds) }
    } else if (e.key === 'Escape') {
      if (deleteConfirm) setDeleteConfirm(null)
      else if (clipboard?.cut) setClipboard(null)
    }
  }

  const filteredRows = rows.filter(r => {
    if (r.kind === 'folder') return true // always show folders when filtering
    const obj = r.node.objectId ? objectMap.get(r.node.objectId) : null

    if (filterLower) {
      const globalMatch = !obj
        ? r.node.name.toLowerCase().includes(filterLower)
        : columns.some(col => getCellText(r.node, obj, col).toLowerCase().includes(filterLower))
      if (!globalMatch) return false
    }

    return activeColumnFilters.every(({ col, re }) => re.test(getCellText(r.node, obj, col)))
  })

  const visibleRowIds = filteredRows.map(r => r.node.id)

  function handleRowSelect(nodeId: string, e: React.MouseEvent) {
    if (e.shiftKey && effectiveSelectedIds.length > 0) {
      const lastId = effectiveSelectedIds[effectiveSelectedIds.length - 1]
      const from = visibleRowIds.indexOf(lastId)
      const to = visibleRowIds.indexOf(nodeId)
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from]
        effectiveOnSelect(visibleRowIds.slice(start, end + 1))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      if (effectiveSelectedIds.includes(nodeId)) {
        effectiveOnSelect(effectiveSelectedIds.filter(id => id !== nodeId))
      } else {
        effectiveOnSelect([...effectiveSelectedIds, nodeId])
      }
      return
    }
    effectiveOnSelect([nodeId])
  }

  // T51 — l'en-tête (et ses icônes de filtre par colonne) reste toujours monté même
  // quand aucune ligne ne correspond : sans ça, un filtre qui exclut tout masquait
  // l'unique endroit permettant de le modifier ou de l'effacer.
  const colCount = columns.length + (onEditOpen ? 1 : 0)

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto outline-none"
      tabIndex={0}
      onClick={() => effectiveOnSelect([])}
      onKeyDown={handleKeyDown}
    >
      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-ink mb-2">Supprimer ?</h2>
            <p className="text-xs text-ink-2 mb-5">
              {deleteConfirm.hasContent
                ? 'Ce dossier contient des éléments. Tout le contenu sera supprimé en cascade.'
                : deleteConfirm.ids.length > 1 ? 'Ces éléments seront supprimés.' : 'Cet élément sera supprimé.'}
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
        <ExcelContextMenu
          x={contextMenu.x} y={contextMenu.y}
          canEdit={canEdit}
          clipboard={clipboard}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      <table className="text-xs border-collapse" style={{ width: effectiveTableWidth, tableLayout: 'fixed' }}>
        <thead className="sticky top-0 z-10">
          <tr>
            {onEditOpen && <th className="border border-edge w-8 bg-hover" />}
            {columns.map((col, colIdx) => {
              const colStyle: React.CSSProperties = {
                width: colIdx === columns.length - 1 ? lastColWidth : effectiveColWidths[col],
                position: 'relative',
                userSelect: 'none',
                opacity: col === draggingCol ? 0.5 : 1,
                ...(dropColTarget?.col === col && dropColTarget.position === 'before'
                  ? { boxShadow: 'inset 2px 0 0 0 #3b82f6' }
                  : dropColTarget?.col === col && dropColTarget.position === 'after'
                  ? { boxShadow: 'inset -2px 0 0 0 #3b82f6' }
                  : {}),
              }
              return (
                <th
                  key={col}
                  style={colStyle}
                  className="border border-edge px-2 py-1.5 text-left font-medium text-ink-2 bg-hover text-xs whitespace-nowrap"
                  draggable={!!onColumnsReorder && col !== 'section'}
                  onDragStart={onColumnsReorder && col !== 'section' ? (e) => handleColDragStart(e, col) : undefined}
                  onDragOver={onColumnsReorder && col !== 'section' ? (e) => handleColDragOver(e, col) : undefined}
                  onDrop={onColumnsReorder && col !== 'section' ? (e) => handleColDrop(e, col) : undefined}
                  onDragEnd={onColumnsReorder && col !== 'section' ? handleColDragEnd : undefined}
                >
                  {getColumnLabel(col)}
                  {isSystemField(col) && <span className="ml-1 text-ink-3 font-normal">(sys)</span>}
                  {isFilterableColumn(col) && (
                    <button
                      type="button"
                      draggable={false}
                      data-column-filter-icon
                      title="Filtrer cette colonne"
                      onClick={e => {
                        e.stopPropagation()
                        if (activeColumnFilterPopover?.column === col) {
                          setActiveColumnFilterPopover(null)
                          return
                        }
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setActiveColumnFilterPopover({ column: col, top: rect.bottom + 4, left: rect.left, width: 220 })
                      }}
                      className={[
                        'ml-1 align-middle',
                        activeColumnFilters.some(f => f.col === col) ? 'text-blue-500' : 'text-ink-3 hover:text-ink-2',
                      ].join(' ')}
                    >
                      <FilterIcon size={10} />
                    </button>
                  )}
                  <div
                    style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize' }}
                    className="hover:bg-blue-400"
                    onMouseDown={(e) => handleColResizeStart(e, col)}
                  />
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {filteredRows.length === 0 && (
            <tr>
              <td colSpan={colCount} className="px-3 py-6 text-center text-ink-3 text-xs">
                Aucun élément
              </td>
            </tr>
          )}
          {filteredRows.map(({ kind, node, depth }) => {
            const rowDrop = rowDropIndicator?.targetNodeId === node.id ? rowDropIndicator : null
            const isDraggingRow = draggingNodeId === node.id
            const dropStyle: React.CSSProperties = {}
            if (rowDrop?.position === 'before') dropStyle.borderTop = '2px solid #3b82f6'
            else if (rowDrop?.position === 'after') dropStyle.borderBottom = '2px solid #3b82f6'
            const dropInside = rowDrop?.position === 'inside'

            if (kind === 'folder') {
              return (
                <GroupRow
                  key={node.id}
                  node={node}
                  depth={depth}
                  columns={columns}
                  isExpanded={!collapsedFolders.has(node.id)}
                  section={sectionNumbers?.get(node.id)}
                  hasActions={!!onEditOpen}
                  onToggle={() => toggleFolder(node.id)}
                  onRename={onRenameNode}
                  draggable={dndEnabled}
                  onDragStart={dndEnabled ? (e) => handleRowDragStart(e, node.id) : undefined}
                  onDragOver={dndEnabled ? (e) => handleRowDragOver(e, node.id) : undefined}
                  onDrop={dndEnabled ? handleRowDrop : undefined}
                  onDragEnd={dndEnabled ? handleRowDragEnd : undefined}
                  isDragging={isDraggingRow}
                  dropStyle={dropStyle}
                  dropInside={dropInside}
                  isSelected={effectiveSelectedIds.includes(node.id)}
                  onSelectRow={e => handleRowSelect(node.id, e)}
                  onContextMenu={e => handleContextMenu(e, node.id)}
                />
              )
            }

            const obj = node.objectId ? objectMap.get(node.objectId) : null
            const isSelected = effectiveSelectedIds.includes(node.id)
            const isCutRow = clipboard?.cut && clipboard.nodes.some(n => n.id === node.id)
            const nodeSteps = node.objectId ? (stepsByObjectId?.get(node.objectId) ?? []) : []
            const stepsExpanded = expandedStepIds.has(node.id)
            return (
              <React.Fragment key={node.id}>
              <tr
                className={[
                  'group cursor-pointer select-none',
                  isSelected ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-row-hover',
                  isDraggingRow || isCutRow ? 'opacity-50' : '',
                  dropInside ? 'outline outline-1 outline-blue-400' : '',
                ].filter(Boolean).join(' ')}
                style={dropStyle}
                onClick={e => { e.stopPropagation(); handleRowSelect(node.id, e) }}
                onContextMenu={e => handleContextMenu(e, node.id)}
                draggable={dndEnabled}
                onDragStart={dndEnabled ? (e) => handleRowDragStart(e, node.id) : undefined}
                onDragOver={dndEnabled ? (e) => handleRowDragOver(e, node.id) : undefined}
                onDrop={dndEnabled ? handleRowDrop : undefined}
                onDragEnd={dndEnabled ? handleRowDragEnd : undefined}
              >
                {onEditOpen && (
                  <td className="border border-edge px-1 text-center">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onEditOpen(node.id) }}
                      className="text-ink-3 hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity p-1"
                      title="Éditer"
                    >
                      <Pencil size={12} />
                    </button>
                  </td>
                )}
                {columns.map(col => {
                  if (col === 'steps') {
                    const stepsCount = nodeSteps.length
                    return (
                      <td
                        key={col}
                        className="border border-edge px-2 py-1 text-xs cursor-pointer hover:ring-1 hover:ring-inset hover:ring-blue-400"
                        onClick={e => { e.stopPropagation(); toggleStepExpand(node.id) }}
                        title={stepsExpanded ? 'Masquer les étapes' : stepsCount > 0 ? `${stepsCount} étape${stepsCount > 1 ? 's' : ''}` : 'Aucune étape'}
                      >
                        <span className="flex items-center gap-1 text-ink-2">
                          {stepsExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          {stepsCount > 0 ? stepsCount : <span className="text-ink-3 italic">—</span>}
                        </span>
                      </td>
                    )
                  }
                  if (col === 'name') {
                    return (
                      <NameCell
                        key={col}
                        value={node.name}
                        nodeId={node.id}
                        onRename={onRenameNode}
                      />
                    )
                  }
                  if (col.startsWith('link::')) {
                    const typeName = col.slice(6)
                    const objectId = node.objectId ?? ''
                    const value = getLinkCellValue(objectId, typeName)
                    const lt = linkTypes.find(l => l.name === typeName)
                    const cellLinks = linksByObjectId?.get(objectId)?.filter(l => l.type === typeName) ?? []
                    const isOpen = activeLinkPopover?.nodeId === node.id && activeLinkPopover.typeName === typeName
                    return (
                      <td
                        key={col}
                        data-link-popover
                        className="border border-edge px-2 py-1 text-xs text-ink-2 max-w-xs truncate cursor-pointer hover:ring-1 hover:ring-inset hover:ring-blue-400"
                        title={value || undefined}
                        onClick={e => {
                          if (isOpen) { setActiveLinkPopover(null); return }
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          setActiveLinkPopover({ nodeId: node.id, typeName, top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 320) })
                        }}
                      >
                        {value || <span className="text-ink-3 italic">—</span>}
                      </td>
                    )
                  }
                  const value = getCellText(node, obj, col)
                  const fieldDef: SchemaField | undefined = col === 'status'
                    ? (typeDef?.statuses?.length
                      ? { name: 'status', type: 'enum' as const, values: typeDef.statuses.map(s => s.name) }
                      : undefined)
                    : typeDef?.fields.find(f => f.name === col)
                  return (
                    <InlineCell
                      key={col}
                      value={value}
                      field={col}
                      objectId={node.objectId ?? ''}
                      isSystem={isSystemField(col)}
                      fieldDef={fieldDef}
                      onEdit={onInlineEdit}
                      onRichtextEdit={onInlineEdit ? (objId, f, rect) => {
                        const isOpen = activeRichtextPopover?.objectId === objId && activeRichtextPopover.field === f
                        if (isOpen) { setActiveRichtextPopover(null); return }
                        const origObj = objectMap.get(objId)
                        richtextOriginalValueRef.current = origObj ? getFieldValue(origObj, f) : ''
                        setActiveRichtextPopover({ objectId: objId, field: f, top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 400) })
                      } : undefined}
                    />
                  )
                })}
              </tr>
              {stepsByObjectId !== undefined && stepsExpanded && node.objectId && (
                <tr>
                  <td colSpan={colCount} className="border-b border-edge p-0 bg-surface">
                    <div className="px-4 py-3">
                      <StepsPanel
                        objectId={node.objectId}
                        steps={nodeSteps}
                        onStepsChange={onStepsChange}
                        repoPath={repoPath}
                      />
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>

      {/* T51 — popover de filtre colonne */}
      {activeColumnFilterPopover && (() => {
        const col = activeColumnFilterPopover.column
        const current = columnFilters[col] ?? { text: '', options: DEFAULT_FILTER_OPTIONS }
        const setCurrent = (next: ColumnFilterState) => {
          setColumnFilters(prev => ({ ...prev, [col]: next }))
        }
        return (
          <div
            data-column-filter-popover
            style={{
              position: 'fixed',
              top: activeColumnFilterPopover.top,
              left: activeColumnFilterPopover.left,
              width: activeColumnFilterPopover.width,
              zIndex: 50,
            }}
            className="bg-surface border border-edge rounded-lg shadow-xl p-2 space-y-2"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={current.text}
                onChange={e => setCurrent({ ...current, text: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setCurrent({ ...current, text: '' })
                    setActiveColumnFilterPopover(null)
                  }
                }}
                placeholder="Filtrer…"
                className="flex-1 text-xs bg-transparent text-ink border border-edge rounded px-2 py-1 outline-none"
              />
              {current.text && (
                <button
                  type="button"
                  onClick={() => setCurrent({ ...current, text: '' })}
                  className="text-ink-3 hover:text-ink text-xs"
                >
                  ✕
                </button>
              )}
            </div>
            <FilterOptionsToggle
              options={current.options}
              onChange={opts => setCurrent({ ...current, options: opts })}
            />
          </div>
        )
      })()}

      {/* Richtext popover — fixed position to escape overflow-auto clipping */}
      {activeRichtextPopover && (() => {
        const popoverObj = objectMap.get(activeRichtextPopover.objectId)
        const popoverValue = popoverObj ? (popoverObj as Record<string, string>)[activeRichtextPopover.field] ?? '' : ''
        return (
          <div
            data-richtext-popover
            style={{
              position: 'fixed',
              top: activeRichtextPopover.top,
              left: activeRichtextPopover.left,
              width: Math.max(activeRichtextPopover.width, 400),
              zIndex: 50,
            }}
            className="bg-surface border border-edge rounded shadow-lg overflow-hidden"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                onInlineEdit?.(activeRichtextPopover.objectId, activeRichtextPopover.field, richtextOriginalValueRef.current)
                setActiveRichtextPopover(null)
              } else if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                setActiveRichtextPopover(null)
              }
            }}
          >
            <RichTextField
              value={popoverValue}
              onChange={v => {
                onInlineEdit?.(activeRichtextPopover.objectId, activeRichtextPopover.field, v)
              }}
              repoPath={repoPath}
            />
          </div>
        )
      })()}

      {/* Link popover — fixed position to escape overflow-auto clipping */}
      {activeLinkPopover && (() => {
        const lt = linkTypes.find(l => l.name === activeLinkPopover.typeName)
        const objectId = rows.find(r => r.node.id === activeLinkPopover.nodeId)?.node.objectId ?? ''
        const cellLinks = linksByObjectId?.get(objectId)?.filter(l => l.type === activeLinkPopover.typeName) ?? []
        if (!lt || !isLinkTypeValid(lt)) return null
        const currentObjectTypeRef = (objectMap.get(objectId) as Record<string, string>)?.objectTypeRef ?? ''
        const currentCategory = typeDef?.category
        const canBeSource = matchesRefs(currentObjectTypeRef, lt.sourceRefs, currentCategory)
        const canBeTarget = matchesRefs(currentObjectTypeRef, lt.targetRefs, currentCategory)
        return (
          <div
            data-link-popover
            className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl p-3 space-y-3"
            style={{ top: activeLinkPopover.top, left: activeLinkPopover.left, width: activeLinkPopover.width }}
            onClick={e => e.stopPropagation()}
          >
            {canBeSource && (
              <LinkCombobox
                label={lt.labelSourceToTarget}
                existingLinks={cellLinks.filter(l => l.sourceId === objectId).map(l => ({ linkId: l.id, peerId: getPeerId(l, objectId) }))}
                candidates={filterCandidatesByRefs(candidateObjects, lt.targetRefs)}
                onAdd={async peerId => {
                  if (!repoPath) return
                  await api.requirements.linkCreate(repoPath, { type: activeLinkPopover.typeName, sourceId: objectId, targetId: peerId })
                  onLinkChange?.()
                }}
                onRemove={async linkId => {
                  if (!repoPath) return
                  await api.requirements.linkDelete(repoPath, linkId)
                  onLinkChange?.()
                }}
                onNavigateToObject={onNavigateToObject ? peerId => { setActiveLinkPopover(null); onNavigateToObject(peerId) } : undefined}
              />
            )}
            {canBeTarget && (
              <LinkCombobox
                label={lt.labelTargetToSource}
                existingLinks={cellLinks.filter(l => l.targetId === objectId).map(l => ({ linkId: l.id, peerId: getPeerId(l, objectId) }))}
                candidates={filterCandidatesByRefs(candidateObjects, lt.sourceRefs)}
                onAdd={async peerId => {
                  if (!repoPath) return
                  await api.requirements.linkCreate(repoPath, { type: activeLinkPopover.typeName, sourceId: peerId, targetId: objectId })
                  onLinkChange?.()
                }}
                onRemove={async linkId => {
                  if (!repoPath) return
                  await api.requirements.linkDelete(repoPath, linkId)
                  onLinkChange?.()
                }}
                onNavigateToObject={onNavigateToObject ? peerId => { setActiveLinkPopover(null); onNavigateToObject(peerId) } : undefined}
              />
            )}
          </div>
        )
      })()}
    </div>
  )
}
