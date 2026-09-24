import React, { useState, useCallback, useRef, useEffect, createContext, useContext, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LinkCombobox } from './LinkCombobox'
import type { Candidate } from './LinkCombobox'
import { api } from '../../api'
import { ChevronRight, ChevronDown, Pencil, Filter as FilterIcon } from 'lucide-react'
import type { TypeTreeNode, ObjectTypeDefinition, LinkTypeDefinition, ObjectLink, Requirement, TestCase, SchemaField, CoverageStatus, MatrixCell } from '@polenta/types'
import { parseMultiEnumValue, serializeMultiEnumValue, resolveMultiEnumOptions } from '@polenta/types'
import { CoverageBadge } from './CoverageBadge'
import { treeFindNode, treeFindParentId, treeRemoveMany, treeInsert, treeInsertAtBeginning, treeDeepCopyWithNewIds } from '../../hooks/useTreeState'
import { matchesRefs, filterCandidatesByRefs, getLinkTypeLabel, getPeerId, isLinkTypeValid } from './linkUtils'
import { RichTextField } from '../RichTextField'
import { StaticRichTextViewer } from '../../lib/staticRichText'
import { RenderGateProvider, useRenderWhenVisibleAtRest } from './useRenderWhenVisibleAtRest'
import { MultiEnumPopover } from './MultiEnumPopover'
import { useProjectSchema } from '../../hooks/useProjectSchema'
import { useScrollToNode } from '../../hooks/useScrollToNode'
import { StepsTable } from '../StepsTable'
import type { StepDraft } from '../StepsTable'
import { getExportColumnLabel } from '../../lib/exportColumns'
import { FilterOptionsToggle } from '../FilterOptionsToggle'
import { buildFilterRegex, NO_FILTER_OPTIONS, type FilterOptions } from '../../lib/textFilter'

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
  /** T162 — masque les lignes de groupe (dossiers) : liste plate, collapse ignoré. */
  foldersHidden?: boolean
  sectionNumbers?: Map<string, string>
  linkTypes?: LinkTypeDefinition[]
  linksByObjectId?: Map<string, ObjectLink[]>
  coverageByReqId?: Map<string, { coverageStatus: CoverageStatus; cells: MatrixCell[] }>
  testsById?: Map<string, TestCase>
  repoPath?: string
  candidateObjects?: Candidate[]
  onLinkChange?: () => void
  onInlineEdit?: (objectId: string, field: string, value: string) => void
  onRenameNode?: (nodeId: string, name: string) => void
  onEditOpen?: (nodeId: string) => void
  onRootChange?: (root: TypeTreeNode[]) => void
  onColumnsReorder?: (newOrder: string[]) => void
  filter?: string
  /** T166 — mode du filtre global (casse / mot entier / regex). Sans lui, le filtre global du
   *  tableau restait une sous-chaîne littérale insensible à la casse, incohérent avec l'arbre. */
  filterOptions?: FilterOptions
  selectedIds?: string[]
  onSelect?: (ids: string[]) => void
  generateId?: () => string
  stepsByObjectId?: Map<string, { action: string; expectedResult: string }[]>
  onStepsChange?: (objectId: string, steps: StepDraft[]) => void
  onNavigateToObject?: (peerId: string, opts?: { newTab?: boolean }) => void
  onItemNodeAdded?: (nodeId: string, sourceObjectId?: string) => void
  /** T164 — nœud d'arbre (item ou folder) sur lequel se positionner (scroll + contour) ;
   *  `gotoSeq` s'incrémente à chaque requête pour re-scroller sur une cible identique. */
  gotoNodeId?: string | null
  gotoSeq?: number
  /** Hauteur max d'une ligne, en nombre de lignes de texte (1 = une seule ligne tronquée). */
  rowMaxLines?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Hauteur max des lignes (en lignes de texte) — fournie par `ExcelView`, lue par les cellules
 *  via `useCellClamp` plutôt que propagée en prop à chaque composant de cellule. */
const RowMaxLinesContext = createContext(1)

/** Classe du `<td>` et enveloppe du contenu selon la hauteur max des lignes : à 1, la cellule
 *  reste mono-ligne tronquée (`truncate`) ; au-delà, le texte passe à la ligne et est coupé
 *  (ellipse) après `maxLines` lignes. */
function useCellClamp() {
  const maxLines = useContext(RowMaxLinesContext)
  if (maxLines <= 1) {
    return { maxLines, tdClass: 'truncate', wrap: (content: React.ReactNode) => content }
  }
  const style: React.CSSProperties = {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: maxLines,
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  }
  return { maxLines, tdClass: '', wrap: (content: React.ReactNode) => <div style={style}>{content}</div> }
}

function ClampedContent({ children }: { children: React.ReactNode }) {
  const clamp = useCellClamp()
  return <>{clamp.wrap(children)}</>
}

/** T164 — contour persistant de la ligne / ligne de groupe ciblée par un "goto" depuis
 *  l'arbre. Trait bleu plein en retrait, distinct de la surbrillance de sélection (fond pâle)
 *  et de l'outline fin/transitoire du drop (`outline-1 outline-status-info`). */
const GOTO_OUTLINE_CLASS = 'outline outline-2 -outline-offset-2 outline-status-info-solid'

function getObjectId(obj: AnyObject): string {
  return (obj as Record<string, unknown>)['id'] as string ?? ''
}

function getFieldValue(obj: AnyObject, field: string): string {
  const val = (obj as Record<string, unknown>)[field]
  if (val === undefined || val === null) return ''
  return String(val)
}

function isSystemField(field: string): boolean {
  return ['section', 'id', 'createdAt', 'updatedAt', 'author', 'objectTypeRef', 'version', 'coverageStatus'].includes(field)
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
  // coverageStatus (T138) n'a pas de valeur texte brute sur l'objet — rendu par icône uniquement,
  // pas de filtre de colonne pertinent (même raison que 'steps').
  return col !== 'steps' && col !== 'coverageStatus'
}

// ── NameCell ──────────────────────────────────────────────────────────────────

function NameCell({
  value,
  nodeId,
  onRename,
  isSelected,
  onSelectCell,
  freezeStyle,
  stickyBg,
}: {
  value: string
  nodeId: string
  onRename?: (nodeId: string, name: string) => void
  isSelected?: boolean
  onSelectCell?: () => void
  freezeStyle?: React.CSSProperties
  stickyBg?: string
}) {
  const { t } = useTranslation()
  const clamp = useCellClamp()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const commit = () => {
    if (draft.trim() && draft !== value) onRename?.(nodeId, draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <td className={['border border-edge px-0 py-0', stickyBg ?? ''].join(' ')} style={freezeStyle}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(value); setEditing(false) }
          }}
          className="w-full px-2 py-1 text-xs text-ink bg-status-info-bg border-0 outline-none"
        />
      </td>
    )
  }

  return (
    <td
      style={freezeStyle}
      className={[
        'border border-edge px-2 py-1 text-xs text-ink max-w-xs',
        clamp.tdClass,
        stickyBg ?? '',
        onRename ? 'cursor-text hover:ring-1 hover:ring-inset hover:ring-status-info' : '',
        isSelected ? 'ring-2 ring-inset ring-status-info' : '',
      ].join(' ')}
      onClick={onRename ? () => {
        if (isSelected) { setDraft(value); setEditing(true) }
        else onSelectCell?.()
      } : undefined}
      title={onRename ? t('system.shared.clickToEdit') : undefined}
    >
      {clamp.wrap(value || <span className="text-ink-3 italic">—</span>)}
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
  richtext,
  onMultiEnumEdit,
  isSelected,
  onSelectCell,
  freezeStyle,
  stickyBg,
}: {
  value: string
  field: string
  objectId: string
  isSystem: boolean
  fieldDef?: SchemaField
  onEdit?: (objectId: string, field: string, value: string) => void
  /** T169 — cellule richtext : rendu mis en forme + édition en place (voir `RichtextCell`). */
  richtext?: Omit<RichtextCellProps, 'value' | 'isSelected' | 'onSelectCell' | 'freezeStyle' | 'stickyBg'>
  onMultiEnumEdit?: (objectId: string, field: string, rect: DOMRect) => void
  isSelected?: boolean
  onSelectCell?: () => void
  freezeStyle?: React.CSSProperties
  stickyBg?: string
}) {
  const { t } = useTranslation()
  const clamp = useCellClamp()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (fieldDef?.type === 'richtext' && !isSystem && richtext) {
    return (
      <RichtextCell
        {...richtext}
        value={value}
        isSelected={isSelected}
        onSelectCell={onSelectCell}
        freezeStyle={freezeStyle}
        stickyBg={stickyBg}
      />
    )
  }

  if (isSystem || !onEdit) {
    return (
      <td style={freezeStyle} className={['border border-edge px-2 py-1 text-xs text-ink-3 bg-hover max-w-xs', clamp.tdClass].join(' ')}>
        {clamp.wrap(value)}
      </td>
    )
  }

  // multi_enum: CSV preview in read mode, open cases-à-cocher popover on click
  if (fieldDef?.type === 'multi_enum') {
    return (
      <td
        data-multi-enum-popover
        style={freezeStyle}
        className={[
          'border border-edge px-2 py-1 text-xs text-ink cursor-text max-w-xs hover:ring-1 hover:ring-inset hover:ring-status-info',
          clamp.tdClass,
          stickyBg ?? '',
          isSelected ? 'ring-2 ring-inset ring-status-info' : '',
        ].join(' ')}
        onClick={e => {
          if (!isSelected) { onSelectCell?.(); return }
          if (onMultiEnumEdit) {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onMultiEnumEdit(objectId, field, rect)
          }
        }}
        title={t('system.shared.clickToEdit')}
      >
        {clamp.wrap(value || <span className="text-ink-3 italic">—</span>)}
      </td>
    )
  }

  if (editing) {
    if (fieldDef?.type === 'enum') {
      return (
        <td style={freezeStyle} className={['border border-edge px-0 py-0', stickyBg ?? ''].join(' ')}>
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
      <td style={freezeStyle} className={['border border-edge px-0 py-0', stickyBg ?? ''].join(' ')}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { onEdit(objectId, field, draft); setEditing(false) }}
          onKeyDown={e => {
            if (e.key === 'Enter') { onEdit(objectId, field, draft); setEditing(false) }
            if (e.key === 'Escape') { setDraft(value); setEditing(false) }
          }}
          className="w-full px-2 py-1 text-xs text-ink bg-status-info-bg border-0 outline-none"
        />
      </td>
    )
  }

  return (
    <td
      style={freezeStyle}
      className={[
        'border border-edge px-2 py-1 text-xs text-ink cursor-text max-w-xs hover:ring-1 hover:ring-inset hover:ring-status-info',
          clamp.tdClass,
        stickyBg ?? '',
        isSelected ? 'ring-2 ring-inset ring-status-info' : '',
      ].join(' ')}
      onClick={() => {
        if (isSelected) { setDraft(value); setEditing(true) }
        else onSelectCell?.()
      }}
      title={t('system.shared.clickToEdit')}
    >
      {clamp.wrap(value || <span className="text-ink-3 italic">—</span>)}
    </td>
  )
}

// ── RichtextCell (T169) ──────────────────────────────────────────────────────

interface RichtextCellProps {
  value: string
  repoPath?: string
  isSelected?: boolean
  onSelectCell?: () => void
  freezeStyle?: React.CSSProperties
  stickyBg?: string
  /** Absent : cellule en lecture seule (pas d'entrée en édition). */
  onStartEdit?: () => void
  isEditing: boolean
  /** Valeur live de l'objet pendant l'édition (mise à jour à chaque frappe). */
  editValue: string
  onEditChange: (value: string) => void
  onEditCommit: () => void
  onEditCancel: () => void
  /** Signale à ExcelView un mousedown « dans l'éditeur » — y compris dans ses menus rendus
   *  par portail (tableau, page draw.io), dont les évènements React remontent jusqu'ici. */
  onEditorMouseDown: () => void
}

/** Hauteur max « N lignes » d'un rendu richtext mis en forme : `-webkit-line-clamp` est
 *  inopérant sur du HTML en blocs, d'où `max-height` + estompage du bas (masque, indépendant
 *  de la couleur de fond : sélection, survol, colonne figée, thème) seulement si ça déborde. */
function RichtextClamp({ maxLines, children }: { maxLines: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1)
    check()
    // Contenu observé (et pas seulement la boîte bornée) : images et diagrammes draw.io se
    // chargent en asynchrone et font grandir le contenu sans changer la boîte.
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [maxLines])
  const mask = overflowing ? 'linear-gradient(to bottom, #000 calc(100% - 1rem), transparent)' : undefined
  return (
    <div ref={ref} style={{ maxHeight: `${maxLines}rem`, overflow: 'hidden', maskImage: mask, WebkitMaskImage: mask }}>
      {children}
    </div>
  )
}

function RichtextCell({
  value,
  repoPath,
  isSelected,
  onSelectCell,
  freezeStyle,
  stickyBg,
  onStartEdit,
  isEditing,
  editValue,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onEditorMouseDown,
}: RichtextCellProps) {
  const { t } = useTranslation()
  const clamp = useCellClamp()
  const tdRef = useRef<HTMLTableCellElement>(null)
  // Rendu mis en forme seulement si la cellule est visible et le défilement au repos — à
  // hauteur max 1, la cellule garde la 1re ligne brute et ne s'inscrit pas.
  const rendered = useRenderWhenVisibleAtRest(tdRef, clamp.maxLines > 1 && !isEditing)

  // Entrée en édition : amener le haut de l'éditeur à l'écran si la cellule agrandie déborde.
  useEffect(() => {
    if (isEditing) tdRef.current?.scrollIntoView({ block: 'nearest' })
  }, [isEditing])

  if (isEditing) {
    return (
      <td
        ref={tdRef}
        data-richtext-cell-editor
        style={freezeStyle}
        // Cadre d'édition = contour de la cellule (l'éditeur compact n'a pas de bordure propre),
        // pour que le texte reste exactement à sa place entre lecture et édition.
        className={['border border-edge p-0 align-top cursor-auto select-text ring-2 ring-inset ring-status-info', stickyBg ?? ''].join(' ')}
        onMouseDown={onEditorMouseDown}
        onClick={e => e.stopPropagation()}
        // Le clic droit appartient à l'éditeur (menu de tableau), pas au menu de ligne.
        onContextMenu={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onEditCancel()
          } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            // Garde-fou hors éditeur (ex. textarea Raw) : dans Tiptap, `onSubmit` s'en charge.
            e.preventDefault()
            e.stopPropagation()
            onEditCommit()
          }
        }}
      >
        <RichTextField
          value={editValue}
          onChange={onEditChange}
          repoPath={repoPath}
          autoFocus
          onSubmit={onEditCommit}
          variant="compact"
        />
      </td>
    )
  }

  const nonEmptyLines = value.split('\n').filter(l => l.trim())
  let content: React.ReactNode
  if (!value) {
    content = <span className="text-ink-3 italic">—</span>
  } else if (clamp.maxLines <= 1) {
    content = (
      <span className="text-xs text-ink truncate">
        {nonEmptyLines[0] ?? ''}
        {nonEmptyLines.length > 1 && <span className="text-ink-3 ml-1">¶</span>}
      </span>
    )
  } else if (rendered) {
    content = (
      <RichtextClamp maxLines={clamp.maxLines}>
        <StaticRichTextViewer value={value} repoPath={repoPath} variant="compact" />
      </RichtextClamp>
    )
  } else {
    // Pas encore visible au repos : texte brut tronqué (T168), de hauteur voisine.
    content = clamp.wrap(nonEmptyLines.join('\n'))
  }

  return (
    <td
      ref={tdRef}
      style={freezeStyle}
      className={[
        'border border-edge px-2 py-1 text-xs text-ink',
        onStartEdit ? 'cursor-text hover:ring-1 hover:ring-inset hover:ring-status-info' : '',
        clamp.maxLines <= 1 ? 'truncate max-w-xs' : '',
        stickyBg ?? '',
        isSelected ? 'ring-2 ring-inset ring-status-info' : '',
      ].join(' ')}
      onClick={e => {
        // Un lien du rendu ne s'ouvre pas dans la cellule : le clic suit le geste de la
        // cellule (sélection, puis édition), comme en Vue Word.
        if ((e.target as HTMLElement).closest('a')) e.preventDefault()
        if (!isSelected) { onSelectCell?.(); return }
        onStartEdit?.()
      }}
      title={onStartEdit ? t('system.shared.clickToEdit') : undefined}
    >
      {content}
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
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onClose])

  const items: ExcelMenuItem[] = [{ id: 'copy', label: t('system.shared.copy') }]
  if (canEdit) items.push({ id: 'cut', label: t('system.shared.cut') })
  if (canEdit && clipboard) items.push({ id: 'paste', label: t('system.shared.paste') })
  items.push({ separator: true })
  if (canEdit) items.push({ id: 'delete', label: t('common.delete'), danger: true })

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
              item.danger ? 'text-status-danger' : 'text-ink',
            ].join(' ')}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}

// ── ColumnFreezeMenu — figer/libérer les volets (T151) ───────────────────────

function ColumnFreezeMenu({
  x, y, colIdx, freezeColCount, onFreeze, onUnfreeze, onClose,
}: {
  x: number; y: number
  colIdx: number
  freezeColCount: number
  onFreeze: (uptoColIdx: number) => void
  onUnfreeze: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onClose])

  const alreadyFrozenHere = freezeColCount === colIdx + 1

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl py-1 w-56 text-xs"
      style={{ left: x, top: y }}
    >
      {!alreadyFrozenHere && (
        <button
          type="button"
          onClick={() => { onFreeze(colIdx + 1); onClose() }}
          className="w-full text-left px-3 py-1.5 hover:bg-hover transition-colors text-ink"
        >
          {t('system.excelView.freezeColumns')}
        </button>
      )}
      {freezeColCount > 0 && (
        <button
          type="button"
          onClick={() => { onUnfreeze(); onClose() }}
          className="w-full text-left px-3 py-1.5 hover:bg-hover transition-colors text-ink"
        >
          {t('system.excelView.unfreezeColumns')}
        </button>
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
  isNameCellSelected,
  onSelectNameCell,
  freezeColCount = 0,
  getFreezeStyle,
  isGotoTarget,
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
  isNameCellSelected?: boolean
  onSelectNameCell?: () => void
  freezeColCount?: number
  getFreezeStyle?: (colIdx: number) => React.CSSProperties | undefined
  isGotoTarget?: boolean
}) {
  const [folderEditing, setFolderEditing] = useState(false)
  const startOrSelect = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isNameCellSelected) setFolderEditing(true)
    else onSelectNameCell?.()
  }
  // Le pencil d'action (index "-1", avant la 1ère colonne) suit la même règle que
  // l'en-tête : il se fige dès qu'au moins une colonne est figée, pour rester adjacent
  // à elle sans laisser un vide de scroll entre les deux.
  const actionFrozenStyle: React.CSSProperties | undefined = freezeColCount > 0 ? { position: 'sticky', left: 0, zIndex: 2 } : undefined
  const rowBg = isSelected ? 'bg-status-info-bg' : 'bg-folder-row'

  return (
    <tr
      data-node-id={node.id}
      className={[
        'cursor-pointer select-none scroll-mt-8',
        isSelected ? 'bg-status-info-bg' : 'bg-folder-row',
        isDragging ? 'opacity-50' : '',
        dropInside ? 'outline outline-1 outline-status-info' : '',
        isGotoTarget ? GOTO_OUTLINE_CLASS : '',
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
          style={actionFrozenStyle}
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
              <td
                style={getFreezeStyle?.(0)}
                className={['border border-edge px-2 py-1.5 text-xs font-semibold text-ink-2', freezeColCount > 0 ? rowBg : ''].join(' ')}
              >
                <span className="flex items-center gap-1.5">
                  {chevron}
                  <span className="text-ink-3 font-mono font-normal">{section ?? ''}</span>
                </span>
              </td>
              <td
                colSpan={restCount || 1}
                className={[
                  'border border-edge px-2 py-1.5 text-xs font-semibold text-ink-2',
                  onRename ? 'hover:ring-1 hover:ring-inset hover:ring-status-info cursor-text' : '',
                  isNameCellSelected ? 'ring-2 ring-inset ring-status-info' : '',
                ].join(' ')}
                onClick={onRename ? startOrSelect : undefined}
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
              className={[
                'border border-edge px-2 py-1.5 text-xs font-semibold text-ink-2',
                onRename ? 'hover:ring-1 hover:ring-inset hover:ring-status-info cursor-text' : '',
                isNameCellSelected ? 'ring-2 ring-inset ring-status-info' : '',
              ].join(' ')}
              onClick={onRename ? startOrSelect : undefined}
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
  foldersHidden = false,
  sectionNumbers,
  linkTypes = [],
  linksByObjectId,
  coverageByReqId,
  testsById,
  repoPath,
  candidateObjects = [],
  onLinkChange,
  onInlineEdit,
  onRenameNode,
  onEditOpen,
  onRootChange,
  onColumnsReorder,
  filter,
  filterOptions,
  selectedIds,
  onSelect,
  generateId,
  stepsByObjectId,
  onStepsChange,
  onNavigateToObject,
  onItemNodeAdded,
  gotoNodeId,
  gotoSeq,
  rowMaxLines = 1,
}: Props) {
  const { t } = useTranslation()
  // T126 sprint 2 — catalogue de rôles du repo courant, pour le champ multi_enum nommé `roles`.
  // useProjectSchema (staleTime: Infinity) plutôt qu'une useQuery locale — même clé de cache que
  // SystemViewContext, aucune requête réseau dupliquée.
  const { data: currentSchema } = useProjectSchema(repoPath ?? '')
  const interfaceRoles = currentSchema?.roles?.map(r => r.name)
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
  // Cellule "sélectionnée" (contour bleu persistant) — un premier clic sélectionne la
  // cellule (et fait remonter la sélection de ligne par bubbling, y compris ctrl/shift),
  // un second clic sur cette même cellule déjà sélectionnée ouvre son éditeur. Évite
  // qu'un simple clic destiné à sélectionner des lignes ne bascule la cellule en édition.
  const [selectedCell, setSelectedCell] = useState<{ nodeId: string; col: string } | null>(null)
  const isCellSelected = useCallback(
    (nodeId: string, col: string) => selectedCell?.nodeId === nodeId && selectedCell?.col === col,
    [selectedCell]
  )
  const selectCell = useCallback((nodeId: string, col: string) => setSelectedCell({ nodeId, col }), [])
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; hasContent: boolean } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  // Figer les volets (T151) — nombre de colonnes, depuis la gauche, épinglées hors du
  // scroll latéral. Index dans `columns`, pas persisté (comportement UI éphémère comme
  // colWidths/columnFilters).
  const [freezeColCount, setFreezeColCount] = useState(0)
  const [columnFreezeMenu, setColumnFreezeMenu] = useState<{ colIdx: number; x: number; y: number } | null>(null)
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

  // T169 — cellule richtext en cours d'édition en place (une seule à la fois). Identifiée par
  // nœud (c'est la ligne qui s'agrandit) + champ ; objectId porte la donnée éditée.
  const [activeRichtextEdit, setActiveRichtextEdit] = useState<{
    nodeId: string
    objectId: string
    field: string
  } | null>(null)
  // T149 — une entrée par objectId affecté par l'édition courante (l'objet édité + ses
  // pairs de sélection multiple), pour restaurer la valeur propre de CHACUN à l'annulation
  // (Escape) plutôt que d'écraser tout le monde avec la valeur d'origine du seul objet édité.
  const richtextOriginalValuesRef = useRef<Map<string, string>>(new Map())
  // Posé par le onMouseDown React de la cellule en édition — qui reçoit aussi les évènements
  // des menus de l'éditeur rendus par portail (menu de tableau, page draw.io), hors du <td>
  // dans le DOM. React écoute sur sa racine, avant ce listener `document` : le drapeau est
  // donc déjà posé quand le handler ci-dessous traite le même mousedown.
  const richtextEditorMouseDownRef = useRef(false)
  useEffect(() => {
    if (!activeRichtextEdit) return
    const handler = (e: MouseEvent) => {
      const inside = richtextEditorMouseDownRef.current
      richtextEditorMouseDownRef.current = false
      if (inside) return
      if ((e.target as HTMLElement).closest('[data-richtext-toolbar]')) return
      // Clic extérieur = validation (la valeur est déjà persistée à chaque frappe).
      setActiveRichtextEdit(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [activeRichtextEdit])

  const [activeMultiEnumPopover, setActiveMultiEnumPopover] = useState<{
    objectId: string
    field: string
    top: number
    left: number
    width: number
  } | null>(null)
  useEffect(() => {
    if (!activeMultiEnumPopover) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-multi-enum-popover]')) setActiveMultiEnumPopover(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [activeMultiEnumPopover])

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

  // T164 — "goto" : défiler jusqu'à la ligne / ligne de groupe portant data-node-id
  // (les lignes portent `scroll-mt-8` pour ne pas finir sous le <thead> sticky).
  useScrollToNode(containerRef, gotoNodeId, gotoSeq)

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
    // Idem pour la cellule sélectionnée si sa colonne disparaît.
    setSelectedCell(prev => (prev && !columns.includes(prev.col) ? null : prev))
    // Le nombre de colonnes figées ne doit jamais dépasser le nombre de colonnes affichées.
    setFreezeColCount(prev => Math.min(prev, columns.length))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns.join(',')])

  // T51 — changer de composant/type réinitialise entièrement les filtres de colonnes,
  // même si le nouveau type partage un nom de colonne avec le précédent (ex. "status")
  useEffect(() => {
    setColumnFilters({})
    setActiveColumnFilterPopover(null)
    setSelectedCell(null)
    setFreezeColCount(0)
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
      // T162 — titres masqués : aucune ligne de dossier, et le collapse est ignoré (tous
      // les éléments sont listés à plat).
      if (!(foldersHidden && n.kind === 'folder')) {
        rows.push({ kind: n.kind, node: n, depth })
      }
      if (n.kind === 'folder') {
        flatten(n.children, depth + 1, foldersHidden ? false : collapsedFolders.has(n.id))
      }
    }
  }
  flatten(root, 0, false)

  // T149 — nodeId <-> objectId, pour propager une édition inline à toute la sélection
  // multiple (les IDs de sélection sont des nodeId d'arbre, pas des objectId de fond).
  const nodeIdToObjectId = new Map<string, string>()
  const objectIdToNodeId = new Map<string, string>()
  for (const { node } of rows) {
    if (node.objectId) {
      nodeIdToObjectId.set(node.id, node.objectId)
      objectIdToNodeId.set(node.objectId, node.id)
    }
  }

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

  // Figer les volets (T151) — offset gauche cumulé de chaque colonne, pour `position: sticky`.
  // La colonne d'action (icône crayon), si présente, est toujours la plus à gauche.
  const editIconColWidth = onEditOpen ? 32 : 0
  const colLeftOffsets: number[] = []
  {
    let acc = editIconColWidth
    for (const col of columns) {
      colLeftOffsets.push(acc)
      acc += effectiveColWidths[col] ?? 120
    }
  }
  /** Style `position: sticky` pour la colonne d'index `colIdx`, si elle fait partie des
   * colonnes figées ; sinon `undefined`. `bg` est la classe Tailwind de fond opaque à
   * appliquer par-dessus (le `<td>` est transparent par défaut, laissant apparaître les
   * colonnes défilées derrière lui sans ce fond). */
  function getFreezeStyle(colIdx: number): React.CSSProperties | undefined {
    if (colIdx >= freezeColCount) return undefined
    return { position: 'sticky', left: colLeftOffsets[colIdx], zIndex: 2 }
  }

  // Last column expands to fill the container when the table is narrower than the viewport
  const lastCol = columns[columns.length - 1]
  const lastColNaturalWidth = effectiveColWidths[lastCol] ?? 120
  const othersTotalWidth = totalTableWidth - lastColNaturalWidth
  const lastColWidth = containerWidth > totalTableWidth
    ? containerWidth - othersTotalWidth
    : lastColNaturalWidth
  const effectiveTableWidth = Math.max(totalTableWidth, containerWidth)

  // Apply filter if active
  // T166 — honore le mode du filtre global (casse / mot entier / regex), comme l'arbre latéral
  // et le filtre par colonne T51. buildFilterRegex renvoie null si le filtre est vide OU si
  // l'expression regex est invalide → dans les deux cas on n'exclut aucune ligne.
  const filterRe = buildFilterRegex(filter ?? '', filterOptions ?? NO_FILTER_OPTIONS)

  // T51 — filtres par colonne actifs (texte non vide, colonne toujours visible)
  const activeColumnFilters = Object.entries(columnFilters)
    .filter(([col, f]) => columns.includes(col) && f.text.trim())
    .map(([col, f]) => ({ col, re: buildFilterRegex(f.text, f.options) }))
    .filter((f): f is { col: string; re: RegExp } => f.re !== null)

  // ── Row Drag & Drop ──────────────────────────────────────────────────────────

  const dndEnabled = !!onRootChange && !filterRe && activeColumnFilters.length === 0

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

    // T162 — titres masqués : pas de dossier visible comme cible, donc réordonnancement
    // uniquement entre éléments de MÊME parent (pas de déplacement inter-dossiers à l'aveugle).
    if (foldersHidden && draggingNodeId && treeFindParentId(root, draggingNodeId) !== parentId) {
      setRowDropIndicator(null)
      return
    }

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
    // T162 — garde défensive : titres masqués ⇒ pas de déplacement inter-dossiers.
    if (foldersHidden && treeFindParentId(root, draggedId) !== rowDropIndicator.parentId) {
      setDraggingNodeId(null); setRowDropIndicator(null); return
    }

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

  // ── Bulk inline edit (T149) — propage une édition à toute la sélection multiple ──
  // Un objet n'est "en sélection multiple" que si son nodeId figure dans la sélection
  // actuelle ET que celle-ci compte au moins 2 lignes ; sinon l'édition reste solo comme
  // avant. Les colonnes `link::` ne passent pas par ce chemin (LinkCombobox dédiée).

  /** ObjectIds des lignes sélectionnées (hors dossiers, qui n'ont pas de objectId). */
  function selectedObjectIds(): string[] {
    return effectiveSelectedIds
      .map(id => nodeIdToObjectId.get(id))
      .filter((oid): oid is string => !!oid)
  }

  /** true si `objectId` fait partie d'une sélection d'au moins 2 lignes. */
  function isInMultiSelection(objectId: string): boolean {
    const nodeId = objectIdToNodeId.get(objectId)
    return !!nodeId && effectiveSelectedIds.length > 1 && effectiveSelectedIds.includes(nodeId)
  }

  /** Édition simple (status/enum/texte/richtext) : même valeur écrasée sur toute la sélection. */
  function applyInlineEditToSelection(objectId: string, field: string, value: string) {
    if (!onInlineEdit) return
    if (!isInMultiSelection(objectId)) {
      onInlineEdit(objectId, field, value)
      return
    }
    for (const oid of selectedObjectIds()) onInlineEdit(oid, field, value)
  }

  /** Case à cocher multi_enum : bascule la même valeur indépendamment sur chaque ligne
   * sélectionnée (préserve les autres valeurs déjà cochées de chaque ligne), plutôt que
   * d'écraser tout le tableau sérialisé avec celui de la ligne éditée. */
  function applyMultiEnumToggleToSelection(objectId: string, field: string, value: string, adding: boolean) {
    if (!onInlineEdit) return
    const targets = isInMultiSelection(objectId) ? selectedObjectIds() : [objectId]
    for (const oid of targets) {
      const obj = objectMap.get(oid)
      const current = parseMultiEnumValue(obj ? getFieldValue(obj, field) : '')
      const next = adding
        ? (current.includes(value) ? current : [...current, value])
        : current.filter(v => v !== value)
      onInlineEdit(oid, field, serializeMultiEnumValue(next))
    }
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
      else if (selectedCell) setSelectedCell(null)
      else if (effectiveSelectedIds.length > 0) effectiveOnSelect([])
    } else if (e.key === 'Enter' && deleteConfirm) {
      e.preventDefault()
      confirmDelete()
    }
  }

  const hasActiveFilter = !!filterRe || activeColumnFilters.length > 0

  function itemMatchesFilters(node: TypeTreeNode, obj: AnyObject | null | undefined): boolean {
    if (filterRe) {
      // Le filtre texte global (barre de recherche du panneau latéral) cherche dans le nom
      // de l'élément, son ID et TOUTES les valeurs de champs — pas seulement les colonnes
      // visibles. Aligné sur WordView.itemMatchesFilter et le filtre de l'arbre latéral
      // (treeVisibleNodes) : sans ça, un filtre qui matche par nom/ID ou par un champ masqué
      // de la vue Excel vide entièrement le tableau alors que le panneau et la vue Word montrent
      // bien le résultat. Le filtrage par colonne (T51) reste, lui, restreint à sa colonne.
      // T166 — valeurs testées une par une (pas de haystack joint) pour qu'une regex ne
      // matche pas à cheval sur deux champs.
      const values = [
        node.name,
        node.objectId ?? '',
        ...(obj ? Object.values(obj as Record<string, unknown>).map(v => String(v ?? '')) : []),
      ]
      if (!values.some(v => filterRe.test(v))) return false
    }
    return activeColumnFilters.every(({ col, re }) => re.test(getCellText(node, obj, col)))
  }

  // Un dossier/section ne doit s'afficher, quand un filtre est actif, que s'il contient au
  // moins un élément descendant qui matche — sinon on se retrouve avec des dossiers vides
  // affichés parmi des résultats filtrés, ce qui est trompeur (le dossier n'a rien à montrer).
  function folderHasMatchingDescendant(node: TypeTreeNode): boolean {
    return node.children.some(child => {
      if (child.kind === 'folder') return folderHasMatchingDescendant(child)
      const obj = child.objectId ? objectMap.get(child.objectId) : null
      return itemMatchesFilters(child, obj)
    })
  }

  const filteredRows = rows.filter(r => {
    // T169 — la ligne en cours d'édition richtext reste affichée même si la frappe la fait
    // sortir d'un filtre (colonne ou global, qui lisent les valeurs live) : sinon l'éditeur
    // se démonterait en pleine saisie. Le filtre s'applique de nouveau en sortie d'édition.
    if (activeRichtextEdit?.nodeId === r.node.id) return true
    if (r.kind === 'folder') {
      return hasActiveFilter ? folderHasMatchingDescendant(r.node) : true
    }
    const obj = r.node.objectId ? objectMap.get(r.node.objectId) : null
    return itemMatchesFilters(r.node, obj)
  })

  const visibleRowIds = filteredRows.map(r => r.node.id)

  // T169 — ligne éditée disparue (collapse, suppression, changement de type — pas les filtres,
  // cf. filteredRows) : fin de l'édition. La valeur est déjà persistée à chaque frappe.
  const richtextEditRowVisible = !activeRichtextEdit || rows.some(r => r.node.id === activeRichtextEdit.nodeId)
  useEffect(() => {
    if (!richtextEditRowVisible) setActiveRichtextEdit(null)
  }, [richtextEditRowVisible])

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
    // T149 — un clic simple (sans modificateur) sur une ligne déjà membre d'une sélection
    // multiple NE la réduit PAS à elle seule : le clic sur une cellule pour l'éditer (ex.
    // Statut) bulle jusqu'ici sans stopPropagation, donc sans ce garde-fou la sélection
    // multiple s'effondrerait avant même que l'édition ne commence, rendant la propagation
    // en masse inatteignable à la souris. Cliquer sur une ligne hors sélection reste solo.
    if (effectiveSelectedIds.length > 1 && effectiveSelectedIds.includes(nodeId)) return
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
      onClick={() => { effectiveOnSelect([]); setSelectedCell(null) }}
      onKeyDown={handleKeyDown}
    >
      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-ink mb-2">{t('system.shared.deleteTitle')}</h2>
            <p className="text-xs text-ink-2 mb-5">
              {deleteConfirm.hasContent
                ? t('system.shared.deleteFolderWithContent')
                : t('system.shared.deleteCount', { count: deleteConfirm.ids.length })}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteConfirm(null)}
                className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button type="button" onClick={confirmDelete} autoFocus
                className="btn-danger">
                {t('common.delete')}
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

      {/* Column header context menu — figer/libérer les volets (T151) */}
      {columnFreezeMenu && (
        <ColumnFreezeMenu
          x={columnFreezeMenu.x} y={columnFreezeMenu.y}
          colIdx={columnFreezeMenu.colIdx}
          freezeColCount={freezeColCount}
          onFreeze={setFreezeColCount}
          onUnfreeze={() => setFreezeColCount(0)}
          onClose={() => setColumnFreezeMenu(null)}
        />
      )}

      {/* border-separate (pas collapse) : avec des cellules `position: sticky` figées (T151),
          border-collapse fusionne les bordures adjacentes en une entité peinte séparément
          des cellules elle-même, qui ne suit pas le décalage sticky — ce qui laisse un
          interstice au scroll par lequel les colonnes défilées redeviennent visibles. En
          border-separate, chaque cellule peint sa propre bordure dans sa propre boîte. */}
      <RowMaxLinesContext.Provider value={rowMaxLines}>
      <RenderGateProvider rootRef={containerRef}>
      <table className="text-xs border-separate" style={{ width: effectiveTableWidth, tableLayout: 'fixed', borderSpacing: 0 }}>
        <thead className="sticky top-0 z-10">
          <tr>
            {onEditOpen && (
              <th
                className="border border-edge w-8 bg-hover"
                style={freezeColCount > 0 ? { position: 'sticky', left: 0, zIndex: 3 } : undefined}
              />
            )}
            {columns.map((col, colIdx) => {
              const frozen = colIdx < freezeColCount
              const colStyle: React.CSSProperties = {
                width: colIdx === columns.length - 1 ? lastColWidth : effectiveColWidths[col],
                position: frozen ? 'sticky' : 'relative',
                left: frozen ? colLeftOffsets[colIdx] : undefined,
                zIndex: frozen ? 3 : undefined,
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
                  onContextMenu={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    setColumnFreezeMenu({ colIdx, x: e.clientX, y: e.clientY })
                  }}
                >
                  {getColumnLabel(col)}
                  {isSystemField(col) && <span className="ml-1 text-ink-3 font-normal">(sys)</span>}
                  {isFilterableColumn(col) && (
                    <button
                      type="button"
                      draggable={false}
                      data-column-filter-icon
                      title={t('system.excelView.filterColumn')}
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
                        activeColumnFilters.some(f => f.col === col) ? 'text-status-info' : 'text-ink-3 hover:text-ink-2',
                      ].join(' ')}
                    >
                      <FilterIcon size={10} />
                    </button>
                  )}
                  <div
                    style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize' }}
                    className="hover:bg-status-info-solid"
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
                {t('common.noElements')}
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
                  isNameCellSelected={isCellSelected(node.id, 'name')}
                  onSelectNameCell={() => selectCell(node.id, 'name')}
                  freezeColCount={freezeColCount}
                  getFreezeStyle={getFreezeStyle}
                  isGotoTarget={gotoNodeId === node.id}
                />
              )
            }

            const obj = node.objectId ? objectMap.get(node.objectId) : null
            const isSelected = effectiveSelectedIds.includes(node.id)
            const isCutRow = clipboard?.cut && clipboard.nodes.some(n => n.id === node.id)
            const nodeSteps = node.objectId ? (stepsByObjectId?.get(node.objectId) ?? []) : []
            const stepsExpanded = expandedStepIds.has(node.id)
            // Fond opaque appliqué aux cellules figées (position: sticky) de cette ligne —
            // sinon, transparentes par défaut, elles laisseraient apparaître les colonnes
            // défilées derrière elles au scroll latéral. `group-hover` reflète le survol du
            // <tr> (classe `group`), pour rester visuellement cohérent avec les lignes non figées.
            const rowStickyBg = isSelected ? 'bg-status-info-bg' : 'bg-surface group-hover:bg-row-hover'
            const actionFrozenStyle: React.CSSProperties | undefined = freezeColCount > 0 ? { position: 'sticky', left: 0, zIndex: 2 } : undefined
            // T169 — ligne dont une cellule richtext est en édition en place : ni drag de ligne
            // ni `select-none`, sinon sélectionner du texte à la souris démarrerait un drag.
            const rowRichtextEditing = activeRichtextEdit?.nodeId === node.id
            const rowDnd = dndEnabled && !rowRichtextEditing
            return (
              <React.Fragment key={node.id}>
              <tr
                data-node-id={node.id}
                className={[
                  'group cursor-pointer scroll-mt-8',
                  rowRichtextEditing ? '' : 'select-none',
                  rowMaxLines > 1 ? 'align-top' : '',
                  isSelected ? 'bg-status-info-bg' : 'hover:bg-row-hover',
                  isDraggingRow || isCutRow ? 'opacity-50' : '',
                  dropInside ? 'outline outline-1 outline-status-info' : '',
                  gotoNodeId === node.id ? GOTO_OUTLINE_CLASS : '',
                ].filter(Boolean).join(' ')}
                style={dropStyle}
                onClick={e => { e.stopPropagation(); handleRowSelect(node.id, e) }}
                onContextMenu={e => handleContextMenu(e, node.id)}
                draggable={rowDnd}
                onDragStart={rowDnd ? (e) => handleRowDragStart(e, node.id) : undefined}
                onDragOver={dndEnabled ? (e) => handleRowDragOver(e, node.id) : undefined}
                onDrop={dndEnabled ? handleRowDrop : undefined}
                onDragEnd={dndEnabled ? handleRowDragEnd : undefined}
              >
                {onEditOpen && (
                  <td
                    style={actionFrozenStyle}
                    className={['border border-edge px-1 text-center', freezeColCount > 0 ? rowStickyBg : ''].join(' ')}
                  >
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onEditOpen(node.id) }}
                      className="text-ink-3 hover:text-ink p-1"
                      title={t('system.shared.editItem')}
                    >
                      <Pencil size={12} />
                    </button>
                  </td>
                )}
                {columns.map((col, colIdx) => {
                  const freezeStyle = getFreezeStyle(colIdx)
                  const stickyBg = freezeStyle ? rowStickyBg : undefined
                  if (col === 'steps') {
                    const stepsCount = nodeSteps.length
                    const stepsCellSelected = isCellSelected(node.id, col)
                    return (
                      <td
                        key={col}
                        style={freezeStyle}
                        className={[
                          'border border-edge px-2 py-1 text-xs cursor-pointer hover:ring-1 hover:ring-inset hover:ring-status-info',
                          stickyBg ?? '',
                          stepsCellSelected ? 'ring-2 ring-inset ring-status-info' : '',
                        ].join(' ')}
                        onClick={e => {
                          e.stopPropagation()
                          if (!stepsCellSelected) { selectCell(node.id, col); return }
                          toggleStepExpand(node.id)
                        }}
                        title={stepsExpanded ? t('system.excelView.hideSteps') : stepsCount > 0 ? t('system.excelView.stepsCount', { count: stepsCount }) : t('system.excelView.noSteps')}
                      >
                        <span className="flex items-center gap-1 text-ink-2">
                          {stepsExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          {stepsCount > 0 ? stepsCount : <span className="text-ink-3 italic">—</span>}
                        </span>
                      </td>
                    )
                  }
                  if (col === 'coverageStatus') {
                    return (
                      <td key={col} style={freezeStyle} className={['border border-edge px-2 py-1', stickyBg ?? ''].join(' ')}>
                        {typeDef?.category === 'requirement' && node.objectId && (
                          <CoverageBadge
                            coverage={coverageByReqId?.get(node.objectId)}
                            testsById={testsById ?? new Map()}
                          />
                        )}
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
                        isSelected={isCellSelected(node.id, col)}
                        onSelectCell={() => selectCell(node.id, col)}
                        freezeStyle={freezeStyle}
                        stickyBg={stickyBg}
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
                    const linkCellSelected = isCellSelected(node.id, col)
                    return (
                      <td
                        key={col}
                        data-link-popover
                        style={freezeStyle}
                        className={[
                          'border border-edge px-2 py-1 text-xs text-ink-2 max-w-xs cursor-pointer hover:ring-1 hover:ring-inset hover:ring-status-info',
                          rowMaxLines > 1 ? '' : 'truncate',
                          stickyBg ?? '',
                          linkCellSelected ? 'ring-2 ring-inset ring-status-info' : '',
                        ].join(' ')}
                        title={value || undefined}
                        onClick={e => {
                          if (!linkCellSelected) { selectCell(node.id, col); return }
                          if (isOpen) { setActiveLinkPopover(null); return }
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          setActiveLinkPopover({ nodeId: node.id, typeName, top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 320) })
                        }}
                      >
                        <ClampedContent>{value || <span className="text-ink-3 italic">—</span>}</ClampedContent>
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
                      isSelected={isCellSelected(node.id, col)}
                      onSelectCell={() => selectCell(node.id, col)}
                      freezeStyle={freezeStyle}
                      stickyBg={stickyBg}
                      onEdit={onInlineEdit ? applyInlineEditToSelection : undefined}
                      richtext={fieldDef?.type === 'richtext' ? {
                        repoPath,
                        onStartEdit: onInlineEdit && node.objectId ? () => {
                          const objId = node.objectId!
                          const originals = new Map<string, string>()
                          const targets = isInMultiSelection(objId) ? selectedObjectIds() : [objId]
                          for (const oid of targets) {
                            const o = objectMap.get(oid)
                            originals.set(oid, o ? getFieldValue(o, col) : '')
                          }
                          richtextOriginalValuesRef.current = originals
                          // Une édition déjà ouverte ailleurs est simplement remplacée : sa valeur
                          // est déjà persistée, ce qui vaut validation.
                          setActiveRichtextEdit({ nodeId: node.id, objectId: objId, field: col })
                        } : undefined,
                        isEditing: activeRichtextEdit?.nodeId === node.id && activeRichtextEdit.field === col,
                        editValue: value,
                        onEditChange: v => applyInlineEditToSelection(node.objectId ?? '', col, v),
                        onEditCommit: () => setActiveRichtextEdit(null),
                        onEditCancel: () => {
                          for (const [oid, original] of richtextOriginalValuesRef.current) {
                            onInlineEdit?.(oid, col, original)
                          }
                          setActiveRichtextEdit(null)
                        },
                        onEditorMouseDown: () => { richtextEditorMouseDownRef.current = true },
                      } : undefined}
                      onMultiEnumEdit={onInlineEdit ? (objId, f, rect) => {
                        const isOpen = activeMultiEnumPopover?.objectId === objId && activeMultiEnumPopover.field === f
                        if (isOpen) { setActiveMultiEnumPopover(null); return }
                        setActiveMultiEnumPopover({ objectId: objId, field: f, top: rect.bottom + 2, left: rect.left, width: rect.width })
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
      </RenderGateProvider>
      </RowMaxLinesContext.Provider>

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
                placeholder={t('common.filterPlaceholder')}
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

      {/* Multi-enum popover — fixed position to escape overflow-auto clipping */}
      {activeMultiEnumPopover && (() => {
        const popoverObj = objectMap.get(activeMultiEnumPopover.objectId)
        const popoverValue = popoverObj ? getFieldValue(popoverObj, activeMultiEnumPopover.field) : ''
        const fieldDef = typeDef?.fields.find(f => f.name === activeMultiEnumPopover.field)
        const options = fieldDef ? resolveMultiEnumOptions(fieldDef, interfaceRoles) : []
        const selected = parseMultiEnumValue(popoverValue)
        return (
          <MultiEnumPopover
            options={options}
            selected={selected}
            onToggle={v => {
              applyMultiEnumToggleToSelection(activeMultiEnumPopover.objectId, activeMultiEnumPopover.field, v, !selected.includes(v))
            }}
            onClose={() => setActiveMultiEnumPopover(null)}
            style={{ top: activeMultiEnumPopover.top, left: activeMultiEnumPopover.left, minWidth: activeMultiEnumPopover.width }}
          />
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
        const outgoingLinks = cellLinks.filter(l => l.sourceId === objectId)
        const incomingLinks = cellLinks.filter(l => l.targetId === objectId)
        // Toujours afficher les liens existants, même dans le sens non canonique pour le
        // schéma actuel — sinon un lien créé avant un changement de sourceRefs/targetRefs
        // devient invisible et impossible à délier. La création reste limitée au sens déclaré.
        const showOutgoing = canBeSource || outgoingLinks.length > 0
        const showIncoming = canBeTarget || incomingLinks.length > 0
        return (
          <div
            data-link-popover
            className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl p-3 space-y-3"
            style={{ top: activeLinkPopover.top, left: activeLinkPopover.left, width: activeLinkPopover.width }}
            onClick={e => e.stopPropagation()}
          >
            {showOutgoing && (
              <LinkCombobox
                label={lt.labelSourceToTarget}
                existingLinks={outgoingLinks.map(l => ({ linkId: l.id, peerId: getPeerId(l, objectId) }))}
                candidates={canBeSource ? filterCandidatesByRefs(candidateObjects, lt.targetRefs) : []}
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
                onNavigateToObject={onNavigateToObject ? (peerId, opts) => { setActiveLinkPopover(null); onNavigateToObject(peerId, opts) } : undefined}
              />
            )}
            {showIncoming && (
              <LinkCombobox
                label={lt.labelTargetToSource}
                existingLinks={incomingLinks.map(l => ({ linkId: l.id, peerId: getPeerId(l, objectId) }))}
                candidates={canBeTarget ? filterCandidatesByRefs(candidateObjects, lt.sourceRefs) : []}
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
                onNavigateToObject={onNavigateToObject ? (peerId, opts) => { setActiveLinkPopover(null); onNavigateToObject(peerId, opts) } : undefined}
              />
            )}
          </div>
        )
      })()}
    </div>
  )
}
