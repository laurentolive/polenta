/**
 * SystemViewContext — shared state between SystemPanel (sidebar) and SystemView (main area).
 *
 * Owns: tree data, undo/redo, filter state, selected node/type, dirty tracking.
 * Provided by AppLayout when the active panel is 'system'.
 * Consumed by SystemPanel (comboboxes + ElementTree) and SystemView (toolbar + doc views).
 *
 * URL is the source of truth for node/type selection. The provider reads URL params
 * on each render and writes to the URL when the user changes selection.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouterState, useNavigate } from '@tanstack/react-router'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { useProjectSchema } from '../hooks/useProjectSchema'
import { useWorkspaceStructure } from '../hooks/useWorkspaceStructure'
import { useTreeState, treeUpdateObjectId } from '../hooks/useTreeState'
import { useVersioning } from './VersioningContext'
import type { TypeTreeNode, ObjectTypeDefinition, ObjectCategory, SystemNode, LinkTypeDefinition, TestCase } from '@polenta/types'
import { findSystemNode, flattenSystemNodes } from '@polenta/types'
import type { FilterOptions } from '../lib/textFilter'

// ── Types ─────────────────────────────────────────────────────────────────────

/** One (repo, SystemNode) pair — intermediate building block for `componentTypeOptions` below.
 *  No longer exposed to SystemPanel directly (T129 merged Composant+Élément into one combobox);
 *  kept as an internal step because the repo/groupLabel resolution (T120) and the local-nesting
 *  path resolution (T123) are independent of the per-type fan-out T129 adds on top. */
interface ComponentOption {
  /** Mount name of the owning repo in the workspace (or the synthetic 'root' in mono-repo mode). */
  repoName: string
  repoPath: string
  /** SystemNode.name within that repo's schema.yaml — 'root' or a local sub-component name. */
  nodeId: string
  /** Display label for this single option (repo/component path, no type yet). */
  label: string
  /** Set only when the owning repo defines more than one SystemNode — renders as a section
   *  header grouping this repo's entries in the merged combobox. Absent for the common case
   *  (single SystemNode per repo) ⇒ no header, same as the pre-T120 "Composant" combobox. */
  groupLabel?: string
  /** Carried forward from the same `flattenSystemNodes` pass that resolved this node (below) —
   *  avoids a second recursive tree lookup per type fan-out (found in review). */
  objectTypes: ObjectTypeDefinition[]
}

/** One entry of the merged "Composant / Élément" combobox (T129) — a (repo, SystemNode,
 *  ObjectTypeDefinition) triple. A SystemNode with no objectTypes contributes zero entries and
 *  is therefore not reachable from this combobox (cf. specs/T129.md, décision #3) — it stays
 *  manageable from the Structure tab.
 *
 *  No string identity key: repo mount names and SystemNode names have no character restriction
 *  (cf. AddDependencyModal), so a delimited-string join is collision-prone (found in review, cf.
 *  the same lesson recorded on the pre-T129 ComponentOption index-based selection). Identity is
 *  instead the option's position in the `componentTypeOptions` array — same approach the deleted
 *  code used for `selectedComponentIndex`. */
export interface ComponentTypeOption {
  repoName: string
  nodeId: string
  typeId: string
  /** Full label: component path (repo/local-nesting, cf. ComponentOption.label) + " / " + type label. */
  label: string
  /** Same repo-grouping header as ComponentOption.groupLabel, carried through unchanged. */
  groupLabel?: string
}

// ── Last selection persistence (T52) ────────────────────────────────────────
// Remembers which repo/component/element the user last browsed in the Système
// view, per project, so it's restored on return (nav away + back, app restart)
// instead of always falling back to the root component / first element.

const LAST_SELECTION_PREFIX = 'polenta:lastSelection:'

interface LastSelection {
  repo: string
  node: string
  type: string
}

// Keyed per (project, category): the activity bar now has three tabs (Exigences/Tests/
// Campagnes) sharing the same /product route, each with its own last-browsed repo/node/type —
// without the category suffix, switching tabs would clobber the other tabs' remembered selection.
function lastSelectionKey(projectId: string, category: ObjectCategory): string {
  return `${LAST_SELECTION_PREFIX}${projectId}:${category}`
}

function readLastSelection(projectId: string, category: ObjectCategory): LastSelection | null {
  try {
    const raw = localStorage.getItem(lastSelectionKey(projectId, category))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      typeof parsed?.repo === 'string' &&
      typeof parsed?.node === 'string' &&
      typeof parsed?.type === 'string'
    ) {
      return parsed as LastSelection
    }
    return null
  } catch {
    return null
  }
}

function writeLastSelection(projectId: string, category: ObjectCategory, selection: LastSelection): void {
  try {
    localStorage.setItem(lastSelectionKey(projectId, category), JSON.stringify(selection))
  } catch {
    // localStorage unavailable (private mode, quota) — best-effort only
  }
}

/** First (node, type) pair — depth-first across `nodes` and their children — whose type matches
 *  `category`. Used to pick a sane default when the URL names no node/type yet (or an old one
 *  filtered out by the active tab), same role as the old `nodes[0].objectTypes?.[0]` default but
 *  category-aware and not limited to top-level nodes. */
function firstNodeTypeForCategory(
  nodes: SystemNode[],
  category: ObjectCategory,
): { nodeId: string; typeId: string } | null {
  for (const { node } of flattenSystemNodes(nodes)) {
    const type = node.objectTypes?.find(t => t.category === category)
    if (type) return { nodeId: node.name, typeId: type.name }
  }
  return null
}

export interface SystemViewState {
  // Project / schema
  /** T92 — passthrough of the provider's own prop, so SystemView can hand it to ViewHeader
   *  (which mounts ModificationControl) without prop-drilling it through product.tsx. */
  currentProjectId: string
  repoPath: string
  nodes: SystemNode[]
  linkTypes: LinkTypeDefinition[]
  schemaLoading: boolean
  /** Which of the three activity-bar tabs (Exigences/Tests/Campagnes) is active — drives the
   *  combobox/tree filtering above and the sidebar panel title. */
  category: ObjectCategory

  // Component + Élément selection (T72 repo + T113 local sub-component + T123 nesting, merged
  // into one filterable combobox — T120 then T129)
  componentTypeOptions: ComponentTypeOption[]
  /** Index into componentTypeOptions of the entry matching the current repo/node/type, or -1 if
   *  none match (empty workspace, or a SystemNode with no objectTypes — cf. ComponentTypeOption
   *  doc). Position-based rather than a string key: repo/node names have no character
   *  restriction, so a delimited-string identity is collision-prone (found in review). */
  selectedComponentTypeIndex: number
  handleTargetChange: (repoName: string, nodeId: string, typeId: string) => void
  isRepoReadonly: boolean

  // Selected node/type (resolved)
  selectedNodeId: string
  selectedTypeId: string
  effectiveNode: SystemNode | undefined
  effectiveNodeId: string
  objectTypes: ObjectTypeDefinition[]
  effectiveType: ObjectTypeDefinition | undefined
  effectiveTypeId: string

  // Handlers
  navigateTo: (nodeId: string, typeId: string) => void

  // Tree
  root: TypeTreeNode[]
  setRoot: (root: TypeTreeNode[]) => void
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  isTreeDirty: boolean
  treeLoading: boolean
  readOnly: boolean

  // Save
  save: () => void
  isSaving: boolean

  // Filter
  filterVisible: boolean
  setFilterVisible: (v: boolean) => void
  filter: string
  setFilter: (v: string) => void
  filterOptions: FilterOptions
  setFilterOptions: (o: FilterOptions) => void

  // ID generator (stable)
  generateId: () => string

  // Inline edits
  pendingEdits: Record<string, Record<string, string>>
  handleInlineEdit: (objectId: string, field: string, value: string) => void
  clearPendingEdits: () => void
  clearPendingEditsFor: (objectId: string, field?: string, expectedValue?: string) => void
  isEditsDirty: boolean

  // Edit view
  editingNodeId: string | null
  setEditingNodeId: (id: string | null) => void

  // Immediate object creation on item insert
  // sourceObjectId: when provided, the new object is a copy of the source (paste);
  // when absent, a blank object is created (normal insertion).
  createItemObject: (nodeId: string, sourceObjectId?: string) => Promise<void>
}

// ── Context ───────────────────────────────────────────────────────────────────

const SystemViewContext = createContext<SystemViewState | null>(null)

export function useSystemView(): SystemViewState {
  const ctx = useContext(SystemViewContext)
  if (!ctx) throw new Error('useSystemView must be used inside SystemViewProvider')
  return ctx
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface ProviderProps {
  children: ReactNode
  currentProjectId: string
}

export function SystemViewProvider({ children, currentProjectId }: ProviderProps) {
  const qc = useQueryClient()
  const navigate = useNavigate()

  // ── Router state ───────────────────────────────────────────────────────────
  const { pathname, searchStr } = useRouterState({
    select: s => ({
      pathname: s.location.pathname,
      searchStr: s.location.searchStr,
    }),
  })
  const sp = new URLSearchParams(searchStr ?? '')
  const projectId = sp.get('projectId') ?? currentProjectId
  // /product uses ?node=, /components uses ?component=
  const urlRepo = sp.get('repo') ?? null
  const urlNode = sp.get('node') ?? sp.get('component') ?? null
  const urlType = sp.get('type') ?? sp.get('level') ?? null
  // Which of the three activity-bar tabs (Exigences/Tests/Campagnes) is active — defaults to
  // 'requirement' for old links/tabs saved before that param existed rather than leaving it
  // unset, so every selection/filtering step below can assume a valid category.
  const urlCategory: ObjectCategory = (sp.get('category') as ObjectCategory | null) ?? 'requirement'

  // ── Root repo path (project root, always editable) ────────────────────────
  const { data: project } = useQuery({
    queryKey: ['workspace', currentProjectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId)),
    enabled: !!currentProjectId,
  })

  // ── Workspace repos (T72 — root + every dependency, flat) ─────────────────
  // Reuses the same primitive as the Structure tab (T70): flatNodes already
  // covers both the real workspace case and the mono-repo fallback.
  const { flatNodes, schemasByRepoPath, allSchemasLoaded } = useWorkspaceStructure(
    project?.workspaceDir ?? '',
    project?.localPath ?? '',
  )
  // Flat list of (repo, SystemNode) pairs (T120 — merges the former Composant/Sous-composant
  // cascade). A repo with a single SystemNode contributes one entry, labeled exactly as the
  // pre-T120 "Composant" combobox (mount name, disambiguated by its local node's label, e.g.
  // "Produit" — several repos can share the same default-template label, T73). A repo with
  // several SystemNode locaux (T113) contributes one entry per node. Grouped under that repo's
  // identity only when the workspace has more than one repo (flatNodes.length > 1) — a mono-repo
  // project has nothing to disambiguate from, so grouping there would only ever show the
  // internal 'root' mount placeholder as a header, with no repo-picking value (found in review).
  const componentOptions: ComponentOption[] = flatNodes.flatMap(n => {
    const repoNodes = schemasByRepoPath.get(n.repoPath)?.nodes ?? []
    // T123 — repoNodes peut désormais former un arbre (SystemNode.children), pas seulement une
    // liste plate de frères de root (T113) — on aplatit pour couvrir l'imbrication à toute
    // profondeur, en gardant la chaîne d'ancêtres pour le libellé en chemin ci-dessous.
    const flat = flattenSystemNodes(repoNodes)
    if (flat.length <= 1) {
      const localLabel = flat[0]?.node.label
      const label = localLabel && localLabel !== n.name ? `${n.name} — ${localLabel}` : n.name
      return [{
        repoName: n.name, repoPath: n.repoPath, nodeId: flat[0]?.node.name ?? 'root', label,
        objectTypes: flat[0]?.node.objectTypes ?? [],
      }]
    }
    const groupLabel = flatNodes.length > 1 ? n.name : undefined
    return flat.map(({ node, ancestors }) => {
      // root n'est jamais affiché dans le chemin — son identité est déjà portée par le repo
      // lui-même (groupLabel) — pertinent seulement si un composant a été imbriqué SOUS root
      // (ex. via le tool MCP add_component avec parentName: 'root', cf. specs/T123-design.md §9).
      const pathAncestors = ancestors.filter(a => a.name !== 'root')
      const label = pathAncestors.length > 0
        ? [...pathAncestors.map(a => a.label || a.name), node.label || node.name].join(' › ')
        : (node.label || node.name)
      return {
        repoName: n.name, repoPath: n.repoPath, nodeId: node.name, label, groupLabel,
        objectTypes: node.objectTypes ?? [],
      }
    })
  })

  // T129 — fan out each (repo, SystemNode) entry into one entry per ObjectTypeDefinition of that
  // node, merging the former Élément combobox into this one. A node with no objectTypes yields no
  // entry (specs/T129.md, décision #3) rather than a placeholder — it stays reachable/manageable
  // from the Structure tab instead. Reads `opt.objectTypes` carried forward on ComponentOption
  // rather than re-resolving the node via a second findSystemNode lookup (found in review).
  //
  // Filtered to the active tab's category (T145 — split "Système" into Exigences/Tests/
  // Campagnes) so the combobox only ever lists types relevant to the tab the user is on, instead
  // of every category merged together.
  const componentTypeOptions: ComponentTypeOption[] = componentOptions.flatMap(opt =>
    opt.objectTypes
      .filter(t => t.category === urlCategory)
      .map(t => ({
        repoName: opt.repoName,
        nodeId: opt.nodeId,
        typeId: t.name,
        label: `${opt.label} / ${t.label || t.name}`,
        groupLabel: opt.groupLabel,
      })),
  )

  const selectedRepoName = urlRepo ?? componentOptions[0]?.repoName ?? ''
  const selectedRepoOption = flatNodes.find(n => n.name === selectedRepoName) ?? flatNodes[0]
  const repoPath = selectedRepoOption?.repoPath ?? project?.localPath ?? ''

  // ── Schema (of the selected repo) ──────────────────────────────────────────
  const { data: schema, isLoading: schemaLoading } = useProjectSchema(repoPath)
  const nodes = schema?.nodes ?? []
  const linkTypes = schema?.linkTypes ?? []

  // ── Selected node/type — driven by URL ─────────────────────────────────────
  // We keep local state only as a cache; URL is authoritative.
  const selectedNodeId = urlNode ?? (nodes[0]?.name ?? '')
  const selectedTypeId = urlType ?? ''

  // Resolved effective values
  const effectiveNode = findSystemNode(nodes, selectedNodeId) ?? nodes[0]
  const effectiveNodeId = effectiveNode?.name ?? ''
  const objectTypes = effectiveNode?.objectTypes ?? []
  // Falls back to a type matching the active tab's category before an unfiltered objectTypes[0]
  // — an invalid/stale `type` param (deleted type, old link) should still land on this tab's own
  // content rather than momentarily showing a type from a different category (T145).
  const effectiveType =
    objectTypes.find(t => t.name === selectedTypeId) ??
    objectTypes.find(t => t.category === urlCategory) ??
    objectTypes[0]
  const effectiveTypeId = effectiveType?.name ?? ''

  // Helper: navigate to update repo/node/type in URL, preserving route-specific params
  const navigateWith = useCallback(
    (repoName: string, nodeId: string, typeId: string | undefined, replace = true) => {
      if (pathname === '/components') {
        navigate({
          to: '/components',
          search: { projectId, repo: repoName, component: nodeId, type: typeId, level: undefined, tab: undefined, category: urlCategory },
          replace,
        })
      } else {
        // default to /product
        navigate({
          to: '/product',
          search: { projectId, repo: repoName, node: nodeId, type: typeId, tab: undefined, category: urlCategory },
          replace,
        })
      }
    },
    [navigate, pathname, projectId, urlCategory],
  )

  // Set URL defaults when schema loads (first visit with no URL params, or an
  // old pre-T72 link that has no `repo` param at all — falls back to the root repo).
  // Guarded on componentOptions being populated too: schema (root, via its localPath
  // fallback) can resolve before useWorkspaceStructure's flatNodes do — writing
  // repo='' here would permanently pin selectedRepoName to '' afterwards, since
  // `urlRepo ?? componentOptions[0]?.repoName` only falls through to the default on a
  // nullish value, not an empty string.
  useEffect(() => {
    // T46 : cet effet ne doit s'appliquer qu'aux deux routes qu'il pilote réellement
    // (repo/node/type dans l'URL). `deducePanel` (AppLayout.tsx) range /req/$reqId,
    // /test/$testId et /campaign/new dans la même famille "système" pour le choix de
    // la sidebar, mais ces routes utilisent repoPath/component — pas repo/node/type.
    // Sans ce garde-fou, `!urlRepo` y est toujours vrai (ces routes n'ont jamais ce
    // paramètre) et l'effet redirigeait vers /product à chaque fois, empêchant toute
    // navigation directe vers une fiche depuis l'extérieur de la section Système
    // (ex: cliquer un élément impacté depuis /impact-analysis).
    if (pathname !== '/product' && pathname !== '/components') return
    if (!schema || nodes.length === 0 || componentOptions.length === 0) return

    const applyFirstNode = () => {
      // T145 — search every node (not just nodes[0]) for one exposing a type of the active
      // tab's category: the tab clicked might have nothing under the first node at all (e.g. no
      // campaign type on the root node) while still having content further down the tree.
      const found = firstNodeTypeForCategory(nodes, urlCategory)
      if (found) navigateWith(selectedRepoName, found.nodeId, found.typeId, true)
      // No node exposes this category anywhere: nothing to select — componentTypeOptions is
      // empty and the combobox/tree show their "nothing configured" state as-is.
    }

    if (!urlRepo) {
      // T52 — fully bare entry point (AppLayout's "Système" nav, app restart,
      // an old pre-T72 link with no `repo` at all): try to restore the last
      // valid selection for this project before falling back to the root
      // component / first element. A link that already names a `repo`
      // explicitly (below) keeps the pre-T52 behavior untouched — restoring
      // a *different* repo from localStorage would hijack a deliberate,
      // partially-specified deep link.
      //
      // Gated on `allSchemasLoaded`: schemasByRepoPath (T70) is populated by
      // one independent query per workspace repo, with no ordering guarantee
      // relative to the currently-selected repo's `schema`. Deciding before
      // every repo's schema has resolved could wrongly treat a saved
      // selection pointing at a still-loading repo as invalid — and since
      // this falls back to the default and sets urlRepo/urlNode, the restore
      // would never be retried, permanently overwriting the saved selection
      // once the write-effect below persists that wrong default.
      if (!allSchemasLoaded) return
      const saved = readLastSelection(projectId, urlCategory)
      const savedRepoPath = saved ? componentOptions.find(o => o.repoName === saved.repo)?.repoPath : undefined
      const savedSchema = savedRepoPath ? schemasByRepoPath.get(savedRepoPath) : undefined
      const savedNode = saved && savedSchema ? findSystemNode(savedSchema.nodes, saved.node) : undefined
      const savedType = saved ? savedNode?.objectTypes?.find(t => t.name === saved.type && t.category === urlCategory) : undefined

      if (saved && savedNode && savedType) {
        navigateWith(saved.repo, saved.node, saved.type, true)
        return
      }
      applyFirstNode()
    } else if (!urlNode) {
      applyFirstNode()
    } else if (!urlType) {
      const node = findSystemNode(nodes, urlNode)
      const firstType = node?.objectTypes?.find(t => t.category === urlCategory)?.name
      if (firstType) navigateWith(selectedRepoName, urlNode, firstType, true)
      // This node has nothing of the active tab's category — look elsewhere in the tree instead
      // of silently falling back to a type from the wrong category (T145).
      else applyFirstNode()
    }
  }, [schema, allSchemasLoaded, pathname, urlCategory]) // eslint-disable-line react-hooks/exhaustive-deps

  // T52 — persist the resolved selection (repo/node/type, not the raw URL
  // params) every time it settles on a valid value, so it can be restored on
  // the next bare visit (nav away + back, app restart). Gated on the raw URL
  // params (not just the effective/fallback values) so the transient default
  // computed on the render before the restore effect's navigation lands
  // never gets written — only a URL the app has actually settled on is
  // persisted.
  useEffect(() => {
    if (!projectId || !urlRepo || !urlNode || !urlType) return
    if (!selectedRepoName || !effectiveNodeId || !effectiveTypeId) return
    writeLastSelection(projectId, urlCategory, { repo: selectedRepoName, node: effectiveNodeId, type: effectiveTypeId })
  }, [projectId, urlCategory, urlRepo, urlNode, urlType, selectedRepoName, effectiveNodeId, effectiveTypeId])

  // Replaces the former handleComponentChange/handleTypeChange pair (T120) — the merged combobox
  // (T129) always knows the repo, the target SystemNode and the target type at once (an entry is
  // a (repo, node, type) triple), so a single handler just navigates, with no intermediate
  // "resolve the first type of this node" step to perform.
  const handleTargetChange = useCallback(
    (repoName: string, nodeId: string, typeId: string) => navigateWith(repoName, nodeId, typeId),
    [navigateWith],
  )

  // ── Tree data ──────────────────────────────────────────────────────────────
  const treeQueryKey = ['tree', repoPath, effectiveNodeId, effectiveTypeId]
  const { data: treeData, isLoading: treeLoading } = useQuery({
    queryKey: treeQueryKey,
    queryFn: () => api.tree.get(repoPath, effectiveNodeId, effectiveTypeId),
    enabled: !!repoPath && !!effectiveNodeId && !!effectiveTypeId,
  })

  const { root, setRoot, canUndo, canRedo, undo, redo, resetRoot } = useTreeState([])

  const savedRootRef = useRef<TypeTreeNode[]>([])
  // Track the previous node+type key to distinguish a node/type switch (→ resetRoot)
  // from a refetch after save (→ update savedRootRef only, preserve undo history).
  const prevNodeTypeKeyRef = useRef('')
  useEffect(() => {
    if (!treeData) return
    const key = `${effectiveNodeId}|${effectiveTypeId}`
    const isKeyChange = key !== prevNodeTypeKeyRef.current
    prevNodeTypeKeyRef.current = key
    savedRootRef.current = treeData.root ?? []
    if (isKeyChange) resetRoot(treeData.root ?? [])
  }, [treeData]) // eslint-disable-line react-hooks/exhaustive-deps

  const rootRef = useRef(root)
  useEffect(() => { rootRef.current = root }, [root])

  const isTreeDirty = JSON.stringify(root) !== JSON.stringify(savedRootRef.current)
  const { isReadonly: isBranchReadonly } = useVersioning()

  // ── Read-only for the selected repo (T72) ──────────────────────────────────
  // A dependency repo pinned to a tag/SHA (detached HEAD) is read-only here;
  // the root repo's own read-only state is already covered by isBranchReadonly.
  const isNonRootRepo = !!repoPath && repoPath !== project?.localPath
  const { data: repoSyncStatus } = useQuery({
    queryKey: ['sync:status', repoPath],
    queryFn: () => api.sync.status(repoPath),
    enabled: isNonRootRepo,
  })
  const isRepoReadonly = isNonRootRepo && (repoSyncStatus?.branch ?? '') === ''
  const readOnly = (effectiveNode?.readonly ?? false) || isBranchReadonly || isRepoReadonly

  // ── Save ───────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!effectiveNodeId || !effectiveTypeId) return Promise.resolve(undefined)
      return api.tree.save(repoPath, {
        nodeId: effectiveNodeId,
        typeId: effectiveTypeId,
        root,
      })
    },
    onSuccess: () => {
      savedRootRef.current = rootRef.current
      qc.invalidateQueries({ queryKey: treeQueryKey })
    },
  })

  const save = useCallback(() => {
    if (!readOnly) saveMutation.mutate()
  }, [readOnly, saveMutation])

  // ── Filter ─────────────────────────────────────────────────────────────────
  const [filterVisible, setFilterVisible] = useState(false)
  const [filter, setFilter] = useState('')
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  })

  // ── ID generator ───────────────────────────────────────────────────────────
  const idCounterRef = useRef(0)
  const generateId = useCallback((): string => {
    return `${Date.now()}-${idCounterRef.current++}-${Math.random().toString(36).slice(2, 8)}`
  }, [])

  // ── Inline edits ───────────────────────────────────────────────────────────
  const [pendingEdits, setPendingEdits] = useState<Record<string, Record<string, string>>>({})
  const isEditsDirty = Object.keys(pendingEdits).length > 0

  // ── Edit view ──────────────────────────────────────────────────────────────
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)

  const handleInlineEdit = useCallback((objectId: string, field: string, value: string) => {
    setPendingEdits(prev => ({
      ...prev,
      [objectId]: { ...(prev[objectId] ?? {}), [field]: value },
    }))
  }, [])

  const clearPendingEdits = useCallback(() => setPendingEdits({}), [])

  // expectedValue: when provided, only clears if the pending edit still equals the value
  // that was just saved. A newer keystroke may have updated pendingEdits after this save
  // was fired (autosave requests overlap with typing) — clearing unconditionally would drop
  // that newer edit and let the (now stale) server value flow back into the field, wiping
  // whatever the user typed since. Left in place, its own autosave will save it in turn.
  const clearPendingEditsFor = useCallback((objectId: string, field?: string, expectedValue?: string) => {
    setPendingEdits(prev => {
      if (!(objectId in prev)) return prev
      if (!field) {
        const { [objectId]: _removed, ...rest } = prev
        return rest
      }
      if (expectedValue !== undefined && prev[objectId][field] !== expectedValue) return prev
      const { [field]: _removedField, ...remainingFields } = prev[objectId]
      if (Object.keys(remainingFields).length === 0) {
        const { [objectId]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [objectId]: remainingFields }
    })
  }, [])

  // ── Immediate object creation when a new item node is inserted ─────────────
  // When sourceObjectId is provided (paste), the new object is created as a copy
  // of the source object's content (title + fields + steps for tests).
  // When absent (normal insertion), a blank object is created.
  const createItemObject = useCallback(async (nodeId: string, sourceObjectId?: string) => {
    const cat = effectiveType?.category
    if (!cat || !repoPath || !effectiveNodeId || !effectiveTypeId) return
    const objectTypeRef = `${effectiveNodeId}::${effectiveTypeId}`
    try {
      let objectId: string
      if (cat === 'requirement') {
        let title = 'Sans titre'
        let fields: Record<string, unknown> = {}
        if (sourceObjectId) {
          try {
            const src = await api.requirements.get(repoPath, sourceObjectId)
            title = src.title
            fields = src.fields ?? {}
          } catch {
            // source not found — fall back to blank
          }
        }
        const req = await api.requirements.create(repoPath, { objectTypeRef, title, fields })
        objectId = req.id
      } else if (cat === 'test') {
        let title = 'Sans titre'
        let fields: Record<string, unknown> = {}
        let steps: TestCase['steps'] = []
        if (sourceObjectId) {
          try {
            const src = await api.tests.get(repoPath, sourceObjectId)
            title = src.title
            fields = src.fields ?? {}
            steps = src.steps ?? []
          } catch {
            // source not found — fall back to blank
          }
        }
        const tc = await api.tests.create(repoPath, { objectTypeRef, title, steps, fields })
        objectId = tc.id
      } else return
      const updatedRoot = treeUpdateObjectId(rootRef.current, nodeId, objectId)
      setRoot(updatedRoot)
      await api.tree.save(repoPath, { nodeId: effectiveNodeId, typeId: effectiveTypeId, root: updatedRoot })
      qc.invalidateQueries({ queryKey: ['tree', repoPath, effectiveNodeId, effectiveTypeId] })
      qc.invalidateQueries({ queryKey: ['objects', repoPath, cat, effectiveNodeId, effectiveTypeId] })
      // T135 — sans ça, le nouvel objet reste absent (ou son titre reste figé à "Sans titre")
      // dans la liste de candidats du sélecteur de lien tant que ces requêtes ne se rechargent
      // pas d'elles-mêmes (remount, refocus fenêtre) — voir SystemView.tsx invalidateCandidateObjects.
      qc.invalidateQueries({ queryKey: ['requirements-all', repoPath] })
      qc.invalidateQueries({ queryKey: ['tests-all', repoPath] })
    } catch (err) {
      console.error('[SystemView] Erreur création objet immédiate:', err)
    }
  }, [effectiveType, repoPath, effectiveNodeId, effectiveTypeId, setRoot, qc])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const focused = document.activeElement
      const isInInput =
        focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')
      if (isInInput) return

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || (e.key === 'z' && e.shiftKey))
      ) {
        e.preventDefault()
        redo()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (isTreeDirty && !readOnly) save()
      } else if (e.key === 'Escape' && filterVisible) {
        setFilter('')
        setFilterVisible(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, isTreeDirty, save, filterVisible, readOnly])

  const value: SystemViewState = {
    currentProjectId,
    repoPath,
    nodes,
    linkTypes,
    schemaLoading,
    category: urlCategory,
    componentTypeOptions,
    selectedComponentTypeIndex: componentTypeOptions.findIndex(
      o => o.repoName === selectedRepoName && o.nodeId === effectiveNodeId && o.typeId === effectiveTypeId,
    ),
    handleTargetChange,
    isRepoReadonly,
    selectedNodeId,
    selectedTypeId,
    effectiveNode,
    effectiveNodeId,
    objectTypes,
    effectiveType,
    effectiveTypeId,
    navigateTo: (nodeId: string, typeId: string) => navigateWith(selectedRepoName, nodeId, typeId),
    root,
    setRoot,
    canUndo,
    canRedo,
    undo,
    redo,
    isTreeDirty,
    treeLoading,
    readOnly,
    save,
    isSaving: saveMutation.isPending,
    filterVisible,
    setFilterVisible,
    filter,
    setFilter,
    filterOptions,
    setFilterOptions,
    generateId,
    pendingEdits,
    handleInlineEdit,
    clearPendingEdits,
    clearPendingEditsFor,
    isEditsDirty,
    editingNodeId,
    setEditingNodeId,
    createItemObject,
  }

  return (
    <SystemViewContext.Provider value={value}>
      {children}
    </SystemViewContext.Provider>
  )
}
