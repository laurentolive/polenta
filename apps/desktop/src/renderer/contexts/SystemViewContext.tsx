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
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouterState, useNavigate } from '@tanstack/react-router'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { useProjectSchema } from '../hooks/useProjectSchema'
import { useWorkspaceStructure } from '../hooks/useWorkspaceStructure'
import { normRepoPath } from '../components/system/linkUtils'
import { useTreeState, treeUpdateObjectId, treeFindNode, treeFindByObjectId, treeRemove } from '../hooks/useTreeState'
import { useVersioning } from './VersioningContext'
import { isEditableTarget } from '../lib/editableTarget'
import type { TypeTreeNode, ObjectTypeDefinition, ObjectCategory, SystemNode, LinkTypeDefinition, TestCase } from '@polenta/types'
import type { UpdateTestCaseDto } from '@polenta/zod-schemas'
import { findSystemNode, flattenSystemNodes } from '@polenta/types'
import type { FilterOptions } from '../lib/textFilter'

// ── Types ─────────────────────────────────────────────────────────────────────

/** GH228 — mode d'affichage de la vue système, porté par l'URL (`view`). */
export type SystemViewMode = 'excel' | 'word' | 'edit'

function readStoredViewMode(repoPath: string): 'excel' | 'word' | null {
  if (!repoPath) return null
  const stored = localStorage.getItem(`polenta:viewMode:${repoPath}`)
  return stored === 'excel' || stored === 'word' ? stored : null
}

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

  // GH228 — page affichée, portée par l'URL (`view`, `item`) : chaque changement voulu par
  // l'utilisateur est une entrée de l'historique Précédent / Suivant de l'onglet.
  /** Mode effectif : `edit` tant que l'élément de l'URL est en cours de résolution ; un élément
   *  introuvable une fois l'arbre chargé retombe sur `storedViewMode`. */
  viewMode: SystemViewMode
  /** Dernier mode Tableau / Document de ce repo (`localStorage`) — mode par défaut sans `view`. */
  storedViewMode: 'excel' | 'word'
  /** Nouvelle page : mode Tableau / Document, positionné (goto) sur l'objet `item` s'il est donné. */
  showView: (mode: 'excel' | 'word', item?: string | null) => void
  /** Nouvelle page : objet `item` du type `nodeId::typeId` du repo `repoPath` (lien T37, GH105 :
   *  objet d'un autre repo du workspace ; repo inconnu de l'arbre = repo courant). */
  showObject: (repoPath: string, nodeId: string, typeId: string, view: SystemViewMode, item: string, category?: ObjectCategory) => void
  /** GH105 — nom de montage du repo `repoPath` (`undefined` s'il n'est pas dans l'arbre). */
  repoNameOf: (repoPath: string) => string | undefined

  // Tree
  root: TypeTreeNode[]
  setRoot: (root: TypeTreeNode[]) => void
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  isTreeDirty: boolean
  treeLoading: boolean
  /** `<nœud>|<type>` dont l'arbre est actuellement chargé dans `root` — diffère de la sélection
   *  courante le temps de charger l'arbre d'un nouveau type (les vues attendent l'égalité avant
   *  de s'afficher, plutôt que de montrer l'arbre de l'ancien type sous le nouveau titre). */
  rootKey: string
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

  // Edit view — GH228 : dérivé de l'URL (`view=edit&item=<objectId>`). `setEditingNodeId` ouvre
  // l'Édition du nœud (nouvelle page) ; `null` revient au mode Tableau / Document mémorisé.
  editingNodeId: string | null
  setEditingNodeId: (id: string | null) => void

  // T164 — "goto" : nœud d'arbre (item ou folder) sur lequel la vue document (Word/Excel)
  // doit se positionner (scroll + contour persistant). Posé au clic simple / au drop dans
  // l'arbre ; remis à null au clic dans le vide de l'arbre, au changement de composant/type
  // et à l'entrée en Vue Édition. `gotoSeq` s'incrémente à chaque requête pour re-scroller
  // même quand la cible est identique (re-clic, re-drop du même nœud).
  gotoNodeId: string | null
  gotoSeq: number
  /** GH228 — pose aussi `item` dans l'URL de la page courante quand le nœud a un objet. */
  requestGoto: (nodeId: string) => void
  /** `dropItem` (clic dans le vide de l'arbre) retire aussi `item` de l'URL, sans nouvelle page. */
  clearGoto: (opts?: { dropItem?: boolean }) => void

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
  // GH228 — mode d'affichage et élément (édité, ou cible goto en Tableau / Document).
  const urlViewParam = sp.get('view')
  const urlView: SystemViewMode | null =
    urlViewParam === 'excel' || urlViewParam === 'word' || urlViewParam === 'edit' ? urlViewParam : null
  const urlItem = sp.get('item') || null
  // Which of the three activity-bar tabs (Exigences/Tests/Campagnes) is active — defaults to
  // 'requirement' for old links/tabs saved before that param existed rather than leaving it
  // unset, so every selection/filtering step below can assume a valid category.
  // Doc routes (/req/, /test/, /campaign/) carry no ?category= — their path names the kind
  // (GH72 — opening a campaign used to flip the sidebar header/combobox to Exigences).
  const urlCategory: ObjectCategory =
    (sp.get('category') as ObjectCategory | null) ??
    (pathname.startsWith('/campaign/') ? 'campaign' : pathname.startsWith('/test/') ? 'test' : 'requirement')

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
  // cascade). A repo with a single SystemNode contributes one entry, labeled by its display label
  // only (T178 — the mount name is no longer shown next to it; falls back to the mount name when
  // the repo has no label). A repo with
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
      const label = flat[0]?.node.label || n.label || n.name
      return [{
        repoName: n.name, repoPath: n.repoPath, nodeId: flat[0]?.node.name ?? 'root', label,
        objectTypes: flat[0]?.node.objectTypes ?? [],
      }]
    }
    const groupLabel = flatNodes.length > 1 ? (n.label || n.name) : undefined
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
  // Restricted to the active tab's category — an invalid/stale `type` param (deleted type, old
  // link) should still land on this tab's own content rather than showing a type from a different
  // category (T145). No type of this category on the node → undefined, and the views show their
  // "no type of this category" state instead of e.g. requirements under Campagnes (GH144).
  const categoryTypes = objectTypes.filter(t => t.category === urlCategory)
  const effectiveType =
    categoryTypes.find(t => t.name === selectedTypeId) ??
    categoryTypes[0]
  const effectiveTypeId = effectiveType?.name ?? ''

  // Helper: navigate to update repo/node/type in URL, preserving route-specific params
  // GH228 — `replace` (résolution automatique) précise la page courante et en garde le mode et
  // l'élément ; une nouvelle page (`replace: false`) part de `page` (rien = mode par défaut).
  const navigateWith = useCallback(
    (repoName: string, nodeId: string, typeId: string | undefined, replace = true, page?: { view?: SystemViewMode; item?: string; category?: ObjectCategory }) => {
      const keep = replace && !page
      const view = keep ? (urlView ?? undefined) : page?.view
      const item = keep ? (urlItem ?? undefined) : page?.item
      const category = page?.category ?? urlCategory
      if (pathname === '/components') {
        navigate({
          to: '/components',
          search: { projectId, repo: repoName, component: nodeId, type: typeId, level: undefined, tab: undefined, category, view, item },
          replace,
        })
      } else {
        // default to /product
        navigate({
          to: '/product',
          search: { projectId, repo: repoName, node: nodeId, type: typeId, tab: undefined, category, view, item },
          replace,
        })
      }
    },
    [navigate, pathname, projectId, urlCategory, urlView, urlItem],
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
  // GH105 — repo d'un objet lié d'un autre repo du workspace (chemins comparés sans tenir compte
  // de leur écriture, `c:\…` / `C:/…`).
  const repoNameOf = useCallback(
    (targetRepoPath: string) => componentOptions.find(o => normRepoPath(o.repoPath) === normRepoPath(targetRepoPath))?.repoName,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [componentOptions.map(o => `${o.repoName}=${o.repoPath}`).join('|')],
  )

  // GH228 — choix de l'utilisateur : nouvelle page.
  const handleTargetChange = useCallback(
    (repoName: string, nodeId: string, typeId: string) => navigateWith(repoName, nodeId, typeId, false),
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

  // ── T164 — "goto" dans la vue document ─────────────────────────────────────
  // Déclaré ici (avant l'effet [treeData] qui le réinitialise sur changement de nœud/type).
  const [gotoTarget, setGotoTarget] = useState<{ nodeId: string | null; seq: number }>({ nodeId: null, seq: 0 })

  const savedRootRef = useRef<TypeTreeNode[]>([])
  // `rootKey` distinguishes a node/type switch (→ resetRoot) from a refetch after save
  // (→ update savedRootRef only, preserve undo history).
  // GH170 — synchronisé pendant le rendu, pas dans un effet : un effet laissait passer un rendu
  // committé (et peint) avec l'arbre de l'ancien type, que SystemView affiche comme une zone vide
  // (`viewReady` attend `rootKey`). Au retour sur un onglet Tests depuis une fiche /req/…, ce type
  // change à chaque fois → page blanche le temps du rendu suivant (secondes sur un PC lent).
  const [rootKey, setRootKey] = useState('')
  const [syncedTreeData, setSyncedTreeData] = useState<typeof treeData>(undefined)
  if (treeData && treeData !== syncedTreeData) {
    setSyncedTreeData(treeData)
    const key = `${effectiveNodeId}|${effectiveTypeId}`
    savedRootRef.current = treeData.root ?? []
    if (key !== rootKey) {
      resetRoot(treeData.root ?? [])
      setRootKey(key)
      setGotoTarget({ nodeId: null, seq: 0 }) // T164 — nouveau composant/type : aucune cible goto
    }
  }

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

  // ── Page affichée : mode, élément édité, goto (GH228) ────────────────────────
  // Relu à chaque changement de `view` : l'effet ci-dessous a écrit le mode de la page précédente.
  const storedViewMode = useMemo(() => readStoredViewMode(repoPath) ?? 'excel', [repoPath, urlView])
  useEffect(() => {
    if (repoPath && (urlView === 'excel' || urlView === 'word')) localStorage.setItem(`polenta:viewMode:${repoPath}`, urlView)
  }, [repoPath, urlView])

  // Arbre chargé pour la sélection courante : un `item` absent de cet arbre est introuvable.
  const treeReady = !treeLoading && rootKey === `${effectiveNodeId}|${effectiveTypeId}`
  // Nœud en cours de création, pas encore d'objet (createItemObject) : ouvert en Édition sans
  // `item`, complété dans l'URL dès que l'objet est créé (effet ci-dessous).
  const [localEditingNodeId, setLocalEditingNodeId] = useState<string | null>(null)
  const urlEditingNodeId = useMemo(
    () => (urlView === 'edit' && urlItem ? treeFindByObjectId(root, urlItem)?.id ?? null : null),
    [root, urlView, urlItem],
  )
  const editingNodeId = urlView !== 'edit' ? null : urlItem ? urlEditingNodeId : localEditingNodeId
  const viewMode: SystemViewMode =
    urlView === 'edit'
      ? (editingNodeId !== null || (!!urlItem && !treeReady) ? 'edit' : storedViewMode)
      : urlView ?? storedViewMode

  const showView = useCallback((mode: 'excel' | 'word', item?: string | null) => {
    navigateWith(selectedRepoName, effectiveNodeId, effectiveTypeId, false, { view: mode, item: item ?? undefined })
  }, [navigateWith, selectedRepoName, effectiveNodeId, effectiveTypeId])

  // `category` : un lien peut viser un objet d'une autre catégorie (test lié depuis Exigences) —
  // l'onglet Exigences / Tests suit l'objet, sinon son type n'y serait pas affichable.
  const showObject = useCallback((targetRepoPath: string, nodeId: string, typeId: string, view: SystemViewMode, item: string, category?: ObjectCategory) => {
    navigateWith(repoNameOf(targetRepoPath) ?? selectedRepoName, nodeId, typeId, false, { view, item, category })
  }, [navigateWith, repoNameOf, selectedRepoName])

  const setEditingNodeId = useCallback((nodeId: string | null) => {
    if (nodeId === null) {
      showView(storedViewMode)
      return
    }
    const objectId = treeFindNode(rootRef.current, nodeId)?.objectId
    setLocalEditingNodeId(objectId ? null : nodeId)
    navigateWith(selectedRepoName, effectiveNodeId, effectiveTypeId, false, { view: 'edit', item: objectId })
  }, [showView, storedViewMode, navigateWith, selectedRepoName, effectiveNodeId, effectiveTypeId])

  useEffect(() => {
    if (urlView !== 'edit' || urlItem || !localEditingNodeId) return
    const objectId = treeFindNode(root, localEditingNodeId)?.objectId
    if (objectId) navigateWith(selectedRepoName, effectiveNodeId, effectiveTypeId, true, { view: 'edit', item: objectId })
  }, [root, localEditingNodeId, urlView, urlItem]) // eslint-disable-line react-hooks/exhaustive-deps

  // T164 / GH228 — goto : cible locale (re-clic = re-défilement) et `item` dans l'URL de la page
  // courante (REPLACE : un clic dans l'arbre n'est pas une nouvelle page, mais Précédent revient
  // sur l'élément ciblé). `appliedGotoRef` = dernier `(arbre, item)` appliqué depuis l'URL ; remis
  // à zéro en Édition pour que le retour en Tableau / Document re-cible.
  const appliedGotoRef = useRef('')
  const requestGoto = useCallback((nodeId: string) => {
    setGotoTarget(g => ({ nodeId, seq: g.seq + 1 }))
    const objectId = treeFindNode(rootRef.current, nodeId)?.objectId
    if (!objectId || objectId === urlItem) return
    appliedGotoRef.current = `${rootKey}|${objectId}`
    navigateWith(selectedRepoName, effectiveNodeId, effectiveTypeId, true, { view: urlView ?? undefined, item: objectId })
  }, [urlItem, urlView, rootKey, navigateWith, selectedRepoName, effectiveNodeId, effectiveTypeId])
  const clearGoto = useCallback((opts?: { dropItem?: boolean }) => {
    setGotoTarget(g => (g.nodeId === null ? g : { nodeId: null, seq: g.seq + 1 }))
    if (opts?.dropItem && urlItem && urlView !== 'edit') {
      navigateWith(selectedRepoName, effectiveNodeId, effectiveTypeId, true, { view: urlView ?? undefined })
    }
  }, [urlItem, urlView, navigateWith, selectedRepoName, effectiveNodeId, effectiveTypeId])

  useEffect(() => {
    if (urlView === 'edit' || !urlItem) {
      appliedGotoRef.current = ''
      return
    }
    if (!treeReady) return
    const key = `${rootKey}|${urlItem}`
    if (appliedGotoRef.current === key) return
    appliedGotoRef.current = key
    const node = treeFindByObjectId(root, urlItem)
    if (node) setGotoTarget(g => (g.nodeId === node.id ? g : { nodeId: node.id, seq: g.seq + 1 }))
  }, [urlView, urlItem, rootKey, root, treeReady])

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
    // T161 — nom du nœud d'arbre au moment où la création démarre. Le champ de renommage
    // ne s'ouvre que 50 ms après l'insertion du nœud (ElementTree.createItem), donc pendant
    // cet `await` l'utilisateur peut renommer un nœud qui n'a pas encore d'`objectId` — le
    // renommage ne se propage alors PAS au titre de l'objet. On rattrape après coup.
    const nodeNameAtStart = treeFindNode(rootRef.current, nodeId)?.name
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

      // T161 — le nœud a-t-il été renommé pendant la création ? Si oui, le renommage n'a
      // pas pu synchroniser le titre (l'objet n'existait pas encore) : on le fait ici.
      const nodeNameNow = treeFindNode(updatedRoot, nodeId)?.name
      if (nodeNameAtStart !== undefined && nodeNameNow && nodeNameNow !== nodeNameAtStart && !sourceObjectId) {
        try {
          if (cat === 'requirement') await api.requirements.update(repoPath, objectId, { title: nodeNameNow })
          else if (cat === 'test') await api.tests.update(repoPath, objectId, { title: nodeNameNow } as UpdateTestCaseDto)
        } catch (err) {
          console.error('[SystemView] T161 — sync titre après création:', err)
        }
      }

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
      // GH152 : contenteditable compris — dans l'éditeur richtext, Ctrl+Z/Y/S appartiennent à l'éditeur.
      if (isEditableTarget(document.activeElement)) return

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
    viewMode,
    storedViewMode,
    showView,
    showObject,
    repoNameOf,
    root,
    setRoot,
    canUndo,
    canRedo,
    undo,
    redo,
    isTreeDirty,
    treeLoading,
    rootKey,
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
    gotoNodeId: gotoTarget.nodeId,
    gotoSeq: gotoTarget.seq,
    requestGoto,
    clearGoto,
    createItemObject,
  }

  return (
    <SystemViewContext.Provider value={value}>
      {children}
    </SystemViewContext.Provider>
  )
}
