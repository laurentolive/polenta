import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FileText, Folder, FolderGit2, GitFork, AlertTriangle, RefreshCw, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { useWorkspaceStructure } from '../../hooks/useWorkspaceStructure'
import {
  addDependency, addInterfaceImplementation, ensureWorkspaceInitialized, MountNameConflictError,
  updateInterfaceRoles, removeDependency, renameDependency, reorderDependencies, moveDependencyToParent,
} from '../../lib/workspaceActions'
import { CATEGORY_CHART_TEXT } from '../../lib/objectCategoryColors'
import { DiamondConflictModal } from '../DiamondConflictModal'
import { ElementConfigModal } from './ElementConfigModal'
import { AddDependencyModal, type AddDependencyValues } from './AddDependencyModal'
import { RemoveDependencyModal } from './RemoveDependencyModal'
import { RepoBranchSelector } from './RepoBranchSelector'
import { objTypeToEditable, editableToObjType, emptyObjType, CATEGORY_LABEL_KEY, ConfirmDelete, type EditableObjectType } from './objectTypeEditor'
import { RolesExposedFields, ImplementedInterfacesFields } from './RolesImplementsFields'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import type {
  ProjectSchema, WorkspaceTreeNode, MountOverride, ObjectTypeDefinition, ObjectCategory,
  DiamondConflict, PolentaRepoDependency, ImplementsDeclaration, SystemNode, RoleDefinition,
} from '@polenta/types'
import {
  findSystemNode, flattenSystemNodes, mapSystemNode, removeSystemNode, countSubComponents,
  reorderByKey, reorderSystemNodes, isDescendant, moveSystemNode,
} from '@polenta/types'

interface Props {
  workspaceDir: string
  repoPath: string
  projectId: string
}

/** Identifies exactly which (repo, local node, object type) slot a leaf refers to, so saving
 *  writes back to the right place. Keyed by node NAME (T123), not array position — a component
 *  local peut être imbriqué à n'importe quelle profondeur (SystemNode.children), une position de
 *  tableau de premier niveau ne désigne plus un nœud de façon unique. */
interface Selection {
  repoPath: string
  repoLabel: string
  nodeName: string
  typeIndex: number
  /** True for a just-created (not yet configured) element — its scaffold is deleted if the modal is closed untouched. */
  isNew: boolean
}

/** Identifies any SystemNode (root or a local component, imbriqué ou non, T123) for editing its
 *  label/description ET ses interfaces (roles/implements, T123 — un composant a les mêmes
 *  capacités d'interface qu'un composant en repo séparé, cf. specs/T123.md). */
interface NodeEditTarget {
  repoPath: string
  repoLabel: string
  nodeName: string
  label: string
  description: string
  roles: RoleDefinition[]
  implementsList: ImplementsDeclaration[]
}

interface PendingDependency {
  repoPath: string
  repoLabel: string
  kind: 'component' | 'interface'
  /** T123 (follow-up) — présent quand l'action est déclenchée depuis la ligne d'un composant
   *  local existant plutôt que depuis une ligne de repo : nom du composant local sous lequel
   *  imbriquer le résultat. La modale (même checkbox "Composant local" que depuis une ligne de
   *  repo, cf. AddDependencyModal) décide ensuite où : `values.isLocal` route vers
   *  `handleAddLocalComponent` (imbriqué dans `children[]` de ce nœud) sinon vers `localParent`
   *  dans polenta-repo.yaml (imbriqué comme dépendance repo-séparée, cf. specs/T123.md §3). */
  parentName?: string
}

/**
 * An existing dependency being edited (branch/pin, roles for an interface — T74 sprint 1).
 * Also carries the child's own root node location so its label/description can be edited in
 * the same modal (T74 sprint 3 — merges the separate "renommer ce repo" pencil into this one).
 */
interface EditingDependency {
  parentRepoPath: string
  parentLabel: string
  kind: 'component' | 'interface'
  childRepoPath: string
  /** Index of the child's own 'root' SystemNode in its schema, or null if it has none (yet). */
  childNodeIndex: number | null
  initialValues: AddDependencyValues
}

/** An existing dependency pending removal confirmation (T74 sprint 1). */
interface RemovingDependency {
  parentRepoPath: string
  repoLabel: string
  dep: { name: string; url: string; repoPath: string }
}

/**
 * The row currently being dragged (T135 sprint 1 — drag & drop replaces the ↑/↓ reorder buttons
 * on `ElementLeaf`/`RepoRow`, and gives `LocalNodeRow` its first reorder capability). Each variant
 * carries exactly the fields needed to identify both the dragged row and the sibling group
 * ("container") it can be reordered within — sprint 1 only supports reordering among the row's
 * *current* siblings, never a change of parent (cf. specs/T135-design.md sprints 2-3).
 */
type DragItem =
  /** `typeName` is the type's own name, captured at drag-start alongside `typeIndex` — sprint 3's
   *  reparenting is a full IPC round trip (schema mutation + cascade), long enough that the
   *  node's `objectTypes[]` could in principle reindex mid-drag; `typeIndex` alone would then
   *  silently resolve to the wrong type by drop time. `resolveElementType` re-checks `typeName`
   *  against whatever sits at `typeIndex` right before acting, and refuses to proceed if they no
   *  longer match, rather than trusting a possibly-stale position. */
  | { kind: 'element'; repoPath: string; nodeName: string; typeIndex: number; typeName: string }
  | { kind: 'component'; parentRepoPath: string; localParent: string | undefined; name: string }
  /** `parentName: null` = this local component sits in the repo's own top-level merged list
   *  (`rootNode.children` + top-level `schema.nodes`, cf. RepoRow) rather than nested inside
   *  another local component's own `children[]`. */
  | { kind: 'local'; repoPath: string; parentName: string | null; name: string }

/**
 * A row's identity as a valid "drop here to become its new parent" target (T135 sprint 2).
 * `name: null` means the target is a `RepoRow` (including the workspace root) — a component
 * dropped here becomes a *flat* dependency of `repoPath` (`localParent: undefined`), a local
 * component dropped here is promoted to the top level of `repoPath`'s own schema (`moveSystemNode`
 * `toParentName: null`). A real `name` means the target is a `LocalNodeRow` — a component dropped
 * here is tagged `localParent: name`, a local component dropped here is nested under it
 * (`toParentName: name`). Same shape covers both dragged kinds; `handleDropRow` picks the write
 * operation from `dragging.kind`, not from anything on the target.
 */
interface ReparentTarget {
  repoPath: string
  name: string | null
}

function sameReparentTarget(a: ReparentTarget, b: ReparentTarget): boolean {
  return a.repoPath === b.repoPath && a.name === b.name
}

/** True when `candidateRepoPath` is anywhere in `ancestorName`'s own subtree of the *workspace*
 *  tree (mounted repos/interfaces, not local components) — the anti-cycle guard for reparenting a
 *  `RepoRow` dependency: dropping it onto one of its own (transitive) dependents would make that
 *  dependent depend on itself. */
function isWorkspaceDescendant(nodes: WorkspaceTreeNode[], ancestorName: string, candidateRepoPath: string): boolean {
  function containsRepoPath(list: WorkspaceTreeNode[]): boolean {
    return list.some(n => n.repoPath === candidateRepoPath || containsRepoPath(n.children))
  }
  function search(list: WorkspaceTreeNode[]): boolean {
    for (const n of list) {
      if (n.name === ancestorName) return containsRepoPath(n.children)
      if (search(n.children)) return true
    }
    return false
  }
  return search(nodes)
}

/** A drop position hovered over a row: either a before/after sibling reorder (T135 sprint 1,
 *  same identity as the dragged `DragItem`), or a "become new parent" reparent target (sprint 2,
 *  a `ReparentTarget` instead — the target row's own reorder identity doesn't matter here, only
 *  which repo/local-component it represents). */
type DropTarget =
  | (DragItem & { position: 'before' | 'after' })
  | (ReparentTarget & { position: 'into' })

/** True when `a` (the dragged item) and `b` (a hovered/dropped row) belong to the same sibling
 *  group — sprint 1 rejects any drop outside the dragged item's own current container. */
function sameDragContainer(a: DragItem, b: DragItem): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'element' && b.kind === 'element') return a.repoPath === b.repoPath && a.nodeName === b.nodeName
  if (a.kind === 'component' && b.kind === 'component') return a.parentRepoPath === b.parentRepoPath && a.localParent === b.localParent
  if (a.kind === 'local' && b.kind === 'local') return a.repoPath === b.repoPath && a.parentName === b.parentName
  return false
}

/** True when `a` and `b` identify the exact same row (same container, same item within it). */
function sameDragItem(a: DragItem, b: DragItem): boolean {
  if (!sameDragContainer(a, b)) return false
  if (a.kind === 'element' && b.kind === 'element') return a.typeIndex === b.typeIndex
  if (a.kind === 'component' && b.kind === 'component') return a.name === b.name
  if (a.kind === 'local' && b.kind === 'local') return a.name === b.name
  return false
}

/**
 * Wraps one row's existing content with native HTML5 drag & drop — same pattern already used by
 * `ReorderableSidebarSection.tsx` (T77): a before/after drop-position indicator line, the dragged
 * row dimmed while held, `dragImage` left to the browser default (no custom ghost needed for a
 * one-line/one-row drag, unlike that sidebar's card-shaped items). T135 sprint 2 adds a second
 * drop mode: a whole-row highlight when the row itself is a valid "become new parent" target for
 * the item currently being dragged.
 */
function DragRow({
  item, reparentTarget, canDropInto, dragging, dropTarget,
  onDragStartRow, onDragOverRow, onDropRow, onDragEndRow, onRowClick, className, style, children,
}: {
  /** This row's own reorder identity — `null` for a row that can never itself be picked up and
   *  dragged (only the workspace root today, which has no parent to reorder it within), but can
   *  still be a valid reparent target (`reparentTarget`). */
  item: DragItem | null
  /** This row's identity as a reparent target, or `null` if it can never be one (`ElementLeaf` —
   *  sprint 3 territory). */
  reparentTarget: ReparentTarget | null
  /** Eligibility rule for "is `dragging` valid to drop into a `ReparentTarget`" — the actual
   *  anti-cycle/same-repo-only checks live in `StructureTab` (need `schemasByRepoPath`/the
   *  workspace tree), `DragRow` just calls it with its own `reparentTarget` when relevant, instead
   *  of every caller (`RepoRow`/`LocalNodeRow`) precomputing and passing a boolean each render. */
  canDropInto: (dragging: DragItem, target: ReparentTarget) => boolean
  dragging: DragItem | null
  dropTarget: DropTarget | null
  onDragStartRow: (item: DragItem) => void
  onDragOverRow: (target: DropTarget) => void
  onDropRow: () => void
  onDragEndRow: () => void
  /** Optional click on the row itself (e.g. `RepoRow`/`LocalNodeRow`'s open/close toggle) —
   *  kept as a passthrough so the whole row stays clickable exactly as before this ticket,
   *  action buttons inside `children` still calling `stopPropagation()` to opt out. */
  onRowClick?: () => void
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const isDragging = item !== null && dragging !== null && sameDragItem(dragging, item)
  const isReorderTarget = item !== null && dropTarget !== null && dropTarget.position !== 'into' && sameDragItem(dropTarget, item)
  const isReparentTarget = reparentTarget !== null && dropTarget !== null && dropTarget.position === 'into'
    && sameReparentTarget(dropTarget, reparentTarget)

  return (
    <div className="relative">
      {isReorderTarget && dropTarget?.position === 'before' && (
        <div className="absolute left-0 right-0 top-0 h-0.5 bg-status-info-solid z-10 pointer-events-none" />
      )}
      <div
        draggable={item !== null}
        onDragStart={item === null ? undefined : e => { e.dataTransfer.effectAllowed = 'move'; onDragStartRow(item) }}
        onDragOver={e => {
          if (!dragging) return
          const isSibling = item !== null && !sameDragItem(dragging, item) && sameDragContainer(dragging, item)
          const canNest = reparentTarget !== null && canDropInto(dragging, reparentTarget)
          if (!isSibling && !canNest) return
          e.preventDefault()
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const fraction = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5

          if (isSibling && canNest) {
            // This row is both a valid sibling (reorder) and a valid new parent (nest) for the
            // dragged item — split the row in thirds so both stay reachable by hovering (top/
            // bottom edges reorder, middle nests), instead of one silently shadowing the other.
            if (fraction < 1 / 3) onDragOverRow({ ...(item as DragItem), position: 'before' })
            else if (fraction > 2 / 3) onDragOverRow({ ...(item as DragItem), position: 'after' })
            else onDragOverRow({ ...(reparentTarget as ReparentTarget), position: 'into' })
          } else if (isSibling) {
            onDragOverRow({ ...(item as DragItem), position: fraction < 0.5 ? 'before' : 'after' })
          } else {
            onDragOverRow({ ...(reparentTarget as ReparentTarget), position: 'into' })
          }
        }}
        onDrop={e => { e.preventDefault(); onDropRow() }}
        onDragEnd={onDragEndRow}
        onClick={onRowClick}
        className={`${className ?? ''} ${isDragging ? 'opacity-40' : ''} ${isReparentTarget ? 'ring-2 ring-inset ring-status-info-solid bg-status-info-bg' : ''}`}
        style={style}
      >
        {children}
      </div>
      {isReorderTarget && dropTarget?.position === 'after' && (
        <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-status-info-solid z-10 pointer-events-none" />
      )}
    </div>
  )
}

const CATEGORY_DOT: Record<string, string> = CATEGORY_CHART_TEXT

function ElementLeaf({ objectType, item, dragging, dropTarget, onDragStartRow, onDragOverRow, onDropRow, onDragEndRow, onClick, onDelete }: {
  objectType: ObjectTypeDefinition
  item: DragItem
  dragging: DragItem | null
  dropTarget: DropTarget | null
  onDragStartRow: (item: DragItem) => void
  onDragOverRow: (target: DropTarget) => void
  onDropRow: () => void
  onDragEndRow: () => void
  onClick: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <DragRow
      item={item}
      reparentTarget={null}
      canDropInto={() => false}
      dragging={dragging}
      dropTarget={dropTarget}
      onDragStartRow={onDragStartRow}
      onDragOverRow={onDragOverRow}
      onDropRow={onDropRow}
      onDragEndRow={onDragEndRow}
      className="flex items-center gap-1 py-1 px-2 rounded hover:bg-hover transition-colors group cursor-grab active:cursor-grabbing"
    >
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-2 flex-1 min-w-0 text-left"
      >
        <FileText size={13} className={`${CATEGORY_DOT[objectType.category] ?? 'text-ink-3'} shrink-0`} />
        <span className="text-xs text-ink-2 truncate">
          {objectType.prefix && <code className="text-ink-3 font-mono mr-1">{objectType.prefix}</code>}
          {objectType.label || objectType.name || <span className="italic text-ink-3">{t('schema.structureTab.unnamed')}</span>}
        </span>
      </button>
      <span className="text-[11px] text-ink-3 shrink-0">{t(CATEGORY_LABEL_KEY[objectType.category])}</span>
      <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button type="button" onClick={e => { e.stopPropagation(); onClick() }}
          className="px-1 text-ink-3 hover:text-ink" title={t('schema.structureTab.edit')}><Pencil size={12} /></button>
        <ConfirmDelete
          onConfirm={onDelete}
          label={<Trash2 size={12} />}
          className="px-1 text-ink-3 hover:text-status-danger"
        />
      </div>
    </DragRow>
  )
}

const menuItemClass = 'w-full text-left px-3 py-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink transition-colors'

/** Shared "click outside to close" behavior for the small popup menus below (T113 — extracted
 *  out of AddMenu when AddElementMenu needed the identical open/outside-click boilerplate). */
function useDropdown() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return { open, setOpen, containerRef }
}

function AddMenu({ node, hasRoot, onAddComponent, onAddInterface, onAddElement }: {
  node: WorkspaceTreeNode
  hasRoot: boolean
  onAddComponent: () => void
  onAddInterface: () => void
  onAddElement: (category: ObjectCategory) => void
}) {
  const { t } = useTranslation()
  const { open, setOpen, containerRef } = useDropdown()

  return (
    <div
      ref={containerRef}
      className={`relative shrink-0 transition-opacity ${open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      onClick={e => e.stopPropagation()}
    >
      <button type="button" onClick={() => setOpen(v => !v)} className="text-ink-3 hover:text-ink" title={t('schema.structureTab.addTo', { name: node.label || node.name })}>
        <Plus size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-surface border border-edge rounded shadow-lg z-10 py-1 w-44">
          <button type="button" onClick={() => { onAddComponent(); setOpen(false) }} className={menuItemClass}>{t('schema.structureTab.addComponent')}</button>
          <button type="button" onClick={() => { onAddInterface(); setOpen(false) }} className={menuItemClass}>{t('schema.structureTab.addInterface')}</button>
          {hasRoot && (
            <>
              <div className="border-t border-edge my-1" />
              {(['requirement', 'test', 'campaign'] as ObjectCategory[]).map(cat => (
                <button key={cat} type="button" onClick={() => { onAddElement(cat); setOpen(false) }} className={menuItemClass}>
                  + {t(CATEGORY_LABEL_KEY[cat])}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Single "+" menu for a local component's own row (T123 + follow-up) — same shape and same
 *  items as `AddMenu` (repo rows) : "+ Composant" opens the same modal, with the same "Composant
 *  local" checkbox, as adding a component under a repo — a local component has exactly the same
 *  capabilities as one with its own repo (cf. specs/T123.md §3). Checking the box nests a plain
 *  SystemNode; leaving it unchecked creates a real polenta-repo.yaml dependency `localParent`-
 *  tagged to this node, rendered nested under it exactly as a repo's own dependencies nest under
 *  it. Un seul trigger "+" plutôt que plusieurs côte à côte (retour utilisateur post-merge — des
 *  icônes "+" adjacentes, quasi indiscernables, portaient chacune un menu/une action distincte). */
function AddElementMenu({ onAddElement, onAddComponent, onAddInterface }: {
  onAddElement: (category: ObjectCategory) => void
  onAddComponent: () => void
  onAddInterface: () => void
}) {
  const { t } = useTranslation()
  const { open, setOpen, containerRef } = useDropdown()

  return (
    <div ref={containerRef} className="relative shrink-0" onClick={e => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen(v => !v)} className="text-ink-3 hover:text-ink" title={t('schema.structureTab.addToComponent')}>
        <Plus size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-surface border border-edge rounded shadow-lg z-10 py-1 w-48">
          <button type="button" onClick={() => { onAddComponent(); setOpen(false) }} className={menuItemClass}>{t('schema.structureTab.addComponent')}</button>
          <button type="button" onClick={() => { onAddInterface(); setOpen(false) }} className={menuItemClass}>{t('schema.structureTab.addInterface')}</button>
          <div className="border-t border-edge my-1" />
          {(['requirement', 'test', 'campaign'] as ObjectCategory[]).map(cat => (
            <button key={cat} type="button" onClick={() => { onAddElement(cat); setOpen(false) }} className={menuItemClass}>
              + {t(CATEGORY_LABEL_KEY[cat])}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Bundle of handlers/context shared verbatim by `RepoRow` and `LocalNodeRow` at every depth
 *  (T123 follow-up) — a local component can now host its own nested repo-separate dependencies,
 *  rendered as `RepoRow`, so `LocalNodeRow` needs the same rendering context `RepoRow` does.
 *  Grouped into one object instead of ~15 individual props threaded through every recursive call. */
interface StructureTreeHandlers {
  workspaceDir: string
  flatNodes: WorkspaceTreeNode[]
  schemasByRepoPath: Map<string, ProjectSchema>
  isLoading: boolean
  schemasReady: boolean
  onSelectElement: (sel: Selection) => void
  onEditNode: (target: NodeEditTarget) => void
  onAddElement: (repoPath: string, repoLabel: string, nodeName: string, category: ObjectCategory) => void
  onDeleteLocalComponent: (repoPath: string, nodeName: string) => void
  onDeleteElement: (sel: Selection) => void
  /** "+ Composant" — depuis une ligne de repo (`parentName` absent) ou depuis une ligne de
   *  composant local (T123 follow-up, `parentName` = nom du composant local). Ouvre la même
   *  modale avec la même checkbox "Composant local" dans les deux cas (cf. AddDependencyModal) —
   *  cochée : imbrique un nouveau SystemNode dans `children[]` (`handleAddLocalComponent`) ;
   *  décochée : crée une dépendance repo-séparée, `localParent`-tagged sur `parentName` si présent
   *  (cf. handleSubmitDependency). */
  onAddComponent: (repoPath: string, parentLabel: string, parentName?: string) => void
  onAddInterface: (repoPath: string, parentLabel: string, parentName?: string) => void
  onEditDependency: (node: WorkspaceTreeNode, parentRepoPath: string) => void
  onRemoveDependency: (node: WorkspaceTreeNode, parentRepoPath: string) => void
  /** Drag & drop state + handlers (T135 sprint 1) — shared across the whole tree (not per-row
   *  local state, cf. `ReorderableSidebarSection`) since a drop can, from sprint 2 on, target a
   *  row in a different branch of the tree; sprint 1 itself only accepts drops within the dragged
   *  row's own current sibling group (`sameDragContainer`). */
  dragging: DragItem | null
  dropTarget: DropTarget | null
  onDragStartRow: (item: DragItem) => void
  onDragOverRow: (target: DropTarget) => void
  onDropRow: () => void
  onDragEndRow: () => void
  /** T135 sprint 2 — is `dragging` currently valid to drop into `target` (become its new parent)?
   *  Computed in `StructureTab` (needs `schemasByRepoPath`/the workspace tree for the anti-cycle
   *  checks), called by `RepoRow`/`LocalNodeRow` for their own `reparentTarget` before offering it
   *  to `DragRow`. */
  canDropInto: (dragging: DragItem, target: ReparentTarget) => boolean
}

/** Renders one local component's own row (icône, label, badge Interface, actions) plus its own
 *  éléments (ElementLeaf), récursivement ses composants locaux imbriqués, et ses propres
 *  dépendances repo-séparées (T123 + follow-up) — un composant local a exactement les mêmes
 *  capacités qu'un composant avec repo séparé, cf. specs/T123.md §3. */
function LocalNodeRow({
  node, repoPath, repoLabel, indent, parentName, repoDependencies, handlers,
}: {
  node: SystemNode
  repoPath: string
  repoLabel: string
  /** Absolute left padding in px for this row — the enclosing RepoRow's own indent (`32 +
   *  depth * 16`, matching root's own élément rows) plus 16px per level of local nesting. */
  indent: number
  /** This node's parent in the *local* SystemNode tree (T135) — `null` when it sits in the
   *  repo's own top-level merged list (`rootNode.children` + top-level `schema.nodes`, cf.
   *  RepoRow), the enclosing local component's own name otherwise. Identifies this row's drag &
   *  drop sibling group, distinct from `repoPath` (shared by every node of this repo). */
  parentName: string | null
  /** T123 (follow-up) — the enclosing repo's full, unfiltered `WorkspaceTreeNode.children` —
   *  threaded down unchanged through every level of local nesting (rather than pre-sliced per
   *  level by the caller) so any `LocalNodeRow`, at any depth, can find its own
   *  `localParent`-tagged dependencies via a simple filter by this node's own name. */
  repoDependencies: WorkspaceTreeNode[]
  handlers: StructureTreeHandlers
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const objectTypes = node.objectTypes ?? []
  const children = node.children ?? []
  const subCount = countSubComponents(node)
  // T123 (follow-up) — repo-séparé components/interfaces added from this row's own "+" menu nest
  // here, rendered exactly as a repo's own dependencies nest under it (cf. specs/T123.md §3).
  const ownDependencies = repoDependencies.filter(d => d.localParent === node.name)
  const dragItem: DragItem = { kind: 'local', repoPath, parentName, name: node.name }
  const reparentTarget: ReparentTarget = { repoPath, name: node.name }

  return (
    <div>
      <DragRow
        item={dragItem}
        reparentTarget={reparentTarget}
        canDropInto={handlers.canDropInto}
        dragging={handlers.dragging}
        dropTarget={handlers.dropTarget}
        onDragStartRow={handlers.onDragStartRow}
        onDragOverRow={handlers.onDragOverRow}
        onDropRow={handlers.onDropRow}
        onDragEndRow={handlers.onDragEndRow}
        onRowClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 py-1 group/local cursor-pointer select-none rounded hover:bg-hover transition-colors"
        style={{ paddingLeft: `${indent}px` }}
      >
        <span className="text-ink-3">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        {/* Même poids visuel qu'une ligne de repo (RepoRow) — un composant local est un composant
            à part entière, seule son absence de repo propre le distingue (T120/T123). */}
        <Folder size={14} className="text-ink-3 shrink-0" />
        <span className="text-sm font-medium text-ink truncate">
          {node.label || node.name}
        </span>
        {(node.roles?.length ?? 0) > 0 && (
          <span className="text-xs bg-chart-5/10 text-chart-5 px-1.5 py-0.5 rounded font-medium">
            {t('schema.structureTab.interfaceBadge')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover/local:opacity-100 transition-opacity">
          <AddElementMenu
            onAddElement={cat => handlers.onAddElement(repoPath, repoLabel, node.name, cat)}
            onAddComponent={() => handlers.onAddComponent(repoPath, node.label || node.name, node.name)}
            onAddInterface={() => handlers.onAddInterface(repoPath, node.label || node.name, node.name)}
          />
          <button
            type="button"
            onClick={e => { e.stopPropagation(); handlers.onEditNode({
              repoPath, repoLabel, nodeName: node.name,
              label: node.label, description: node.description ?? '',
              roles: node.roles ?? [], implementsList: node.implements ?? [],
            }) }}
            className="text-ink-3 hover:text-ink shrink-0"
            title={t('schema.structureTab.renameComponent')}
          >
            <Pencil size={12} />
          </button>
          <span className="shrink-0" onClick={e => e.stopPropagation()}>
            <ConfirmDelete
              onConfirm={() => handlers.onDeleteLocalComponent(repoPath, node.name)}
              label={<Trash2 size={12} />}
              className="text-ink-3 hover:text-status-danger shrink-0"
              // T123 — un composant local qui a lui-même des enfants prévient explicitement du
              // nombre de sous-composants supprimés avec lui (suppression en cascade). Le nombre
              // d'éléments réels (exigences/tests/campagnes) n'est pas dans schema.yaml et n'est
              // pas compté ici — cf. divergence documentée dans specs/T123-sprint2.md.
              body={subCount > 0 ? t('schema.structureTab.deleteComponentCascadeBody', { count: subCount }) : undefined}
            />
          </span>
        </div>
      </DragRow>
      {open && (
        <>
          {objectTypes.map((ot, typeIndex) => (
            <div key={typeIndex} style={{ paddingLeft: `${indent}px` }}>
              <ElementLeaf
                objectType={ot}
                item={{ kind: 'element', repoPath, nodeName: node.name, typeIndex, typeName: ot.name }}
                dragging={handlers.dragging}
                dropTarget={handlers.dropTarget}
                onDragStartRow={handlers.onDragStartRow}
                onDragOverRow={handlers.onDragOverRow}
                onDropRow={handlers.onDropRow}
                onDragEndRow={handlers.onDragEndRow}
                onClick={() => handlers.onSelectElement({ repoPath, repoLabel, nodeName: node.name, typeIndex, isNew: false })}
                onDelete={() => handlers.onDeleteElement({ repoPath, repoLabel, nodeName: node.name, typeIndex, isNew: false })}
              />
            </div>
          ))}
          {children.map(child => (
            <LocalNodeRow
              key={child.name}
              node={child}
              repoPath={repoPath}
              repoLabel={repoLabel}
              indent={indent + 16}
              parentName={node.name}
              repoDependencies={repoDependencies}
              handlers={handlers}
            />
          ))}
          {ownDependencies.map(dep => (
            <RepoRow
              key={dep.name}
              node={dep}
              // T123 (follow-up) — même relation visuelle qu'entre une ligne de repo et ses propres
              // composants locaux/dépendances imbriquées (cf. RepoRow ci-dessous : les dépendances y
              // rendent 8px moins indentées que les composants locaux, à `depth` égal) : indent/16
              // place cette dépendance imbriquée au même niveau que les autres dépendances de
              // `repoPath`, pas un cran plus profond que les propres composants locaux de ce nœud.
              depth={Math.round(indent / 16)}
              parentRepoPath={repoPath}
              localParent={node.name}
              handlers={handlers}
            />
          ))}
        </>
      )}
    </div>
  )
}

function RepoRow({
  node, depth, parentRepoPath, localParent, handlers,
}: {
  node: WorkspaceTreeNode
  depth: number
  /** The repoPath of this node's direct parent in the tree — undefined only for the workspace
   *  root itself, which is never an editable/removable/draggable dependency (T74/T135). */
  parentRepoPath: string | undefined
  /** T135 — this node's own drag & drop sibling group tag: `undefined` for a flat dependency of
   *  `parentRepoPath` itself, or the enclosing local component's name for one nested under it
   *  (mirrors `PolentaRepoDependency.localParent`, cf. `reorderDependencies`). Meaningless (and
   *  unused) for the workspace root, which is never draggable. */
  localParent: string | undefined
  handlers: StructureTreeHandlers
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(depth < 2)
  const indent = depth * 16
  const { workspaceDir, flatNodes, schemasByRepoPath, isLoading, schemasReady } = handlers
  const schema = schemasByRepoPath.get(node.repoPath)
  // root n'est jamais imbriqué (T123) — reste toujours au premier niveau de schema.nodes.
  const rootNode = schema?.nodes.find(n => n.name === 'root')
  // T123 (follow-up) — les dépendances localParent-tagged vers l'un des composants locaux de ce
  // repo rendent imbriquées sous la LocalNodeRow de ce composant (ci-dessous), pas ici à plat.
  const flatDeps = node.children.filter(c => !c.localParent)
  // T135 — le workspace root (pas de parent) n'est jamais déplaçable, comme il n'avait jamais de
  // boutons ↑/↓ avant ce ticket.
  const dragItem: DragItem | null = parentRepoPath
    ? { kind: 'component', parentRepoPath, localParent, name: node.name }
    : null
  // T135 sprint 2 — every RepoRow, root included, is a valid reparent target: `name: null` means
  // "become a flat dependency of `node.repoPath`" (component) or "promote to its top level" (local).
  const reparentTarget: ReparentTarget = { repoPath: node.repoPath, name: null }

  const headerContent = (
    <>
      <span className="text-ink-3">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      {node.isInterface ? (
        <GitFork size={14} className="text-chart-5 shrink-0" />
      ) : (
        <FolderGit2 size={14} className="text-ink-3 shrink-0" />
      )}
      <span className="text-sm font-medium text-ink">{rootNode?.label || node.name}</span>
      {node.isInterface && (
        <span className="text-xs bg-chart-5/10 text-chart-5 px-1.5 py-0.5 rounded font-medium">
          {t('schema.structureTab.interfaceBadge')}
        </span>
      )}
      {node.pin && (
        <code className="text-xs text-ink-3 font-mono ml-2">
          {node.pin.length > 10 ? node.pin.slice(0, 8) : node.pin}
        </code>
      )}
      {/* Inline branch checkout/create (T86) — shortcut onto the same pin the "Modifier" modal
          edits, shown for every repo (root included). */}
      <RepoBranchSelector node={node} workspaceDir={workspaceDir} flatNodes={flatNodes} />
      {/* Right-aligned action cluster (T74 sprint 3) — same edit/delete ordering and placement as
          ElementLeaf's actions, instead of sitting immediately after the name/pin. Reordering
          (T74 sprint 3's ↑/↓ here) is now done by dragging the row itself (T135 sprint 1). */}
      <div className="ml-auto flex items-center gap-1">
        {parentRepoPath && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Merged edit (T74 sprint 3): label/description + branche/rôles in one modal, instead
                of a separate "renommer ce repo" pencil next to the dependency's own edit button. */}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); handlers.onEditDependency(node, parentRepoPath) }}
              disabled={!schemasReady}
              className="text-ink-3 hover:text-ink shrink-0 disabled:opacity-30 disabled:cursor-default"
              title={schemasReady ? t(node.isInterface ? 'schema.structureTab.editDependencyInterface' : 'schema.structureTab.editDependencyComponent') : t('common.loading')}
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); handlers.onRemoveDependency(node, parentRepoPath) }}
              className="text-ink-3 hover:text-status-danger shrink-0"
              title={t('schema.structureTab.removeFromWorkspace')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
        {/* Root workspace node (no parent): label/description/roles/implements (T123) can be
            edited here, same right-aligned placement as the merged edit pencil for other repos. */}
        {rootNode && !parentRepoPath && (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation()
              handlers.onEditNode({
                repoPath: node.repoPath, repoLabel: node.name, nodeName: 'root',
                label: rootNode.label, description: rootNode.description ?? '',
                roles: rootNode.roles ?? [], implementsList: rootNode.implements ?? [],
              })
            }}
            className="text-ink-3 hover:text-ink shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            title={t('schema.structureTab.renameRepo')}
          >
            <Pencil size={12} />
          </button>
        )}
        <AddMenu
          node={node}
          hasRoot={!!rootNode}
          onAddComponent={() => handlers.onAddComponent(node.repoPath, node.name)}
          onAddInterface={() => handlers.onAddInterface(node.repoPath, node.name)}
          onAddElement={category => handlers.onAddElement(node.repoPath, node.name, 'root', category)}
        />
      </div>
    </>
  )

  return (
    <div>
      <DragRow
        item={dragItem}
        reparentTarget={reparentTarget}
        canDropInto={handlers.canDropInto}
        dragging={handlers.dragging}
        dropTarget={handlers.dropTarget}
        onDragStartRow={handlers.onDragStartRow}
        onDragOverRow={handlers.onDragOverRow}
        onDropRow={handlers.onDropRow}
        onDragEndRow={handlers.onDragEndRow}
        onRowClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-hover transition-colors cursor-pointer select-none group"
        style={{ paddingLeft: `${8 + indent}px` }}
      >
        {headerContent}
      </DragRow>

      {open && (
        <div>
          {isLoading && !schema && (
            <p className="text-xs text-ink-3 italic" style={{ paddingLeft: `${32 + indent}px` }}>{t('common.loading')}</p>
          )}
          {/* root's own éléments rendent à plat, sans ligne de composant (comportement T113
              inchangé) — root reste toujours le seul nœud qui n'a pas sa propre ligne. */}
          {(rootNode?.objectTypes ?? []).map((ot, typeIndex) => (
            <div key={typeIndex} style={{ paddingLeft: `${32 + indent}px` }}>
              <ElementLeaf
                objectType={ot}
                item={{ kind: 'element', repoPath: node.repoPath, nodeName: 'root', typeIndex, typeName: ot.name }}
                dragging={handlers.dragging}
                dropTarget={handlers.dropTarget}
                onDragStartRow={handlers.onDragStartRow}
                onDragOverRow={handlers.onDragOverRow}
                onDropRow={handlers.onDropRow}
                onDragEndRow={handlers.onDragEndRow}
                onClick={() => handlers.onSelectElement({ repoPath: node.repoPath, repoLabel: node.name, nodeName: 'root', typeIndex, isNew: false })}
                onDelete={() => handlers.onDeleteElement({ repoPath: node.repoPath, repoLabel: node.name, nodeName: 'root', typeIndex, isNew: false })}
              />
            </div>
          ))}
          {schema && flattenSystemNodes(schema.nodes).every(({ node: n }) => (n.objectTypes ?? []).length === 0) && (
            <p className="text-xs text-ink-3 italic" style={{ paddingLeft: `${32 + indent}px` }}>{t('schema.structureTab.noElementConfigured')}</p>
          )}
          {/* Composants locaux de ce repo, de premier niveau — qu'ils soient des frères de root
              (T113, cas le plus courant : "+ Composant" depuis la ligne de repo) ou des enfants
              de root (T123, ex. créés via le tool MCP add_component avec parentName: 'root') sont
              montrés au même niveau visuel : root n'est pas une catégorie à part, ses enfants sont
              des composants comme les autres (cf. specs/T123.md). Mais ce sont deux tableaux
              distincts en stockage (`rootNode.children` vs `schema.nodes` top-level) — chacun
              garde son propre `parentName` de drag & drop ('root' vs null, T135) pour que
              `reorderSystemNodes` ne tente jamais de les fusionner en un seul réordonnancement :
              le rendu final les affiche toujours l'un après l'autre dans cet ordre fixe, un drag
              inter-groupe ne pourrait de toute façon jamais se traduire par un changement visible. */}
          {(rootNode?.children ?? []).map(localNode => (
            <LocalNodeRow
              key={localNode.name}
              node={localNode}
              repoPath={node.repoPath}
              repoLabel={node.name}
              indent={32 + indent}
              parentName="root"
              repoDependencies={node.children}
              handlers={handlers}
            />
          ))}
          {(schema?.nodes.filter(n => n.name !== 'root') ?? []).map(localNode => (
            <LocalNodeRow
              key={localNode.name}
              node={localNode}
              repoPath={node.repoPath}
              repoLabel={node.name}
              indent={32 + indent}
              parentName={null}
              repoDependencies={node.children}
              handlers={handlers}
            />
          ))}
          {flatDeps.map(child => (
            <RepoRow
              key={child.name}
              node={child}
              depth={depth + 1}
              parentRepoPath={node.repoPath}
              localParent={undefined}
              handlers={handlers}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Édition d'un SystemNode (root ou composant local, imbriqué ou non) : label/description (T74)
 *  plus, depuis T123, ses propres interfaces (roles/implements) — un composant a les mêmes
 *  capacités d'interface qu'un composant en repo séparé, cf. specs/T123.md. Réutilise les mêmes
 *  sections que la popup d'édition d'une dépendance (AddDependencyModal/T110), extraites en
 *  RolesExposedFields/ImplementedInterfacesFields — sans la section "Rôles joués par le parent",
 *  propre à la relation de montage d'un repo séparé, sans équivalent pour un composant local. */
function NodeEditModal({ target, onSave, onClose, resolveInterfaceRoles, resolveInterfacePin }: {
  target: NodeEditTarget
  onSave: (label: string, description: string, roles: RoleDefinition[], implementsList: ImplementsDeclaration[]) => void
  onClose: () => void
  resolveInterfaceRoles?: (mountName: string) => RoleDefinition[] | null
  resolveInterfacePin?: (mountName: string) => string | null
}) {
  const { t } = useTranslation()
  const [label, setLabel] = useState(target.label)
  const [description, setDescription] = useState(target.description)
  const [roles, setRoles] = useState<RoleDefinition[]>(target.roles)
  const [implementsList, setImplementsList] = useState<ImplementsDeclaration[]>(target.implementsList)

  useModalHotkeys(onClose, () => label.trim() && onSave(label, description, roles, implementsList))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">{t('schema.structureTab.editNodeTitle')}</h2>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-xs text-ink-2 mb-0.5">{t('schema.structureTab.displayLabel')}</label>
            <input value={label} onChange={e => setLabel(e.target.value)} className="input-field w-full text-sm py-1" placeholder={t('schema.structureTab.labelPlaceholder')} />
          </div>
          <div>
            <label className="block text-xs text-ink-2 mb-0.5">{t('schema.structureTab.description')}</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className="input-field w-full text-sm py-1" placeholder={t('schema.structureTab.descriptionPlaceholder')} />
          </div>
          <RolesExposedFields catalogRoles={roles} onCatalogRolesChange={setRoles} />
          <ImplementedInterfacesFields
            implementsList={implementsList}
            onImplementsListChange={setImplementsList}
            resolveInterfaceRoles={resolveInterfaceRoles}
            resolveInterfacePin={resolveInterfacePin}
          />
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-edge">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={() => onSave(label, description, roles, implementsList)} disabled={!label.trim()} className="btn-primary">
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Applies `transform` to one node's objectTypes array in a schema. Shared by every Structure-tab
 *  mutation (edit/delete/reorder/append). Keyed by node NAME (T123) — `mapSystemNode` localise le
 *  nœud à n'importe quelle profondeur d'imbrication, une position de tableau ne suffit plus. */
function withNodeObjectTypes(
  schema: ProjectSchema, nodeName: string,
  transform: (types: ObjectTypeDefinition[]) => ObjectTypeDefinition[],
): ProjectSchema {
  return {
    ...schema,
    nodes: mapSystemNode(schema.nodes, nodeName, n => ({ ...n, objectTypes: transform(n.objectTypes ?? []) })),
  }
}

/** Replaces one object type at typeIndex, or removes it if `mutate` returns null. */
function withObjectTypeAt(
  schema: ProjectSchema, nodeName: string, typeIndex: number,
  mutate: (current: ObjectTypeDefinition) => ObjectTypeDefinition | null,
): ProjectSchema {
  return withNodeObjectTypes(schema, nodeName, types => {
    const updated = mutate(types[typeIndex])
    return updated === null
      ? types.filter((_, j) => j !== typeIndex)
      : types.map((t, j) => j === typeIndex ? updated : t)
  })
}

/** Reorders the object types of one node by drag & drop (T135 sprint 1 — replaces the ↑/↓
 *  buttons' adjacent swap with an arbitrary before/after drop position). Each type's own array
 *  index is used as its identity for the reorder — safe because nothing mutates the list between
 *  the drag starting and this running. */
function withObjectTypesReordered(
  schema: ProjectSchema, nodeName: string, draggedIndex: number, targetIndex: number, position: 'before' | 'after',
): ProjectSchema {
  return withNodeObjectTypes(schema, nodeName, types => {
    const reorderedIndices = reorderByKey(types.map((_, i) => i), draggedIndex, targetIndex, position)
    return reorderedIndices.map(i => types[i])
  })
}

/**
 * Reorders local components by drag & drop (T135 sprint 1 — `LocalNodeRow`'s first reorder
 * capability). Thin wrapper over `reorderSystemNodes` (packages/types/schema-tree.ts, shared with
 * the main process/MCP tooling) — see its doc comment for why a component nested in `root`'s own
 * `children[]` must be tagged `parentName: 'root'`, not `null`, even though the Structure tab
 * renders it in the same merged top-level list as genuinely top-level components (cf. RepoRow).
 */
function withLocalComponentsReordered(
  schema: ProjectSchema, parentName: string | null, draggedName: string, targetName: string, position: 'before' | 'after',
): ProjectSchema {
  return { ...schema, nodes: reorderSystemNodes(schema.nodes, parentName, draggedName, targetName, position) }
}

/** Categories checked in AddDependencyModal's "types d'objets créés par défaut" checkboxes
 *  (checked by default) — shared by the local-component path (handleAddLocalComponent) and the
 *  remote-dependency path (handleSubmitDependency), which both seed a freshly added component
 *  with one default object type per checked category. */
function defaultCategoriesFrom(
  values: Pick<AddDependencyValues, 'includeRequirements' | 'includeTests' | 'includeCampaigns'>,
): ObjectCategory[] {
  return [
    ...(values.includeRequirements ? (['requirement'] as const) : []),
    ...(values.includeTests ? (['test'] as const) : []),
    ...(values.includeCampaigns ? (['campaign'] as const) : []),
  ]
}

/** Appends a brand-new object type to one node in a schema; returns the new type's index. */
function withObjectTypeAppended(
  schema: ProjectSchema, nodeName: string, newType: ObjectTypeDefinition,
): { schema: ProjectSchema; typeIndex: number } {
  const typeIndex = (findSystemNode(schema.nodes, nodeName)?.objectTypes ?? []).length
  return { schema: withNodeObjectTypes(schema, nodeName, types => [...types, newType]), typeIndex }
}

export function StructureTab({ workspaceDir, repoPath, projectId }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const {
    isLoading, error, conflicts, tree, flatNodes, schemasByRepoPath, allPrefixes, allSchemasLoaded, refetchTree,
  } = useWorkspaceStructure(workspaceDir, repoPath)

  const [selection, setSelection] = useState<Selection | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflictError, setConflictError] = useState<string | null>(null)
  const [editingNode, setEditingNode] = useState<NodeEditTarget | null>(null)
  const [pendingDependency, setPendingDependency] = useState<PendingDependency | null>(null)
  const [isAddingDependency, setIsAddingDependency] = useState(false)
  const [addDependencyError, setAddDependencyError] = useState<string | null>(null)
  const [localConflicts, setLocalConflicts] = useState<DiamondConflict[] | null>(null)
  const [editingDependency, setEditingDependency] = useState<EditingDependency | null>(null)
  const [isEditingDependency, setIsEditingDependency] = useState(false)
  const [editDependencyError, setEditDependencyError] = useState<string | null>(null)
  const [removingDependency, setRemovingDependency] = useState<RemovingDependency | null>(null)
  const [isRemovingDependency, setIsRemovingDependency] = useState(false)
  const [removeDependencyError, setRemoveDependencyError] = useState<string | null>(null)

  const saveSchema = async (targetRepoPath: string, nextSchema: ProjectSchema) => {
    await api.schema.save(targetRepoPath, nextSchema)
    await qc.invalidateQueries({ queryKey: ['schema', targetRepoPath] })
  }

  const activeConflicts = conflicts ?? localConflicts

  const handleResolveConflicts = async (overrides: MountOverride[]) => {
    setConflictError(null)
    try {
      for (const override of overrides) {
        await api.workspace.setMountOverride(workspaceDir, override)
      }
      setLocalConflicts(null)
      await refetchTree()
    } catch (err) {
      setConflictError(err instanceof Error ? err.message : String(err))
    }
  }

  const selectedSchema = selection ? schemasByRepoPath.get(selection.repoPath) : undefined
  const selectedRaw = selection && selectedSchema
    ? findSystemNode(selectedSchema.nodes, selection.nodeName)?.objectTypes?.[selection.typeIndex]
    : undefined
  const selectedObjectType: EditableObjectType | null = selectedRaw ? objTypeToEditable(selectedRaw) : null

  const applyToSelection = async (mutate: (current: ObjectTypeDefinition) => ObjectTypeDefinition | null) => {
    if (!selection) return
    if (!allSchemasLoaded) {
      setSaveError(t('schema.structureTab.schemaLoadingRetry'))
      return
    }
    const schema = schemasByRepoPath.get(selection.repoPath)
    if (!schema) return
    setIsSaving(true)
    setSaveError(null)
    try {
      await saveSchema(selection.repoPath, withObjectTypeAt(schema, selection.nodeName, selection.typeIndex, mutate))
      setSelection(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveElement = (updated: EditableObjectType) => applyToSelection(() => editableToObjType(updated))
  const handleDeleteElement = () => applyToSelection(() => null)

  /** Deletes an element directly from its row's trash icon, bypassing the config modal (T74 sprint 3). */
  const handleDeleteElementAt = async (sel: Selection) => {
    const schema = schemasByRepoPath.get(sel.repoPath)
    if (!schema) return
    try {
      await saveSchema(sel.repoPath, withObjectTypeAt(schema, sel.nodeName, sel.typeIndex, () => null))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCloseElementModal = async () => {
    if (selection?.isNew) {
      // A new element that's being abandoned has nothing saved to preserve — discard its scaffold.
      const schema = schemasByRepoPath.get(selection.repoPath)
      if (schema) {
        try {
          await saveSchema(selection.repoPath, withObjectTypeAt(schema, selection.nodeName, selection.typeIndex, () => null))
        } catch {
          // best-effort cleanup — nothing more useful to do if this fails
        }
      }
    }
    setSelection(null)
    setSaveError(null)
  }

  /** T135 sprint 1 — reorders one node's object types among their siblings by drag & drop
   *  (replaces the ↑/↓ buttons `handleMoveElement` used to drive). */
  const handleReorderElement = async (
    repoPath: string, nodeName: string, draggedIndex: number, targetIndex: number, position: 'before' | 'after',
  ) => {
    const schema = schemasByRepoPath.get(repoPath)
    if (!schema) return
    try {
      await saveSchema(repoPath, withObjectTypesReordered(schema, nodeName, draggedIndex, targetIndex, position))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  /** T135 sprint 1 — reorders a component/interface among its siblings by drag & drop (replaces
   *  the ↑/↓ buttons T74 sprint 3 added, mirroring handleReorderElement). */
  const handleReorderComponent = async (
    parentRepoPath: string, localParent: string | undefined, draggedName: string, targetName: string, position: 'before' | 'after',
  ) => {
    try {
      const result = await reorderDependencies(workspaceDir, parentRepoPath, localParent, draggedName, targetName, position)
      if (result.status === 'ok') {
        qc.setQueryData(['workspace-open', workspaceDir], result)
      } else if (result.status === 'diamond-conflict') {
        setLocalConflicts(result.conflicts)
      } else if (result.status === 'parse-error') {
        setSaveError(t('schema.structureTab.parseError', { repoName: result.repoName, error: result.error }))
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  /** T135 sprint 1 — reorders a local component among its siblings by drag & drop; `LocalNodeRow`'s
   *  first reorder capability (it had none before this ticket). */
  const handleReorderLocalComponent = async (
    repoPath: string, parentName: string | null, draggedName: string, targetName: string, position: 'before' | 'after',
  ) => {
    const schema = schemasByRepoPath.get(repoPath)
    if (!schema) return
    try {
      await saveSchema(repoPath, withLocalComponentsReordered(schema, parentName, draggedName, targetName, position))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  /** T135 sprint 2 — reparents a local component (with its own subtree) under `toParentName`
   *  (`null` promotes it to the top level of `repoPath`'s own schema). `LocalNodeRow`/`RepoRow`
   *  becoming valid "drop into me" targets. */
  const handleReparentLocalComponent = async (repoPath: string, name: string, toParentName: string | null) => {
    const schema = schemasByRepoPath.get(repoPath)
    if (!schema) return
    try {
      await saveSchema(repoPath, { ...schema, nodes: moveSystemNode(schema.nodes, name, toParentName) })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  /** T135 sprint 2 — reparents a mounted component/interface dependency onto a different repo
   *  (`toLocalParent: undefined`) or a different local component (`toLocalParent: name`). */
  const handleReparentDependency = async (from: DragItem & { kind: 'component' }, to: ReparentTarget) => {
    const dep = flatNodes.find(n => n.name === from.name)
    if (!dep) return
    try {
      const result = await moveDependencyToParent(
        workspaceDir, from.parentRepoPath, to.repoPath, to.name ?? undefined,
        { name: dep.name, url: dep.url, pin: dep.pin, repoPath: dep.repoPath, localParent: from.localParent },
      )
      if (result.status === 'ok') {
        qc.setQueryData(['workspace-open', workspaceDir], result)
      } else if (result.status === 'diamond-conflict') {
        setLocalConflicts(result.conflicts)
      } else if (result.status === 'parse-error') {
        setSaveError(t('schema.structureTab.parseError', { repoName: result.repoName, error: result.error }))
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  /** T135 sprint 3 — resolves the actual `ObjectTypeDefinition` an `element` `DragItem` refers
   *  to, verifying its name still matches what was captured at drag-start (`item.typeName`).
   *  Guards against the node's `objectTypes[]` reindexing between drag-start and this running —
   *  a narrower risk for sprints 1-2 (a single local schema save), more real for this sprint's
   *  reparenting (a full IPC round trip plus cascade, long enough for a concurrent edit to land
   *  mid-drag). Returns `undefined` if the node/index is gone, or if whatever now sits at that
   *  index isn't the type that was actually picked up. */
  const resolveElementType = (item: DragItem & { kind: 'element' }): ObjectTypeDefinition | undefined => {
    const schema = schemasByRepoPath.get(item.repoPath)
    const node = schema && findSystemNode(schema.nodes, item.nodeName)
    const type = node?.objectTypes?.[item.typeIndex]
    return type?.name === item.typeName ? type : undefined
  }

  /** T135 sprint 3 — reparents an element (type exigence/test/campagne) onto another node of
   *  the same repo, cascading the `objectTypeRef` rewrite to every existing requirement/test
   *  that referenced the old node — orchestrated server-side in one IPC round trip (schema
   *  mutation + cascade), cf. `element-move.service.ts`. */
  const handleReparentElement = async (from: DragItem & { kind: 'element' }, to: ReparentTarget) => {
    const type = resolveElementType(from)
    if (!type) {
      setSaveError(t('schema.structureTab.moveElementStale'))
      return
    }
    try {
      const result = await api.schema.moveElement(from.repoPath, {
        fromNodeName: from.nodeName, toNodeName: to.name ?? 'root', typeName: type.name,
      })
      await qc.invalidateQueries({ queryKey: ['schema', from.repoPath] })
      await qc.invalidateQueries({ queryKey: ['requirements-all', from.repoPath] })
      await qc.invalidateQueries({ queryKey: ['tests-all', from.repoPath] })
      if (result.failed.length > 0) {
        console.error('[StructureTab] objectTypeRef cascade partially failed:', result.failed)
        setSaveError(t('schema.structureTab.moveElementCascadePartialFailure', { count: result.failed.length }))
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * T135 sprint 2-3 — is `dragging` currently valid to drop into `target` (become its new
   * parent)? An element (type exigence/test/campagne) can only move to another node of the
   * *same repo* (cf. "découverte clé" in specs/T135-design.md — a different repo would mean
   * physically moving requirement/test files between two Git repos, out of scope for this
   * ticket), never back onto its own current node, and never onto a node that already has a
   * type of the same name. A local component can only move within its own repo's schema
   * (same cross-repo restriction, for the same underlying reason as elements — its own
   * elements would need the same file move), never onto itself or one of its own descendants
   * (`isDescendant`), and never onto its own *current* parent — that's a no-op already
   * reachable (and cheaper) through sprint 1's reorder-to-end, not worth a
   * `removeDependency`+`addDependency` round trip (with its own diamond-conflict check) for
   * zero actual effect. A mounted dependency can move to any other repo in the workspace,
   * except itself, its own current parent, or one of its own (transitive) dependents
   * (`isWorkspaceDescendant`) — that would make a dependent depend on itself.
   */
  const canDropInto = (dragging: DragItem, target: ReparentTarget): boolean => {
    if (dragging.kind === 'element') {
      if (target.repoPath !== dragging.repoPath) return false
      const destNodeName = target.name ?? 'root'
      if (destNodeName === dragging.nodeName) return false
      const draggedType = resolveElementType(dragging)
      if (!draggedType) return false
      const schema = schemasByRepoPath.get(dragging.repoPath)
      const destNode = schema && findSystemNode(schema.nodes, destNodeName)
      if (!destNode || destNode.objectTypes?.some(t => t.name === draggedType.name)) return false
      return true
    }
    if (dragging.kind === 'local') {
      if (target.repoPath !== dragging.repoPath || target.name === dragging.name) return false
      if (target.name === dragging.parentName) return false
      const schema = schemasByRepoPath.get(dragging.repoPath)
      if (target.name !== null && schema && isDescendant(schema.nodes, dragging.name, target.name)) return false
      return true
    }
    const draggedRepoPath = flatNodes.find(n => n.name === dragging.name)?.repoPath
    if (!draggedRepoPath || target.repoPath === draggedRepoPath) return false
    if (target.repoPath === dragging.parentRepoPath && target.name === (dragging.localParent ?? null)) return false
    return !isWorkspaceDescendant(tree, dragging.name, target.repoPath)
  }

  /**
   * Drag & drop state (T135 sprint 1-2) — centralized here rather than per-row local state (unlike
   * `ReorderableSidebarSection`'s single flat list) since the Structure tab's tree has many nested
   * sibling groups and, from sprint 2 on, a drop can target a row in a different branch entirely
   * (reparenting).
   */
  const [dragging, setDragging] = useState<DragItem | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const handleDragStartRow = (item: DragItem) => setDragging(item)

  function sameDropTarget(a: DropTarget, b: DropTarget): boolean {
    // Narrows each side on its own discriminant (matching how `DragRow` itself narrows
    // `dropTarget.position === 'into'`) rather than casting both operands to one shape.
    if (a.position === 'into') return b.position === 'into' && sameReparentTarget(a, b)
    return b.position !== 'into' && sameDragItem(a, b)
  }

  const handleDragOverRow = (target: DropTarget) => {
    // `dragover` fires continuously — skip the state update (and the re-render it triggers for
    // the whole tree) when the computed drop target hasn't actually changed since last time.
    setDropTarget(prev => (prev && sameDropTarget(prev, target)) ? prev : target)
  }

  const handleDragEndRow = () => {
    setDragging(null)
    setDropTarget(null)
  }

  const handleDropRow = () => {
    const from = dragging
    const to = dropTarget
    setDragging(null)
    setDropTarget(null)
    if (!from || !to) return
    if (to.position === 'into') {
      // Safety net, not the primary gate — `DragRow` only ever offers an 'into' drop target when
      // `canDropInto` already said yes, but state can theoretically go stale between the last
      // `dragover` and this `drop` (e.g. a schema refetch mid-drag) — re-check before writing.
      if (!canDropInto(from, to)) return
      if (from.kind === 'local') handleReparentLocalComponent(from.repoPath, from.name, to.name)
      else if (from.kind === 'component') handleReparentDependency(from, to)
      else if (from.kind === 'element') handleReparentElement(from, to)
      return
    }
    if (sameDragItem(from, to)) return
    if (from.kind === 'element' && to.kind === 'element') {
      handleReorderElement(from.repoPath, from.nodeName, from.typeIndex, to.typeIndex, to.position)
    } else if (from.kind === 'component' && to.kind === 'component') {
      handleReorderComponent(from.parentRepoPath, from.localParent, from.name, to.name, to.position)
    } else if (from.kind === 'local' && to.kind === 'local') {
      handleReorderLocalComponent(from.repoPath, from.parentName, from.name, to.name, to.position)
    }
  }

  const handleAddElement = async (repoPath: string, repoLabel: string, nodeName: string, category: ObjectCategory) => {
    const schema = schemasByRepoPath.get(repoPath)
    if (!schema) return
    // `nodeName` is 'root' when added from a RepoRow (cf. AddMenu callers below) — in that case the
    // component name is the repo's own mount name (`repoLabel`), not the literal string 'root'.
    const componentName = nodeName === 'root' ? repoLabel : nodeName
    const newType = editableToObjType(
      emptyObjType(category, componentName, t(CATEGORY_LABEL_KEY[category]), t('schema.editor.descriptionFieldLabel')),
    )
    const { schema: nextSchema, typeIndex } = withObjectTypeAppended(schema, nodeName, newType)
    try {
      await saveSchema(repoPath, nextSchema)
      setSelection({ repoPath, repoLabel, nodeName, typeIndex, isNew: true })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSaveNodeLabel = async (
    label: string, description: string, roles: RoleDefinition[], implementsList: ImplementsDeclaration[],
  ) => {
    if (!editingNode) return
    const schema = schemasByRepoPath.get(editingNode.repoPath)
    if (!schema) return
    try {
      const nextSchema: ProjectSchema = {
        ...schema,
        // T123 — roles/implements vivent sur le SystemNode lui-même (root compris), pas sur
        // ProjectSchema (déprécié) — omis (plutôt que `[]`) quand vide, même convention que
        // handleSubmitEditDependency ci-dessous pour ne pas écrire de clé superflue.
        nodes: mapSystemNode(schema.nodes, editingNode.nodeName, n => ({
          ...n,
          label: label.trim() || n.name,
          description: description.trim() || undefined,
          roles: roles.length > 0 ? roles : undefined,
          implements: implementsList.length > 0 ? implementsList : undefined,
        })),
      }
      await saveSchema(editingNode.repoPath, nextSchema)
      // T123 — éditer les roles/implements du node `root` (self-edit, pas de parent) doit aussi
      // rafraîchir le badge "Interface" de sa propre ligne de repo, dérivé de
      // WorkspaceTreeNode.isInterface (cache de l'arbre workspace, distinct du cache de schéma
      // que saveSchema invalide déjà) — sans quoi le badge resterait figé jusqu'au prochain
      // rechargement complet de l'arbre. Sans effet perceptible pour un composant local (son
      // badge se dérive directement du schéma, déjà rafraîchi par saveSchema).
      await refetchTree()
      setEditingNode(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setEditingNode(null)
    }
  }

  /** Removes a local component (a SystemNode living in this repo's own schema.yaml, cf. T113) —
   *  at any nesting depth (T123) — along with its whole subtree of nested local components and
   *  their elements. */
  const handleDeleteLocalComponent = async (targetRepoPath: string, nodeName: string) => {
    const schema = schemasByRepoPath.get(targetRepoPath)
    if (!schema) return
    try {
      await saveSchema(targetRepoPath, { ...schema, nodes: removeSystemNode(schema.nodes, nodeName) })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  /** T113 — "Composant local" branch of handleSubmitDependency: appends a plain SystemNode to
   *  the target repo's own schema.yaml instead of registering a polenta-repo.yaml dependency.
   *  No git/workspace-tree involvement, so it's kept separate from the repo-backed path below.
   *  T123 — avec `parentName`, le nouveau nœud est imbriqué dans `children[]` de ce composant
   *  local plutôt qu'ajouté au niveau racine de `schema.nodes[]`. */
  const handleAddLocalComponent = async (targetRepoPath: string, values: AddDependencyValues, parentName?: string) => {
    const schema = schemasByRepoPath.get(targetRepoPath)
    if (!schema) {
      // Same repo whose "+" the user just clicked, so this should be rare — but its schema
      // query can still be in flight (per-repo schema fetches run in parallel with the tree
      // fetch, cf. useWorkspaceStructure). Surface it instead of silently doing nothing.
      setAddDependencyError(t('schema.structureTab.schemaLoadingForLocal'))
      return
    }
    const name = values.name.trim()
    // T123 — unicité sur tout l'arbre local (pas seulement le premier niveau), cf. specs/T123.md
    // §Décisions #1 : findSystemNode cherche récursivement dans children[].
    if (name === 'root' || findSystemNode(schema.nodes, name) || flatNodes.some(n => n.name === name)) {
      setAddDependencyError(t('schema.structureTab.nameAlreadyUsed'))
      return
    }
    setIsAddingDependency(true)
    setAddDependencyError(null)
    try {
      // Checkboxes in AddDependencyModal (checked by default) — seed the new node with one
      // default object type per checked category, same factory as the "+ élément" button
      // (handleAddElement above) so a freshly added component isn't left with an empty tree.
      const objectTypes = defaultCategoriesFrom(values).map(category => editableToObjType(
        emptyObjType(category, name, t(CATEGORY_LABEL_KEY[category]), t('schema.editor.descriptionFieldLabel')),
      ))
      const newNode: SystemNode = {
        name, label: values.label.trim() || name, readonly: false, objectTypes,
        description: values.description.trim() || undefined,
      }
      const nodes = parentName
        ? mapSystemNode(schema.nodes, parentName, p => ({ ...p, children: [...(p.children ?? []), newNode] }))
        : [...schema.nodes, newNode]
      await saveSchema(targetRepoPath, { ...schema, nodes })
      setPendingDependency(null)
    } catch (err) {
      setAddDependencyError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsAddingDependency(false)
    }
  }

  const handleSubmitDependency = async (values: AddDependencyValues) => {
    if (!pendingDependency) return
    if (values.isLocal) {
      await handleAddLocalComponent(pendingDependency.repoPath, values, pendingDependency.parentName)
      return
    }
    setIsAddingDependency(true)
    setAddDependencyError(null)
    try {
      await ensureWorkspaceInitialized(workspaceDir, repoPath)
      const dep: PolentaRepoDependency = {
        name: values.name, url: values.url, pin: values.branch,
        // T123 (follow-up) — "+ Composant"/"+ Interface" déclenché depuis la ligne d'un composant
        // local (checkbox "Composant local" laissée décochée, sinon la branche `values.isLocal`
        // ci-dessus aurait déjà retourné) : nest la dépendance sous ce composant dans l'arbre
        // Structure, exactement comme pour un repo (cf. specs/T123.md §3). `undefined` quand
        // déclenché depuis une ligne de repo (`parentName` absent) — mounted à plat, comme avant
        // ce champ.
        localParent: pendingDependency.parentName,
      }
      const result = pendingDependency.kind === 'component'
        ? await addDependency(workspaceDir, pendingDependency.repoPath, dep)
        : await addInterfaceImplementation(workspaceDir, pendingDependency.repoPath, dep, {
            interface: values.name,
            // Le catalogue de rôles se saisit désormais en édition uniquement (T110) — l'ajout
            // d'une nouvelle dépendance interface la monte sans rôle initial.
            roles: values.parentRoles,
          } satisfies ImplementsDeclaration)

      if (result.status === 'ok') {
        setPendingDependency(null)
        // `result.tree` is already the freshly rebuilt tree — seed the cache directly
        // instead of re-fetching it, and let react-query pick up the (new, previously
        // unseen) dependency's schema query on its own rather than invalidating every
        // already-loaded repo's schema.
        qc.setQueryData(['workspace-open', workspaceDir], result)
        // Checkboxes only render for kind === 'component' (cf. AddDependencyModal's canBeLocal) —
        // for an interface, `values.include*` still carry their unseen default (true) and must be
        // ignored here, or every "+ Interface" would silently seed object types nobody asked for.
        const categories = pendingDependency.kind === 'component' ? defaultCategoriesFrom(values) : []
        // T177 — label/description saisis à l'ajout, écrits sur le node `root` du schéma propre
        // de la dépendance (comme en édition). Seulement s'ils sont renseignés : un repo existant
        // qui a déjà son propre label ne doit pas le perdre parce que le champ a été laissé vide.
        const label = values.label.trim()
        const description = values.description.trim()
        const newRepoPath = result.tree.nodes.find(n => n.name === values.name)?.repoPath
        if (newRepoPath && (categories.length > 0 || label || description)) {
          try {
            let nextSchema = await api.schema.get(newRepoPath)
            // Only seed an empty/fresh component's own schema — never override an existing
            // component's already-configured object types just because it got (re-)linked here,
            // which would clobber a repo that manages its own schema.yaml autonomously.
            if (categories.length > 0 && (findSystemNode(nextSchema.nodes, 'root')?.objectTypes ?? []).length === 0) {
              const newTypes = categories.map(category => editableToObjType(
                emptyObjType(category, values.name, t(CATEGORY_LABEL_KEY[category]), t('schema.editor.descriptionFieldLabel')),
              ))
              nextSchema = withNodeObjectTypes(nextSchema, 'root', () => newTypes)
            }
            if (label || description) {
              nextSchema = {
                ...nextSchema,
                nodes: mapSystemNode(nextSchema.nodes, 'root', n => ({
                  ...n,
                  ...(label ? { label } : {}),
                  ...(description ? { description } : {}),
                })),
              }
            }
            await saveSchema(newRepoPath, nextSchema)
            // WorkspaceTreeNode.label est dérivé du node root au (re)build de l'arbre — même
            // raisonnement que handleSubmitEditDependency : refetch APRÈS le setQueryData ci-dessus.
            if (label) await refetchTree()
          } catch (err) {
            // Best-effort, same reasoning as renameDependency's cascade (workspaceActions.ts):
            // the dependency itself was already added successfully — a failure to seed its
            // default object types / label must not surface as a failure of the whole action.
            console.error('[handleSubmitDependency] Could not seed default object types / label on new dependency:', err)
          }
        }
      } else if (result.status === 'diamond-conflict') {
        setPendingDependency(null)
        setLocalConflicts(result.conflicts)
      } else if (result.status === 'parse-error') {
        setAddDependencyError(t('schema.structureTab.parseError', { repoName: result.repoName, error: result.error }))
      } else {
        // Unreachable in practice: ensureWorkspaceInitialized() just above guarantees the
        // workspace marker exists, which is the only way rebuildTree returns 'not-a-workspace'.
        // Kept as a defensive fallback in case of external filesystem interference.
        setAddDependencyError(t('schema.structureTab.notAWorkspace'))
      }
    } catch (err) {
      setAddDependencyError(
        err instanceof MountNameConflictError ? err.message
        : err instanceof Error ? err.message
        : String(err),
      )
    } finally {
      setIsAddingDependency(false)
    }
  }

  const handleOpenEditDependency = (node: WorkspaceTreeNode, parent: string) => {
    // Guarded by disabling the edit button itself while !allSchemasLoaded (passed down to
    // RepoRow) — pre-filling roles from a schema that hasn't loaded yet would silently wipe
    // out real roles on save, the same risk applyToSelection guards against for prefixes.
    if (!allSchemasLoaded) return
    const parentSchema = schemasByRepoPath.get(parent)
    const parentRootNode = parentSchema ? findSystemNode(parentSchema.nodes, 'root') : undefined
    // Pré-rempli pour tout nœud (T110), pas seulement les interfaces — voir "problème d'œuf et
    // de poule" dans specs/T110-design.md : un repo jamais encore marqué interface doit pouvoir
    // le devenir, donc ces sections ne peuvent pas être gatées sur node.isInterface. T123 :
    // implements peut désormais vivre sur le node root plutôt qu'au niveau racine du fichier —
    // fichier d'abord (legacy), node root en repli (écritures faites depuis ce ticket).
    const parentImplements = parentSchema?.implements ?? parentRootNode?.implements
    const parentRoles = parentImplements?.find(impl => impl.interface === node.name)?.roles ?? []
    // Merged in from the former standalone "renommer ce repo" pencil (T74 sprint 3) — pre-fill
    // the component/interface's own label & description from its own schema's root node.
    const childSchema = schemasByRepoPath.get(node.repoPath)
    const childNodeIndex = childSchema?.nodes.findIndex(n => n.name === 'root') ?? -1
    const childRootNode = childNodeIndex >= 0 ? childSchema!.nodes[childNodeIndex] : undefined
    setEditingDependency({
      parentRepoPath: parent,
      parentLabel: parentSchema?.nodes?.[0]?.label || parent,
      kind: node.isInterface ? 'interface' : 'component',
      childRepoPath: node.repoPath,
      childNodeIndex: childNodeIndex >= 0 ? childNodeIndex : null,
      initialValues: {
        url: node.url, name: node.name, branch: node.pin,
        // T123 — roles/implements du composant édité : fichier d'abord (legacy), node root en
        // repli (mêmes raisons que parentImplements ci-dessus).
        catalogRoles: childSchema?.roles ?? childRootNode?.roles ?? [], parentRoles,
        implementsList: childSchema?.implements ?? childRootNode?.implements ?? [],
        label: childRootNode?.label ?? '', description: childRootNode?.description ?? '',
        isLocal: false,
        // Edit mode never seeds default object types (cf. AddDependencyValues) — irrelevant here.
        includeRequirements: false, includeTests: false, includeCampaigns: false,
      },
    })
  }

  /** T110 sprint 2 — résout le nom de montage d'une interface (section "Interfaces implémentées")
   *  vers son catalogue de rôles, `null` si non résolvable. Fourni à `AddDependencyModal`
   *  plutôt que fetché par elle — elle reste un composant de présentation pure, `StructureTab` a
   *  déjà `flatNodes`/`schemasByRepoPath` en mémoire (T113 : plus qu'un mount par repo possible,
   *  donc on cherche par nom de nœud dans flatNodes, pas juste par repoPath).
   *  T123 : `name` peut aussi désigner un composant LOCAL (pas un mount de repo) — un composant a
   *  les mêmes capacités d'interface qu'un composant avec repo séparé. Repo d'abord (le cas le
   *  plus courant), sinon recherche récursive dans l'arbre local de chaque repo du workspace. */
  const resolveInterfaceRoles = (mountName: string): RoleDefinition[] | null => {
    const name = mountName.trim()
    const repoPath = flatNodes.find(n => n.name === name)?.repoPath
    if (repoPath) return schemasByRepoPath.get(repoPath)?.roles ?? []
    for (const schema of schemasByRepoPath.values()) {
      const node = findSystemNode(schema.nodes, name)
      if (node) return node.roles ?? []
    }
    return null
  }

  /** T110 sprint 2 — même résolution que la colonne pin de l'arbre Structure (RepoRow), tronquée
   *  pareillement. */
  const resolveInterfacePin = (mountName: string): string | null => {
    const pin = flatNodes.find(n => n.name === mountName.trim())?.pin
    if (!pin) return null
    return pin.length > 10 ? pin.slice(0, 8) : pin
  }

  const handleSubmitEditDependency = async (values: AddDependencyValues) => {
    if (!editingDependency) return
    setIsEditingDependency(true)
    setEditDependencyError(null)
    try {
      // Tracks the child's own repoPath as it may move out from under us below (renaming the
      // mount also renames its directory) — the label/description write at the end must target
      // wherever the child actually ended up, not the pre-rename path.
      let childRepoPath = editingDependency.childRepoPath

      // Rename first if the mount name changed (T74 sprint 2) — the physical directory rename
      // + implements[] cascade must land before addDependency() below, which targets the
      // (possibly new) name to correct its pin.
      if (values.name !== editingDependency.initialValues.name) {
        const renameResult = await renameDependency(workspaceDir, editingDependency.parentRepoPath, {
          oldName: editingDependency.initialValues.name,
          newName: values.name,
          url: values.url,
        })
        if (renameResult.status !== 'ok') {
          if (renameResult.status === 'diamond-conflict') {
            setEditingDependency(null)
            setLocalConflicts(renameResult.conflicts)
          } else if (renameResult.status === 'parse-error') {
            setEditDependencyError(t('schema.structureTab.parseError', { repoName: renameResult.repoName, error: renameResult.error }))
          } else {
            setEditDependencyError(t('schema.structureTab.notAWorkspace'))
          }
          return
        }
        // The cascade may have rewritten implements[] on any repo in the workspace, not just
        // the parent — invalidate all of them rather than guessing which ones changed.
        for (const node of renameResult.tree.nodes) {
          await qc.invalidateQueries({ queryKey: ['schema', node.repoPath] })
        }
        childRepoPath = renameResult.tree.nodes.find(n => n.name === values.name)?.repoPath ?? childRepoPath
      }

      const dep: PolentaRepoDependency = { name: values.name, url: values.url, pin: values.branch }
      const result = await addDependency(workspaceDir, editingDependency.parentRepoPath, dep)
      if (result.status !== 'ok') {
        if (result.status === 'diamond-conflict') {
          setEditingDependency(null)
          setLocalConflicts(result.conflicts)
        } else if (result.status === 'parse-error') {
          setEditDependencyError(t('schema.structureTab.parseError', { repoName: result.repoName, error: result.error }))
        } else {
          setEditDependencyError(t('schema.structureTab.notAWorkspace'))
        }
        return
      }
      // T110 : plus de condition sur editingDependency.kind — un nœud jamais encore marqué
      // interface doit pouvoir le devenir. N'écrit côté parent que s'il y a un rôle joué à
      // écrire ou à préserver — pas juste sur catalogRoles.length (constaté en vérification
      // manuelle : donner un premier rôle au catalogue de l'enfant sans cocher aucune case
      // « Rôles joués » créait quand même une entrée `implements: [{..., roles: []}]` côté
      // parent, jamais demandée par l'utilisateur). Compare aussi à l'état initial de
      // parentRoles : décocher le dernier rôle hérité hors catalogue (parentRoles final vide,
      // mais non vide avant édition) doit tout de même persister ce retrait explicite.
      if (values.parentRoles.length > 0 || editingDependency.initialValues.parentRoles.length > 0) {
        await updateInterfaceRoles(
          editingDependency.parentRepoPath,
          values.name,
          values.parentRoles,
        )
      }
      // Merged in from the former standalone "renommer ce repo" pencil (T74 sprint 3) — write
      // the label/description back onto the child's own schema root node, fetched fresh (not
      // from the possibly-stale `schemasByRepoPath` closure) since childRepoPath may have just
      // changed above.
      if (editingDependency.childNodeIndex !== null) {
        const childSchema = await api.schema.get(childRepoPath)
        // T123 — roles/implements vivent désormais sur le SystemNode `root` du repo lui-même
        // (déprécié au niveau racine du fichier, cf. schema.ts), pour que ce mécanisme soit
        // identique à celui d'un composant local. Omis (plutôt que `[]`) quand vide, comme
        // ailleurs dans ce fichier — sinon chaque édition d'un composant qui n'a jamais été une
        // interface écrirait un `roles: []` superflu dans son schema.yaml.
        const nextChildSchema: ProjectSchema = {
          ...childSchema,
          nodes: childSchema.nodes.map((n, i) => i !== editingDependency.childNodeIndex ? n : {
            ...n,
            label: values.label.trim() || n.name,
            description: values.description.trim() || undefined,
            roles: values.catalogRoles.length > 0 ? values.catalogRoles : undefined,
            implements: values.implementsList.length > 0 ? values.implementsList : undefined,
          }),
        }
        await api.schema.save(childRepoPath, nextChildSchema)
        await qc.invalidateQueries({ queryKey: ['schema', childRepoPath] })
      }
      await qc.invalidateQueries({ queryKey: ['schema', editingDependency.parentRepoPath] })
      setEditingDependency(null)
      qc.setQueryData(['workspace-open', workspaceDir], result)
      // T123 — WorkspaceTreeNode.isInterface/.implements (badge, matrice de conformité) sont
      // dérivés du node root au (re)build de l'arbre workspace, pas du cache de schéma —
      // rafraîchir explicitement APRÈS le setQueryData ci-dessus (qui seed `result`, capturé
      // avant l'écriture roles/implements plus haut — un refetch avant aurait été écrasé par ce
      // seed obsolète). Même raisonnement que handleSaveNodeLabel plus haut dans ce fichier.
      await refetchTree()
    } catch (err) {
      setEditDependencyError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsEditingDependency(false)
    }
  }

  const handleOpenRemoveDependency = (node: WorkspaceTreeNode, parent: string) => {
    setRemovingDependency({
      parentRepoPath: parent,
      repoLabel: node.name,
      dep: { name: node.name, url: node.url, repoPath: node.repoPath },
    })
  }

  const handleConfirmRemoveDependency = async (deleteLocalFolder: boolean) => {
    if (!removingDependency) return
    setIsRemovingDependency(true)
    setRemoveDependencyError(null)
    try {
      const result = await removeDependency(
        workspaceDir, removingDependency.parentRepoPath, removingDependency.dep, deleteLocalFolder,
      )
      if (result.status === 'ok') {
        await qc.invalidateQueries({ queryKey: ['schema', removingDependency.parentRepoPath] })
        // Also drop the removed repo's own cached schema — if the same mount name is re-added
        // later in this session, it must re-fetch rather than serve pre-removal data.
        await qc.invalidateQueries({ queryKey: ['schema', removingDependency.dep.repoPath] })
        setRemovingDependency(null)
        qc.setQueryData(['workspace-open', workspaceDir], result)
      } else if (result.status === 'diamond-conflict') {
        setRemovingDependency(null)
        setLocalConflicts(result.conflicts)
      } else if (result.status === 'parse-error') {
        setRemoveDependencyError(t('schema.structureTab.parseError', { repoName: result.repoName, error: result.error }))
      } else {
        setRemoveDependencyError(t('schema.structureTab.notAWorkspace'))
      }
    } catch (err) {
      setRemoveDependencyError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsRemovingDependency(false)
    }
  }

  const handleDiamondCancel = () => {
    setLocalConflicts(null)
    // `activeConflicts` prefers `conflicts` (from useWorkspaceStructure, a persistent load-time
    // conflict) over `localConflicts` — clearing local state alone wouldn't dismiss the modal for
    // that source, since nothing else feeds it back to null. Navigating away (there's no other
    // in-project screen since T86 removed the Dashboard) is the only way to actually leave a
    // workspace whose tree can't be resolved without picking mount names.
    navigate({ to: '/' })
  }

  if (isLoading && tree.length === 0 && !error) {
    return <div className="text-sm text-ink-3">{t('schema.structureTab.loadingStructure')}</div>
  }

  // T123 (follow-up) — bundle passed verbatim to every RepoRow/LocalNodeRow at any depth (cf.
  // StructureTreeHandlers). `onAddComponent`/`onAddInterface` take an optional `parentName`:
  // absent when triggered from a repo row (mounted flatly), present when triggered from a local
  // component row — both open the same AddDependencyModal, checkbox included, so the modal
  // itself decides local-vs-repo-séparé (cf. handleSubmitDependency).
  const treeHandlers: StructureTreeHandlers = {
    workspaceDir,
    flatNodes,
    schemasByRepoPath,
    isLoading,
    schemasReady: allSchemasLoaded,
    onSelectElement: setSelection,
    onEditNode: setEditingNode,
    onAddElement: handleAddElement,
    onDeleteLocalComponent: handleDeleteLocalComponent,
    onDeleteElement: handleDeleteElementAt,
    onAddComponent: (repoPath, repoLabel, parentName) => setPendingDependency({ repoPath, repoLabel, kind: 'component', parentName }),
    onAddInterface: (repoPath, repoLabel, parentName) => setPendingDependency({ repoPath, repoLabel, kind: 'interface', parentName }),
    onEditDependency: handleOpenEditDependency,
    onRemoveDependency: handleOpenRemoveDependency,
    dragging,
    dropTarget,
    onDragStartRow: handleDragStartRow,
    onDragOverRow: handleDragOverRow,
    onDropRow: handleDropRow,
    onDragEndRow: handleDragEndRow,
    canDropInto,
  }

  return (
    <div>
      {activeConflicts && (
        <DiamondConflictModal
          conflicts={activeConflicts}
          onResolve={handleResolveConflicts}
          onCancel={handleDiamondCancel}
        />
      )}

      {(error || conflictError) && (
        <div className="flex items-start gap-2 bg-status-danger-bg border border-status-danger-border rounded px-3 py-2 text-sm text-status-danger mb-3">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error ?? conflictError}</span>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-ink-3">{t('schema.structureTab.treeDescription')}</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: '/compliance', search: { dir: workspaceDir, repoPath, projectId } })}
            className="text-xs text-ink-3 hover:text-ink flex items-center gap-1 transition-colors"
          >
            <ShieldCheck size={12} className="text-chart-5" />
            {t('schema.structureTab.interfaceCompliance')}
          </button>
          <button
            type="button"
            onClick={() => refetchTree()}
            className="text-xs text-ink-3 hover:text-ink flex items-center gap-1 transition-colors"
          >
            <RefreshCw size={12} />
            {t('schema.structureTab.refresh')}
          </button>
        </div>
      </div>

      {/* No overflow-hidden here (T74 sprint 3): it clipped the "+" add menu's dropdown whenever
          it opened near the bottom/right edge of this frame, since that menu is an absolutely
          positioned child that escapes the container's normal-flow height. Children are already
          inset by the p-2 padding, so nothing relies on this to keep row backgrounds inside the
          rounded corners. */}
      <div className="bg-surface border border-edge rounded-xl p-2">
        {tree.map(node => (
          <RepoRow
            key={node.name}
            node={node}
            depth={0}
            parentRepoPath={undefined}
            localParent={undefined}
            handlers={treeHandlers}
          />
        ))}
      </div>

      {selectedObjectType && selection && (
        <ElementConfigModal
          repoLabel={selection.repoLabel}
          objectType={selectedObjectType}
          existingPrefixes={new Set([...allPrefixes].filter(p => p !== selectedObjectType.prefix))}
          isNew={selection.isNew}
          isSaving={isSaving}
          saveError={saveError}
          onSave={handleSaveElement}
          onDelete={handleDeleteElement}
          onClose={handleCloseElementModal}
        />
      )}

      {editingNode && (
        <NodeEditModal
          target={editingNode}
          onSave={handleSaveNodeLabel}
          onClose={() => setEditingNode(null)}
          resolveInterfaceRoles={resolveInterfaceRoles}
          resolveInterfacePin={resolveInterfacePin}
        />
      )}

      {pendingDependency && (
        <AddDependencyModal
          kind={pendingDependency.kind}
          parentLabel={pendingDependency.repoLabel}
          isSaving={isAddingDependency}
          error={addDependencyError}
          onSubmit={handleSubmitDependency}
          onClose={() => { setPendingDependency(null); setAddDependencyError(null) }}
        />
      )}

      {editingDependency && (
        <AddDependencyModal
          kind={editingDependency.kind}
          parentLabel={editingDependency.parentLabel}
          initialValues={editingDependency.initialValues}
          isSaving={isEditingDependency}
          error={editDependencyError}
          onSubmit={handleSubmitEditDependency}
          onClose={() => { setEditingDependency(null); setEditDependencyError(null) }}
          resolveInterfaceRoles={resolveInterfaceRoles}
          resolveInterfacePin={resolveInterfacePin}
        />
      )}

      {removingDependency && (
        <RemoveDependencyModal
          repoLabel={removingDependency.repoLabel}
          isRemoving={isRemovingDependency}
          error={removeDependencyError}
          onConfirm={handleConfirmRemoveDependency}
          onClose={() => { setRemovingDependency(null); setRemoveDependencyError(null) }}
        />
      )}
    </div>
  )
}
