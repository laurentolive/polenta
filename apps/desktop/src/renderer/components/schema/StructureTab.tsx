import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Component, FileText, FolderGit2, GitFork, AlertTriangle, RefreshCw, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { useWorkspaceStructure } from '../../hooks/useWorkspaceStructure'
import {
  addDependency, addInterfaceImplementation, ensureWorkspaceInitialized, MountNameConflictError,
  updateInterfaceRoles, removeDependency, renameDependency, moveDependency,
} from '../../lib/workspaceActions'
import { DiamondConflictModal } from '../DiamondConflictModal'
import { ElementConfigModal } from './ElementConfigModal'
import { AddDependencyModal, type AddDependencyValues } from './AddDependencyModal'
import { RemoveDependencyModal } from './RemoveDependencyModal'
import { RepoBranchSelector } from './RepoBranchSelector'
import { objTypeToEditable, editableToObjType, emptyObjType, CATEGORY_LABEL, ConfirmDelete, moveUp, moveDown, type EditableObjectType } from './objectTypeEditor'
import type {
  ProjectSchema, WorkspaceTreeNode, MountOverride, ObjectTypeDefinition, ObjectCategory,
  DiamondConflict, PolentaRepoDependency, ImplementsDeclaration, SystemNode, RoleDefinition,
} from '@polenta/types'

interface Props {
  workspaceDir: string
  repoPath: string
  projectId: string
}

/** Identifies exactly which (repo, local node, object type) slot a leaf refers to, so saving writes back to the right place. */
interface Selection {
  repoPath: string
  repoLabel: string
  nodeIndex: number
  typeIndex: number
  /** True for a just-created (not yet configured) element — its scaffold is deleted if the modal is closed untouched. */
  isNew: boolean
}

/** Identifies a repo's own local ("root") SystemNode, for editing its label/description. */
interface NodeEditTarget {
  repoPath: string
  repoLabel: string
  nodeIndex: number
  label: string
  description: string
}

interface PendingDependency {
  repoPath: string
  repoLabel: string
  kind: 'component' | 'interface'
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

const CATEGORY_DOT: Record<string, string> = {
  requirement: 'text-blue-500',
  test: 'text-green-500',
  campaign: 'text-purple-500',
}

function ElementLeaf({ objectType, canMoveUp, canMoveDown, onClick, onMoveUp, onMoveDown, onDelete }: {
  objectType: ObjectTypeDefinition
  canMoveUp: boolean
  canMoveDown: boolean
  onClick: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-1 py-1 px-2 rounded hover:bg-hover transition-colors group">
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-2 flex-1 min-w-0 text-left"
      >
        <FileText size={13} className={`${CATEGORY_DOT[objectType.category] ?? 'text-ink-3'} shrink-0`} />
        <span className="text-xs text-ink-2 truncate">
          {objectType.prefix && <code className="text-ink-3 font-mono mr-1">{objectType.prefix}</code>}
          {objectType.label || objectType.name || <span className="italic text-ink-3">Sans nom</span>}
        </span>
      </button>
      <span className="text-[11px] text-ink-3 shrink-0">{CATEGORY_LABEL[objectType.category]}</span>
      <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button type="button" onClick={e => { e.stopPropagation(); onMoveUp() }} disabled={!canMoveUp}
          className="px-1 text-ink-3 hover:text-ink disabled:opacity-30" title="Monter">↑</button>
        <button type="button" onClick={e => { e.stopPropagation(); onMoveDown() }} disabled={!canMoveDown}
          className="px-1 text-ink-3 hover:text-ink disabled:opacity-30" title="Descendre">↓</button>
        <button type="button" onClick={e => { e.stopPropagation(); onClick() }}
          className="px-1 text-ink-3 hover:text-ink" title="Modifier"><Pencil size={12} /></button>
        <ConfirmDelete
          onConfirm={onDelete}
          label={<Trash2 size={12} />}
          className="px-1 text-ink-3 hover:text-red-500"
        />
      </div>
    </div>
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

function AddMenu({ node, rootNodeIndex, onAddComponent, onAddInterface, onAddElement }: {
  node: WorkspaceTreeNode
  rootNodeIndex: number
  onAddComponent: () => void
  onAddInterface: () => void
  onAddElement: (nodeIndex: number, category: ObjectCategory) => void
}) {
  const { open, setOpen, containerRef } = useDropdown()

  return (
    <div
      ref={containerRef}
      className={`relative shrink-0 transition-opacity ${open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      onClick={e => e.stopPropagation()}
    >
      <button type="button" onClick={() => setOpen(v => !v)} className="text-ink-3 hover:text-ink" title={`Ajouter à ${node.name}`}>
        <Plus size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-surface border border-edge rounded shadow-lg z-10 py-1 w-44">
          <button type="button" onClick={() => { onAddComponent(); setOpen(false) }} className={menuItemClass}>+ Composant</button>
          <button type="button" onClick={() => { onAddInterface(); setOpen(false) }} className={menuItemClass}>+ Interface</button>
          {rootNodeIndex >= 0 && (
            <>
              <div className="border-t border-edge my-1" />
              {(['requirement', 'test', 'campaign'] as ObjectCategory[]).map(cat => (
                <button key={cat} type="button" onClick={() => { onAddElement(rootNodeIndex, cat); setOpen(false) }} className={menuItemClass}>
                  + {CATEGORY_LABEL[cat]}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Scoped "+ élément" menu for a local sub-component's own row (T113) — same three categories
 *  AddMenu offers for `root`, minus "+ Composant"/"+ Interface" (a local sub-component doesn't
 *  itself host nested dependencies). */
function AddElementMenu({ onAddElement }: { onAddElement: (category: ObjectCategory) => void }) {
  const { open, setOpen, containerRef } = useDropdown()

  return (
    <div ref={containerRef} className="relative shrink-0" onClick={e => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen(v => !v)} className="text-ink-3 hover:text-ink" title="Ajouter un élément">
        <Plus size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-surface border border-edge rounded shadow-lg z-10 py-1 w-40">
          {(['requirement', 'test', 'campaign'] as ObjectCategory[]).map(cat => (
            <button key={cat} type="button" onClick={() => { onAddElement(cat); setOpen(false) }} className={menuItemClass}>
              + {CATEGORY_LABEL[cat]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function RepoRow({
  node, depth, workspaceDir, flatNodes, parentRepoPath, siblingIndex, siblingCount, schemasByRepoPath, isLoading, schemasReady,
  onSelectElement, onMoveElement, onEditNode,
  onAddComponent, onAddInterface, onAddElement, onDeleteLocalComponent, onDeleteElement,
  onEditDependency, onRemoveDependency, onMoveComponent,
}: {
  node: WorkspaceTreeNode
  depth: number
  workspaceDir: string
  flatNodes: WorkspaceTreeNode[]
  /** The repoPath of this node's direct parent in the tree — undefined only for the workspace
   *  root itself, which is never an editable/removable dependency (T74). */
  parentRepoPath: string | undefined
  /** This node's position among its parent's children — used to gate the reorder buttons.
   *  Meaningless (and unused) for the workspace root, which has no siblings. */
  siblingIndex: number
  siblingCount: number
  schemasByRepoPath: Map<string, ProjectSchema>
  isLoading: boolean
  /** True once every repo's schema in the tree has loaded — gates the "edit dependency" button,
   *  which pre-fills roles from the parent's schema and must not silently wipe them out (T74). */
  schemasReady: boolean
  onSelectElement: (sel: Selection) => void
  onMoveElement: (sel: Selection, dir: -1 | 1) => void
  onEditNode: (target: NodeEditTarget) => void
  onAddComponent: (node: WorkspaceTreeNode) => void
  onAddInterface: (node: WorkspaceTreeNode) => void
  onAddElement: (node: WorkspaceTreeNode, nodeIndex: number, category: ObjectCategory) => void
  onDeleteLocalComponent: (repoPath: string, nodeIndex: number) => void
  onDeleteElement: (sel: Selection) => void
  onEditDependency: (node: WorkspaceTreeNode, parentRepoPath: string) => void
  onRemoveDependency: (node: WorkspaceTreeNode, parentRepoPath: string) => void
  onMoveComponent: (node: WorkspaceTreeNode, parentRepoPath: string, dir: -1 | 1) => void
}) {
  const [open, setOpen] = useState(depth < 2)
  const indent = depth * 16
  const schema = schemasByRepoPath.get(node.repoPath)
  const rootNodeIndex = schema?.nodes.findIndex(n => n.name === 'root') ?? -1

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-hover transition-colors cursor-pointer select-none group"
        style={{ paddingLeft: `${8 + indent}px` }}
        onClick={() => setOpen(v => !v)}
      >
        <span className="text-ink-3">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        {node.isInterface ? (
          <GitFork size={14} className="text-violet-500 shrink-0" />
        ) : (
          <FolderGit2 size={14} className="text-ink-3 shrink-0" />
        )}
        <span className="text-sm font-medium text-ink">{node.name}</span>
        {node.isInterface && (
          <span className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 px-1.5 py-0.5 rounded font-medium">
            Interface
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
        {/* Right-aligned action cluster (T74 sprint 3) — same up/down/edit/delete ordering and
            placement as ElementLeaf's actions, instead of sitting immediately after the name/pin. */}
        <div className="ml-auto flex items-center gap-1">
          {parentRepoPath && (
            // Single hover-gated wrapper, same as ElementLeaf's action group — nesting each
            // button's own `disabled:opacity-30` inside a parent that's `opacity-0` by default
            // means the disabled look only ever shows up while the row is hovered (opacity
            // multiplies through), instead of `disabled:opacity-30` on the button itself
            // fighting the button's own `opacity-0` baseline and winning regardless of hover —
            // which is what made the boundary arrow (↑ on the first sibling, ↓ on the last)
            // stay visible outside hover.
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onMoveComponent(node, parentRepoPath, -1) }}
                disabled={siblingIndex <= 0}
                className="text-ink-3 hover:text-ink shrink-0 disabled:opacity-30 disabled:cursor-default"
                title="Monter"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onMoveComponent(node, parentRepoPath, 1) }}
                disabled={siblingIndex >= siblingCount - 1}
                className="text-ink-3 hover:text-ink shrink-0 disabled:opacity-30 disabled:cursor-default"
                title="Descendre"
              >
                ↓
              </button>
              {/* Merged edit (T74 sprint 3): label/description + branche/rôles in one modal, instead
                  of a separate "renommer ce repo" pencil next to the dependency's own edit button. */}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onEditDependency(node, parentRepoPath) }}
                disabled={!schemasReady}
                className="text-ink-3 hover:text-ink shrink-0 disabled:opacity-30 disabled:cursor-default"
                title={schemasReady ? `Modifier ${node.isInterface ? "l'interface" : 'le composant'} (label, branche, rôles)` : 'Chargement…'}
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onRemoveDependency(node, parentRepoPath) }}
                className="text-ink-3 hover:text-red-500 shrink-0"
                title="Retirer du workspace"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
          {/* Root workspace node (no parent): only its own label/description can be edited here,
              same right-aligned placement as the merged edit pencil for other repos. */}
          {rootNodeIndex >= 0 && !parentRepoPath && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                const rootNode = schema!.nodes[rootNodeIndex]
                onEditNode({ repoPath: node.repoPath, repoLabel: node.name, nodeIndex: rootNodeIndex, label: rootNode.label, description: rootNode.description ?? '' })
              }}
              className="text-ink-3 hover:text-ink shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Renommer / décrire ce repo"
            >
              <Pencil size={12} />
            </button>
          )}
          <AddMenu
            node={node}
            rootNodeIndex={rootNodeIndex}
            onAddComponent={() => onAddComponent(node)}
            onAddInterface={() => onAddInterface(node)}
            onAddElement={(nodeIndex, category) => onAddElement(node, nodeIndex, category)}
          />
        </div>
      </div>

      {open && (
        <div>
          {isLoading && !schema && (
            <p className="text-xs text-ink-3 italic" style={{ paddingLeft: `${32 + indent}px` }}>Chargement…</p>
          )}
          {schema?.nodes.map((localNode, nodeIndex) => (
            <div key={nodeIndex}>
              {localNode.name !== 'root' && (
                <div
                  className="flex items-center gap-2 py-1 group/local"
                  style={{ paddingLeft: `${32 + indent}px` }}
                >
                  {/* Même poids visuel qu'une ligne de repo (RepoRow) — un sous-composant local
                      est un composant à part entière, seule son absence de repo propre le
                      distingue (T120) ; icône dédiée, distincte de FolderGit2 (repo)/GitFork
                      (interface), sans évoquer un repo git qu'il n'a pas. */}
                  <Component size={14} className="text-ink-3 shrink-0" />
                  <span className="text-sm font-medium text-ink truncate">
                    {localNode.label || localNode.name}
                  </span>
                  <div className="ml-auto flex items-center gap-1 opacity-0 group-hover/local:opacity-100 transition-opacity">
                    <AddElementMenu onAddElement={cat => onAddElement(node, nodeIndex, cat)} />
                    <button
                      type="button"
                      onClick={() => onEditNode({
                        repoPath: node.repoPath, repoLabel: node.name, nodeIndex,
                        label: localNode.label, description: localNode.description ?? '',
                      })}
                      className="text-ink-3 hover:text-ink shrink-0"
                      title="Renommer / décrire ce composant"
                    >
                      <Pencil size={12} />
                    </button>
                    <ConfirmDelete
                      onConfirm={() => onDeleteLocalComponent(node.repoPath, nodeIndex)}
                      label={<Trash2 size={12} />}
                      className="text-ink-3 hover:text-red-500 shrink-0"
                    />
                  </div>
                </div>
              )}
              {(localNode.objectTypes ?? []).map((ot, typeIndex) => (
                <div key={typeIndex} style={{ paddingLeft: `${32 + indent}px` }}>
                  <ElementLeaf
                    objectType={ot}
                    canMoveUp={typeIndex > 0}
                    canMoveDown={typeIndex < (localNode.objectTypes?.length ?? 0) - 1}
                    onClick={() => onSelectElement({ repoPath: node.repoPath, repoLabel: node.name, nodeIndex, typeIndex, isNew: false })}
                    onMoveUp={() => onMoveElement({ repoPath: node.repoPath, repoLabel: node.name, nodeIndex, typeIndex, isNew: false }, -1)}
                    onMoveDown={() => onMoveElement({ repoPath: node.repoPath, repoLabel: node.name, nodeIndex, typeIndex, isNew: false }, 1)}
                    onDelete={() => onDeleteElement({ repoPath: node.repoPath, repoLabel: node.name, nodeIndex, typeIndex, isNew: false })}
                  />
                </div>
              ))}
            </div>
          ))}
          {schema && schema.nodes.every(n => (n.objectTypes ?? []).length === 0) && (
            <p className="text-xs text-ink-3 italic" style={{ paddingLeft: `${32 + indent}px` }}>Aucun élément configuré.</p>
          )}
          {node.children.map((child, childIndex) => (
            <RepoRow
              key={child.name}
              node={child}
              depth={depth + 1}
              workspaceDir={workspaceDir}
              flatNodes={flatNodes}
              parentRepoPath={node.repoPath}
              siblingIndex={childIndex}
              siblingCount={node.children.length}
              schemasByRepoPath={schemasByRepoPath}
              isLoading={isLoading}
              schemasReady={schemasReady}
              onSelectElement={onSelectElement}
              onMoveElement={onMoveElement}
              onEditNode={onEditNode}
              onAddComponent={onAddComponent}
              onAddInterface={onAddInterface}
              onAddElement={onAddElement}
              onDeleteLocalComponent={onDeleteLocalComponent}
              onDeleteElement={onDeleteElement}
              onEditDependency={onEditDependency}
              onRemoveDependency={onRemoveDependency}
              onMoveComponent={onMoveComponent}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NodeEditModal({ target, onSave, onClose }: {
  target: NodeEditTarget
  onSave: (label: string, description: string) => void
  onClose: () => void
}) {
  const [label, setLabel] = useState(target.label)
  const [description, setDescription] = useState(target.description)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-edge">
          <h2 className="text-sm font-semibold text-ink">Renommer {target.repoLabel}</h2>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs text-ink-2 mb-0.5">Label affiché</label>
            <input value={label} onChange={e => setLabel(e.target.value)} className="input-field w-full text-sm py-1" placeholder="Produit" />
          </div>
          <div>
            <label className="block text-xs text-ink-2 mb-0.5">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className="input-field w-full text-sm py-1" placeholder="Description optionnelle" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-edge">
          <button type="button" onClick={onClose} className="text-sm px-4 py-1.5 border border-edge rounded text-ink-2 hover:text-ink transition-colors">
            Annuler
          </button>
          <button type="button" onClick={() => onSave(label, description)} disabled={!label.trim()} className="btn-primary px-4 py-1.5 disabled:opacity-50">
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}

/** Applies `transform` to one node's objectTypes array in a schema. Shared by every Structure-tab mutation (edit/delete/reorder/append). */
function withNodeObjectTypes(
  schema: ProjectSchema, nodeIndex: number,
  transform: (types: ObjectTypeDefinition[]) => ObjectTypeDefinition[],
): ProjectSchema {
  return {
    ...schema,
    nodes: schema.nodes.map((n, i) => i !== nodeIndex ? n : { ...n, objectTypes: transform(n.objectTypes ?? []) }),
  }
}

/** Replaces one object type at typeIndex, or removes it if `mutate` returns null. */
function withObjectTypeAt(
  schema: ProjectSchema, nodeIndex: number, typeIndex: number,
  mutate: (current: ObjectTypeDefinition) => ObjectTypeDefinition | null,
): ProjectSchema {
  return withNodeObjectTypes(schema, nodeIndex, types => {
    const updated = mutate(types[typeIndex])
    return updated === null
      ? types.filter((_, j) => j !== typeIndex)
      : types.map((t, j) => j === typeIndex ? updated : t)
  })
}

/** Reorders the object types of one node in a schema. */
function withObjectTypesReordered(schema: ProjectSchema, nodeIndex: number, typeIndex: number, dir: -1 | 1): ProjectSchema {
  return withNodeObjectTypes(schema, nodeIndex, types => dir === -1 ? moveUp(types, typeIndex) : moveDown(types, typeIndex))
}

/** Appends a brand-new object type to one node in a schema; returns the new type's index. */
function withObjectTypeAppended(
  schema: ProjectSchema, nodeIndex: number, newType: ObjectTypeDefinition,
): { schema: ProjectSchema; typeIndex: number } {
  const typeIndex = (schema.nodes[nodeIndex]?.objectTypes ?? []).length
  return { schema: withNodeObjectTypes(schema, nodeIndex, types => [...types, newType]), typeIndex }
}

export function StructureTab({ workspaceDir, repoPath, projectId }: Props) {
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
    ? selectedSchema.nodes[selection.nodeIndex]?.objectTypes?.[selection.typeIndex]
    : undefined
  const selectedObjectType: EditableObjectType | null = selectedRaw ? objTypeToEditable(selectedRaw) : null

  const applyToSelection = async (mutate: (current: ObjectTypeDefinition) => ObjectTypeDefinition | null) => {
    if (!selection) return
    if (!allSchemasLoaded) {
      setSaveError('Certains repos du workspace sont encore en cours de chargement — réessayez dans un instant pour garantir la validation du préfixe.')
      return
    }
    const schema = schemasByRepoPath.get(selection.repoPath)
    if (!schema) return
    setIsSaving(true)
    setSaveError(null)
    try {
      await saveSchema(selection.repoPath, withObjectTypeAt(schema, selection.nodeIndex, selection.typeIndex, mutate))
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
      await saveSchema(sel.repoPath, withObjectTypeAt(schema, sel.nodeIndex, sel.typeIndex, () => null))
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
          await saveSchema(selection.repoPath, withObjectTypeAt(schema, selection.nodeIndex, selection.typeIndex, () => null))
        } catch {
          // best-effort cleanup — nothing more useful to do if this fails
        }
      }
    }
    setSelection(null)
    setSaveError(null)
  }

  const handleMoveElement = async (sel: Selection, dir: -1 | 1) => {
    const schema = schemasByRepoPath.get(sel.repoPath)
    if (!schema) return
    try {
      await saveSchema(sel.repoPath, withObjectTypesReordered(schema, sel.nodeIndex, sel.typeIndex, dir))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  /** Reorders a component/interface among its siblings (T74 sprint 3), mirroring handleMoveElement. */
  const handleMoveComponent = async (node: WorkspaceTreeNode, parentRepoPath: string, dir: -1 | 1) => {
    try {
      const result = await moveDependency(workspaceDir, parentRepoPath, node.name, dir)
      if (result.status === 'ok') {
        qc.setQueryData(['workspace-open', workspaceDir], result)
      } else if (result.status === 'diamond-conflict') {
        setLocalConflicts(result.conflicts)
      } else if (result.status === 'parse-error') {
        setSaveError(`Erreur de parsing dans "${result.repoName}" : ${result.error}`)
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleAddElement = async (node: WorkspaceTreeNode, nodeIndex: number, category: ObjectCategory) => {
    const schema = schemasByRepoPath.get(node.repoPath)
    if (!schema) return
    const newType = editableToObjType(emptyObjType(category))
    const { schema: nextSchema, typeIndex } = withObjectTypeAppended(schema, nodeIndex, newType)
    try {
      await saveSchema(node.repoPath, nextSchema)
      setSelection({ repoPath: node.repoPath, repoLabel: node.name, nodeIndex, typeIndex, isNew: true })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSaveNodeLabel = async (label: string, description: string) => {
    if (!editingNode) return
    const schema = schemasByRepoPath.get(editingNode.repoPath)
    if (!schema) return
    try {
      const nextSchema: ProjectSchema = {
        ...schema,
        nodes: schema.nodes.map((n, i) => i !== editingNode.nodeIndex ? n : { ...n, label: label.trim() || n.name, description: description.trim() || undefined }),
      }
      await saveSchema(editingNode.repoPath, nextSchema)
      setEditingNode(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setEditingNode(null)
    }
  }

  /** Removes a local sub-component (a SystemNode living in this repo's own schema.yaml, cf. T113) along with its elements. */
  const handleDeleteLocalComponent = async (targetRepoPath: string, nodeIndex: number) => {
    const schema = schemasByRepoPath.get(targetRepoPath)
    if (!schema) return
    try {
      await saveSchema(targetRepoPath, { ...schema, nodes: schema.nodes.filter((_, i) => i !== nodeIndex) })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  /** T113 — "Composant local" branch of handleSubmitDependency: appends a plain SystemNode to
   *  the target repo's own schema.yaml instead of registering a polenta-repo.yaml dependency.
   *  No git/workspace-tree involvement, so it's kept separate from the repo-backed path below. */
  const handleAddLocalComponent = async (targetRepoPath: string, values: AddDependencyValues) => {
    const schema = schemasByRepoPath.get(targetRepoPath)
    if (!schema) {
      // Same repo whose "+" the user just clicked, so this should be rare — but its schema
      // query can still be in flight (per-repo schema fetches run in parallel with the tree
      // fetch, cf. useWorkspaceStructure). Surface it instead of silently doing nothing.
      setAddDependencyError('Le schéma de ce repo est encore en cours de chargement — réessayez dans un instant.')
      return
    }
    const name = values.name.trim()
    if (name === 'root' || schema.nodes.some(n => n.name === name) || flatNodes.some(n => n.name === name)) {
      setAddDependencyError('Ce nom est déjà utilisé dans ce repo ou ce workspace.')
      return
    }
    setIsAddingDependency(true)
    setAddDependencyError(null)
    try {
      const newNode: SystemNode = {
        name, label: values.label.trim() || name, readonly: false, objectTypes: [],
        description: values.description.trim() || undefined,
      }
      await saveSchema(targetRepoPath, { ...schema, nodes: [...schema.nodes, newNode] })
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
      await handleAddLocalComponent(pendingDependency.repoPath, values)
      return
    }
    setIsAddingDependency(true)
    setAddDependencyError(null)
    try {
      await ensureWorkspaceInitialized(workspaceDir, repoPath)
      const dep: PolentaRepoDependency = { name: values.name, url: values.url, pin: values.branch }
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
      } else if (result.status === 'diamond-conflict') {
        setPendingDependency(null)
        setLocalConflicts(result.conflicts)
      } else if (result.status === 'parse-error') {
        setAddDependencyError(`Erreur de parsing dans "${result.repoName}" : ${result.error}`)
      } else {
        // Unreachable in practice: ensureWorkspaceInitialized() just above guarantees the
        // workspace marker exists, which is the only way rebuildTree returns 'not-a-workspace'.
        // Kept as a defensive fallback in case of external filesystem interference.
        setAddDependencyError("Ce répertoire n'est pas (ou plus) un workspace Polenta.")
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
    // Pré-rempli pour tout nœud (T110), pas seulement les interfaces — voir "problème d'œuf et
    // de poule" dans specs/T110-design.md : un repo jamais encore marqué interface doit pouvoir
    // le devenir, donc ces sections ne peuvent pas être gatées sur node.isInterface.
    const parentRoles = parentSchema?.implements?.find(impl => impl.interface === node.name)?.roles ?? []
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
        catalogRoles: childSchema?.roles ?? [], parentRoles,
        // T110 sprint 2 — pour tout nœud, pas seulement les interfaces : un composant peut aussi
        // implémenter d'autres interfaces qu'il monte lui-même.
        implementsList: childSchema?.implements ?? [],
        label: childRootNode?.label ?? '', description: childRootNode?.description ?? '',
        isLocal: false,
      },
    })
  }

  /** T110 sprint 2 — résout le nom de montage d'une interface (section "Interfaces implémentées")
   *  vers son catalogue de rôles, `null` si non montée localement. Fourni à `AddDependencyModal`
   *  plutôt que fetché par elle — elle reste un composant de présentation pure, `StructureTab` a
   *  déjà `flatNodes`/`schemasByRepoPath` en mémoire (T113 : plus qu'un mount par repo possible,
   *  donc on cherche par nom de nœud dans flatNodes, pas juste par repoPath). */
  const resolveInterfaceRoles = (mountName: string): RoleDefinition[] | null => {
    const repoPath = flatNodes.find(n => n.name === mountName.trim())?.repoPath
    return repoPath ? schemasByRepoPath.get(repoPath)?.roles ?? [] : null
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
            setEditDependencyError(`Erreur de parsing dans "${renameResult.repoName}" : ${renameResult.error}`)
          } else {
            setEditDependencyError("Ce répertoire n'est pas (ou plus) un workspace Polenta.")
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
          setEditDependencyError(`Erreur de parsing dans "${result.repoName}" : ${result.error}`)
        } else {
          setEditDependencyError("Ce répertoire n'est pas (ou plus) un workspace Polenta.")
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
        const nextChildSchema: ProjectSchema = {
          ...childSchema,
          nodes: childSchema.nodes.map((n, i) => i !== editingDependency.childNodeIndex ? n : {
            ...n, label: values.label.trim() || n.name, description: values.description.trim() || undefined,
          }),
        }
        // T110 : catalogue de rôles exposés par ce repo, saisi dans la même popup — source
        // unique désormais réutilisée par les rôles joués (StructureTab) et le champ `roles`
        // d'exigence (EditView, sprint 3). Omis (plutôt que `[]`) quand vide, comme ailleurs
        // dans ce fichier (cf. schema.tsx editableToSchema) — sinon chaque édition d'un composant
        // qui n'a jamais été une interface écrirait un `roles: []` superflu dans son schema.yaml.
        if (values.catalogRoles.length > 0) nextChildSchema.roles = values.catalogRoles
        else delete nextChildSchema.roles
        // T110 sprint 2 : interfaces que ce nœud implémente lui-même, saisies dans la même popup
        // — même convention que roles ci-dessus, omis plutôt que `[]` quand vide.
        if (values.implementsList.length > 0) nextChildSchema.implements = values.implementsList
        else delete nextChildSchema.implements
        await api.schema.save(childRepoPath, nextChildSchema)
        await qc.invalidateQueries({ queryKey: ['schema', childRepoPath] })
      }
      await qc.invalidateQueries({ queryKey: ['schema', editingDependency.parentRepoPath] })
      setEditingDependency(null)
      qc.setQueryData(['workspace-open', workspaceDir], result)
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
        setRemoveDependencyError(`Erreur de parsing dans "${result.repoName}" : ${result.error}`)
      } else {
        setRemoveDependencyError("Ce répertoire n'est pas (ou plus) un workspace Polenta.")
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
    return <div className="text-sm text-ink-3">Chargement de la structure…</div>
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
        <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/60 rounded px-3 py-2 text-sm text-red-700 dark:text-red-400 mb-3">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error ?? conflictError}</span>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-ink-3">Arbre des repos du workspace et de leurs types d'éléments.</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: '/compliance', search: { dir: workspaceDir, repoPath, projectId } })}
            className="text-xs text-ink-3 hover:text-ink flex items-center gap-1 transition-colors"
          >
            <ShieldCheck size={12} className="text-violet-500" />
            Conformité interfaces
          </button>
          <button
            type="button"
            onClick={() => refetchTree()}
            className="text-xs text-ink-3 hover:text-ink flex items-center gap-1 transition-colors"
          >
            <RefreshCw size={12} />
            Actualiser
          </button>
        </div>
      </div>

      {/* No overflow-hidden here (T74 sprint 3): it clipped the "+" add menu's dropdown whenever
          it opened near the bottom/right edge of this frame, since that menu is an absolutely
          positioned child that escapes the container's normal-flow height. Children are already
          inset by the p-2 padding, so nothing relies on this to keep row backgrounds inside the
          rounded corners. */}
      <div className="bg-surface border border-edge rounded-xl p-2">
        {tree.map((node, index) => (
          <RepoRow
            key={node.name}
            node={node}
            depth={0}
            workspaceDir={workspaceDir}
            flatNodes={flatNodes}
            parentRepoPath={undefined}
            siblingIndex={index}
            siblingCount={tree.length}
            schemasByRepoPath={schemasByRepoPath}
            isLoading={isLoading}
            schemasReady={allSchemasLoaded}
            onSelectElement={setSelection}
            onMoveElement={handleMoveElement}
            onEditNode={setEditingNode}
            onAddComponent={n => setPendingDependency({ repoPath: n.repoPath, repoLabel: n.name, kind: 'component' })}
            onAddInterface={n => setPendingDependency({ repoPath: n.repoPath, repoLabel: n.name, kind: 'interface' })}
            onAddElement={handleAddElement}
            onDeleteLocalComponent={handleDeleteLocalComponent}
            onDeleteElement={handleDeleteElementAt}
            onEditDependency={handleOpenEditDependency}
            onRemoveDependency={handleOpenRemoveDependency}
            onMoveComponent={handleMoveComponent}
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
