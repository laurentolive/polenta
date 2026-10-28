/**
 * SystemView — main document area for the System view.
 *
 * Per SPEC-SYSTEM-VIEW this component contains only:
 *   - A compact single-line toolbar
 *   - The document view (Excel / Word / Édition)
 *
 * Navigation state (selected node/type, filter, tree root) lives in
 * SystemViewContext and is driven by SystemPanel (sidebar).
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { StepsTable } from '../StepsTable'
import { LinkedReqValues } from '../parameters/LinkedReqValues'
import type { StepDraft } from '../StepsTable'
import { Grid3x3, FileText, Settings } from 'lucide-react'
import { CampaignListView } from './CampaignListView'
import { NoTypeForCategory } from './NoTypeForCategory'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useSystemView } from '../../contexts/SystemViewContext'
import { useTabs } from '../../contexts/TabsContext'
import { treeFindNode, treeFindByObjectId, computeSectionNumbers } from '../../hooks/useTreeState'
import { useSystemObjects } from '../../hooks/useSystemObjects'
import { isSameRepo, useWorkspaceLinks, WorkspaceLinksProvider } from '../../hooks/useWorkspaceLinks'
import { ExcelView } from './ExcelView'
import { RowMaxHeightButton, ROW_MAX_LINES_ALL, readExcelRowMaxLines } from './RowMaxHeightButton'
import { WordView } from './WordView'
import { EditView, type EditViewHandle } from './EditView'
import { api } from '../../api'
import type { FieldVisibilityPref } from '@polenta/api-client'
import { RichTextProvider } from '../../contexts/RichTextContext'
import { ParamRefProvider, useParamResolver } from '../../contexts/ParamRefContext'
import { useStableCallback } from '../../hooks/useStableCallback'
import { decodeProjectId } from '../../lib/projectId'
import { RichTextToolbar } from './RichTextToolbar'
import { ViewHeader } from '../layout/ViewHeader'
import { ExportButton } from '../export/ExportButton'
import { requirementsExportBaseName, testsExportBaseName } from '../export/exportFilenames'
import { buildExportOutline, buildExportRows, substituteExportParams, defaultVisibleFields, type ExportStep } from '../../lib/exportColumns'
import { normalizeObject } from '../../lib/normalizeObject'
import type { ObjectLink, ObjectTypeDefinition, LinkTypeDefinition, Requirement, TestCase, TypeTreeNode, CoverageStatus, MatrixCell } from '@polenta/types'
import { flattenSystemNodes, isComputedColumnKey } from '@polenta/types'
import { useComputedColumns } from '../../hooks/useComputedColumns'
import { useOpenRowTarget } from '../../hooks/useOpenRowTarget'
import type { UpdateRequirementDto, UpdateTestCaseDto } from '@polenta/zod-schemas'
import { FieldConfigModal } from './FieldConfigModal'
import { isLinkColumn, normalizeLinkColumns } from './linkUtils'

const SYSTEM_FIELDS_SET = new Set(['id', 'createdAt', 'updatedAt', 'author', 'objectTypeRef', 'version', 'status'])

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = 'excel' | 'word' | 'edit'

function readStoredViewMode(repoPath: string): 'excel' | 'word' | null {
  if (!repoPath) return null
  const stored = localStorage.getItem(`polenta:viewMode:${repoPath}`)
  return stored === 'excel' || stored === 'word' ? stored : null
}

/** GH105 — délai max d'arrivée à la destination d'une navigation par lien (cf. linkNavTargetRef). */
const LINK_NAV_TIMEOUT_MS = 3000

interface BackEntry {
  /** GH105 — repo de l'objet de départ (navigation vers un objet lié d'un autre repo). */
  repoPath: string
  nodeId: string
  typeId: string
  objectId: string | null
  viewMode: ViewMode
}

// ── Helper ────────────────────────────────────────────────────────────────────

function updateNodeObjectId(nodes: TypeTreeNode[], nodeId: string, objectId: string): TypeTreeNode[] {
  return nodes.map(n => {
    if (n.id === nodeId) return { ...n, objectId }
    if (n.children.length > 0) return { ...n, children: updateNodeObjectId(n.children, nodeId, objectId) }
    return n
  })
}

function renameNodeInTree(nodes: TypeTreeNode[], nodeId: string, name: string): TypeTreeNode[] {
  return nodes.map(n => {
    if (n.id === nodeId) return { ...n, name }
    if (n.children.length > 0) return { ...n, children: renameNodeInTree(n.children, nodeId, name) }
    return n
  })
}


// ── ViewLoading — attente des données des vues Tableau / Document ───────────

/** Zone vide pendant le chargement ; le libellé n'apparaît que si l'attente se prolonge, pour
 *  ne pas faire clignoter un « Chargement… » avant un affichage quasi immédiat. */
function ViewLoading() {
  const { t } = useTranslation()
  const [showLabel, setShowLabel] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShowLabel(true), 400)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
      {showLabel ? t('common.loading') : null}
    </div>
  )
}

// ── Main SystemView ───────────────────────────────────────────────────────────

export function SystemView() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { openTab } = useTabs()
  const {
    currentProjectId,
    category,
    repoPath,
    schemaLoading,
    nodes,
    linkTypes: schemaLinkTypes,
    effectiveNode,
    effectiveType,
    effectiveTypeId,
    effectiveNodeId,
    objectTypes,
    root,
    rootKey,
    setRoot,
    canUndo,
    canRedo,
    undo,
    redo,
    readOnly,
    filter,
    filterOptions,
    handleInlineEdit,
    pendingEdits,
    clearPendingEdits,
    clearPendingEditsFor,
    isEditsDirty,
    editingNodeId,
    setEditingNodeId,
    generateId,
    navigateTo,
    navigateToRepo,
    createItemObject,
    gotoNodeId,
    gotoSeq,
    clearGoto,
  } = useSystemView()

  // GH105 — objets, liens et types de lien de tout le workspace (candidats, pastilles, écriture
  // côté source) ; les types du schéma courant servent tant que ceux du workspace ne sont pas reçus.
  const ws = useWorkspaceLinks(currentProjectId)
  const linkTypes: LinkTypeDefinition[] = ws.typesLoaded ? ws.linkTypes : schemaLinkTypes

  // T171 — résolution des paramètres pour les exports (le ParamRefProvider est monté plus bas).
  const paramResolver = useParamResolver(repoPath, currentProjectId ? decodeProjectId(currentProjectId) : '')

  // T135 — `candidateObjects` (dropdown "ajouter un lien") ne se reconstruit que si ces deux
  // requêtes sont invalidées : sans ça, un titre modifié après le chargement initial (y compris
  // le "Sans titre" posé à la création) reste figé dans la liste de candidats indéfiniment, alors
  // que le titre réel de l'objet est bien à jour partout ailleurs (ex: en rouvrant l'objet).
  const invalidateCandidateObjects = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['requirements-all', repoPath] })
    qc.invalidateQueries({ queryKey: ['tests-all', repoPath] })
    qc.invalidateQueries({ queryKey: ['links-objects'] }) // GH105 — candidats du workspace
    // GH180 — le nom d'un élément d'arbre est le titre de son objet, lu au chargement de l'arbre.
    qc.invalidateQueries({ queryKey: ['tree', repoPath] })
  }, [qc, repoPath])

  // T172 — un élément qui quitte l'approbation marque `needsRevalidation` ses éléments liés,
  // qui peuvent être d'un autre type/nœud que la vue courante : invalidation par préfixe.
  const invalidateImpactedObjects = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['objects', repoPath] })
    qc.invalidateQueries({ queryKey: ['object', repoPath] })
    qc.invalidateQueries({ queryKey: ['traceability-matrix'] })
    invalidateCandidateObjects()
  }, [qc, repoPath, invalidateCandidateObjects])

  // View mode — persisted per project in localStorage
  // GH170 — valeur initiale posée dès le premier rendu (l'effet ci-dessous ne sert plus qu'au cas
  // où `repoPath` n'est pas encore résolu au montage) : au remontage de la vue (retour sur un
  // onglet), partir de 'excel' faisait peindre un rendu intermédiaire — zone vide, ou Tableau avant
  // la Vue Édition encore ouverte (`editingNodeId` vit dans SystemViewContext, qui survit au
  // changement de route).
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    editingNodeId !== null ? 'edit' : (readStoredViewMode(repoPath) ?? 'excel'))
  const viewModeRestoredRef = useRef(!!repoPath)
  // Remembers the last non-edit view mode so we can restore it when leaving edit
  const prevViewModeRef = useRef<'excel' | 'word'>(readStoredViewMode(repoPath) ?? 'excel')
  // T92 — lets ViewHeader's "Retour" button (edit mode) trigger EditView's own
  // flush-then-navigate sequence, now that EditView no longer renders its own back button.
  const editViewRef = useRef<EditViewHandle>(null)

  useEffect(() => {
    if (!repoPath || viewModeRestoredRef.current) return
    viewModeRestoredRef.current = true
    const stored = readStoredViewMode(repoPath)
    if (stored) {
      setViewMode(stored)
      prevViewModeRef.current = stored
    }
  }, [repoPath])

  useEffect(() => {
    if (repoPath && (viewMode === 'excel' || viewMode === 'word')) {
      localStorage.setItem(`polenta:viewMode:${repoPath}`, viewMode)
      prevViewModeRef.current = viewMode
    }
  }, [viewMode, repoPath])

  // Hauteur max des lignes de la vue tableau (en lignes de texte) — préférence d'affichage
  // de l'utilisateur, persistée en localStorage, commune à tous les projets.
  const [excelRowMaxLines, setExcelRowMaxLines] = useState<number>(readExcelRowMaxLines)
  useEffect(() => {
    localStorage.setItem('polenta:excelRowMaxLines', String(excelRowMaxLines))
  }, [excelRowMaxLines])

  // When a node is set for editing (from tree double-click), switch to edit mode
  useEffect(() => {
    if (editingNodeId !== null) {
      setViewMode('edit')
      // T164 — entrer en Vue Édition efface toute cible "goto" (le clic simple qui précède
      // un double-clic en a posé une). `SystemPanel.handleGoto` ignore ensuite toute requête
      // tant que `editingNodeId !== null`, donc aucune cible ne peut réapparaître avant la
      // sortie d'Édition.
      clearGoto()
    }
  }, [editingNodeId, clearGoto])

  // ── Link navigation (T37) ─────────────────────────────────────────────────

  const [backHistory, setBackHistory] = useState<BackEntry[]>([])
  const [pendingNavObjectId, setPendingNavObjectId] = useState<string | null>(null)
  const isLinkNavigationRef = useRef(false)
  // GH105 — destination d'une navigation par lien : un changement de repo peut résoudre le nœud /
  // type en plusieurs rendus ; l'historique n'est conservé que jusqu'à l'arrivée à destination.
  // Expire après LINK_NAV_TIMEOUT_MS si la destination n'est jamais atteinte exactement (type d'une
  // autre catégorie que l'onglet, repo absent de l'arbre…) : l'historique redevient alors normal.
  const linkNavTargetRef = useRef<{ repoPath: string; nodeId: string; typeId: string; until: number } | null>(null)

  // Clear backHistory when the user navigates manually (not via a link click)
  useEffect(() => {
    const target = linkNavTargetRef.current
    if (target) {
      const arrived = isSameRepo(target.repoPath, repoPath) && target.nodeId === effectiveNodeId && target.typeId === effectiveTypeId
      if (arrived || Date.now() > target.until) {
        linkNavTargetRef.current = null
        isLinkNavigationRef.current = false
      }
      return
    }
    if (isLinkNavigationRef.current) {
      isLinkNavigationRef.current = false
      return
    }
    // GH170 — `prev` conservé s'il est déjà vide : un `[]` neuf re-rendait toute la vue (tableau
    // compris) à chaque montage, ce qui doublait le coût du retour sur un onglet.
    setBackHistory(prev => (prev.length === 0 ? prev : []))
    setPendingNavObjectId(null)
  }, [repoPath, effectiveNodeId, effectiveTypeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve pendingNavObjectId once the target tree has loaded
  useEffect(() => {
    if (!pendingNavObjectId || root.length === 0) return
    const node = treeFindByObjectId(root, pendingNavObjectId)
    if (node) {
      setEditingNodeId(node.id)
      setPendingNavObjectId(null)
      // Clear the ref here too: for same-type navigation, effectiveNodeId/TypeId
      // don't change so the other effect never fires, leaving the ref stale.
      isLinkNavigationRef.current = false
    }
  }, [root, pendingNavObjectId, setEditingNodeId])

  const sectionNumbers = useMemo(() => computeSectionNumbers(root), [root])

  // ── Object loading for Edit view ──────────────────────────────────────────

  const editingTreeNode = useMemo(
    () => (editingNodeId ? treeFindNode(root, editingNodeId) : null),
    [editingNodeId, root],
  )
  const editingObjectId = editingTreeNode?.kind === 'item' ? (editingTreeNode.objectId ?? null) : null

  const { data: loadedObject, isLoading: loadedObjectLoading } = useQuery({
    queryKey: ['object', repoPath, effectiveType?.category, editingObjectId],
    queryFn: async () => {
      if (!editingObjectId || !effectiveType?.category || !repoPath) return null
      if (effectiveType.category === 'requirement') {
        return api.requirements.get(repoPath, editingObjectId)
      }
      if (effectiveType.category === 'test') {
        return api.tests.get(repoPath, editingObjectId)
      }
      return null
    },
    enabled: !!editingObjectId && !!effectiveType?.category && !!repoPath,
    // GH170 — gardé en cache (était `gcTime: 0`) : au remontage de la vue (retour sur un onglet),
    // la fiche s'affiche aussitôt au lieu de « Chargement… ». Relue quand même à chaque montage
    // pour ne jamais rester sur une version périmée (modifiée entre-temps dans un autre onglet) ;
    // EditView adopte ce refetch sans écraser une saisie en cours (cf. son effet [objectData]).
    refetchOnMount: 'always',
  })

  const objectData = useMemo((): Record<string, string> | null => {
    if (!loadedObject) return null
    const cat = effectiveType?.category
    if (cat === 'requirement') {
      const req = loadedObject as Requirement
      return {
        id: req.id,
        title: req.title ?? '',
        status: req.status ?? '',
        needsRevalidation: req.needsRevalidation ? 'true' : '',
        createdAt: req.createdAt ?? '',
        updatedAt: req.updatedAt ?? '',
        author: req.createdBy ?? '',
        objectTypeRef: req.objectTypeRef ?? '',
        ...Object.fromEntries(
          Object.entries(req.fields ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)]),
        ),
      }
    }
    if (cat === 'test') {
      const tc = loadedObject as TestCase
      return {
        id: tc.id,
        title: tc.title ?? '',
        status: tc.status ?? '',
        needsRevalidation: tc.needsRevalidation ? 'true' : '',
        createdAt: tc.createdAt ?? '',
        updatedAt: tc.updatedAt ?? '',
        author: tc.createdBy ?? '',
        objectTypeRef: tc.objectTypeRef ?? '',
        ...Object.fromEntries(
          Object.entries(tc.fields ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)]),
        ),
      }
    }
    return null
  }, [loadedObject, effectiveType?.category])

  const [isCreating, setIsCreating] = useState(false)

  // ── Test steps state (edit view only) ────────────────────────────────────
  const [testSteps, setTestSteps] = useState<StepDraft[]>([])
  const testStepsRef = useRef<StepDraft[]>([])

  // True if the object currently in edit mode is a test case (regardless of schema cache)
  const isEditingTestCase =
    effectiveType?.category === 'test' ||
    (loadedObject != null && 'steps' in (loadedObject as unknown as Record<string, unknown>))

  useEffect(() => {
    testStepsRef.current = testSteps
  }, [testSteps])

  // Sync steps when the loaded test case changes
  useEffect(() => {
    if (loadedObject != null && 'steps' in (loadedObject as unknown as Record<string, unknown>)) {
      const tc = loadedObject as TestCase
      const sorted = (tc.steps ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(s => ({ action: s.action, expectedResult: s.expectedResult }))
      setTestSteps(sorted.length > 0 ? sorted : [{ action: '', expectedResult: '' }])
    }
  }, [loadedObject])

  // Auto-save steps with debounce
  useEffect(() => {
    if (!editingObjectId || !repoPath || !isEditingTestCase) return
    const timer = setTimeout(() => {
      api.tests.update(repoPath, editingObjectId, {
        steps: testStepsRef.current.map((s, i) => ({
          order: i + 1,
          action: s.action,
          expectedResult: s.expectedResult,
          notes: null,
        })),
      } as UpdateTestCaseDto)
    }, 800)
    return () => clearTimeout(timer)
  }, [testSteps, editingObjectId, repoPath, isEditingTestCase])

  // ── Object loading for Excel / Word views ────────────────────────────────

  const { data: rawObjects = [], isPending: objectsPending } = useSystemObjects(
    repoPath,
    effectiveType?.category,
    effectiveNodeId,
    effectiveTypeId,
  )

  const objects = useMemo(
    () => (rawObjects as (Requirement | TestCase)[]).map(o => {
      const normalized = normalizeObject(o)
      const edits = pendingEdits[normalized.id]
      if (!edits) return normalized
      return { ...normalized, ...edits }
    }),
    [rawObjects, pendingEdits]
  )

  const stepsByObjectId = useMemo((): Map<string, ExportStep[]> | undefined => {
    if (effectiveType?.category !== 'test') return undefined
    const map = new Map<string, ExportStep[]>()
    for (const obj of rawObjects as TestCase[]) {
      if (obj.id) {
        map.set(obj.id, (obj.steps ?? []).slice().sort((a, b) => a.order - b.order).map(s => ({
          order: s.order, action: s.action, expectedResult: s.expectedResult, notes: s.notes ?? '',
        })))
      }
    }
    return map
  }, [rawObjects, effectiveType?.category])

  // Payload des exports Excel/Word du cahier d'exigences ou de tests (T43) — `templated` (GH34) :
  // gabarit client choisi, on joint l'arbre complet (dossiers, étapes détaillées) que le rendu
  // Standard n'utilise pas.
  const buildDocumentExportPayload = (format: 'xlsx' | 'docx', templated: boolean) => {
    const fields = format === 'docx' ? shownFieldsWord : shownFieldsExcel
    // GH70 — une colonne calculée encore en cours de calcul s'exporterait vide.
    if (computed.pending && fields.some(isComputedColumnKey)) throw new Error(t('system.computed.exportPending'))
    const { columns, rows } = buildExportRows(fields, root, displayObjects, sectionNumbers, stepsByObjectId, effectiveType, filter, computed.exportColumns)
    // T171 §10 — mêmes valeurs de paramètres qu'à l'écran.
    const substitute = (values: Record<string, string>[]) => substituteExportParams(values, effectiveType, paramResolver.substitute)
    const payload = { componentLabel: effectiveNode?.label || effectiveNodeId || '', columns, rows: substitute(rows) }
    if (!templated) return payload
    const outline = buildExportOutline(fields, root, displayObjects, sectionNumbers, stepsByObjectId, filter, effectiveType)
    const values = substitute(outline.map(e => e.values))
    return { ...payload, outline: outline.map((e, i) => ({ ...e, values: values[i] })) }
  }

  const saveInlineEditsMutation = useMutation({
    mutationFn: async (edits: Record<string, Record<string, string>>) => {
      const cat = effectiveType?.category
      if (!cat || !repoPath) return
      await Promise.all(
        Object.entries(edits).map(([objectId, changes]) => {
          const WRITE_BLOCKED = SYSTEM_FIELDS_SET
          const customChanges = Object.fromEntries(
            Object.entries(changes).filter(([k]) => !WRITE_BLOCKED.has(k) && k !== 'title' && !isComputedColumnKey(k))
          )
          const dto = {
            ...(changes.title ? { title: changes.title } : {}),
            ...(Object.keys(customChanges).length > 0 ? { fields: customChanges } : {}),
          }
          if (cat === 'requirement') return api.requirements.update(repoPath, objectId, dto)
          if (cat === 'test') return api.tests.update(repoPath, objectId, dto as UpdateTestCaseDto)
          return Promise.resolve()
        })
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['objects', repoPath, effectiveType?.category, effectiveNodeId, effectiveTypeId] })
      invalidateCandidateObjects()
      clearPendingEdits()
    },
  })

  // ── Steps editing from Word/Excel views ──────────────────────────────────
  const stepsTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const handleWordViewStepsChange = useCallback((objectId: string, steps: StepDraft[]) => {
    const existing = stepsTimers.current.get(objectId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(async () => {
      if (!repoPath) return
      try {
        await api.tests.update(repoPath, objectId, {
          steps: steps.map((s, i) => ({ order: i + 1, action: s.action, expectedResult: s.expectedResult, notes: null })),
        } as UpdateTestCaseDto)
        qc.invalidateQueries({ queryKey: ['objects', repoPath, effectiveType?.category, effectiveNodeId, effectiveTypeId] })
      } catch (err) {
        console.error('[WordView steps] update error:', err)
      }
      stepsTimers.current.delete(objectId)
    }, 800)
    stepsTimers.current.set(objectId, timer)
  }, [repoPath, qc, effectiveType?.category, effectiveNodeId, effectiveTypeId])

  // Field config
  const [showFieldConfig, setShowFieldConfig] = useState(false)
  const [visibleFieldsExcel, setVisibleFieldsExcel] = useState<string[]>(['section', 'name', 'id', 'status'])
  const [visibleFieldsWord, setVisibleFieldsWord] = useState<string[]>(['section', 'name', 'id', 'status'])
  const [visibleFieldsEdit, setVisibleFieldsEdit] = useState<string[]>(['section', 'name', 'id', 'status'])
  // T162 — titres de dossiers affichés dans les vues Tableau / Document (par type, persisté avec les colonnes)
  const [showFoldersExcel, setShowFoldersExcel] = useState(true)
  const [showFoldersWord, setShowFoldersWord] = useState(true)
  // GH24 — dossiers repliés (Tableau / Document) et colonnes figées (Tableau), par type et
  // persistés avec les colonnes : vivaient en état local des vues, perdus à chaque démontage.
  const [collapsedFoldersExcel, setCollapsedFoldersExcel] = useState<string[]>([])
  const [collapsedFoldersWord, setCollapsedFoldersWord] = useState<string[]>([])
  const [freezeColCountExcel, setFreezeColCountExcel] = useState(0)
  // T162 — miroir synchrone de l'objet de pref complet, pour éviter qu'un enregistrement
  // n'écrase un champ voisin avec une valeur d'état périmée (closures) quand deux réglages
  // changent coup sur coup (ex. « Réinitialiser » = colonnes + titres en deux appels).

  const { data: identityLogin, isPending: identityPending } = useQuery({
    queryKey: ['project-username', repoPath],
    queryFn: () => api.auth.projectUsername(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  const username = identityLogin ?? 'local'

  // ── GH70 — colonnes calculées définies par le projet ─────────────────────────
  // Exécutées si visibles dans l'onglet Tableau ou Document (les exports suivent l'un ou l'autre).
  const workspaceDirForComputed = currentProjectId ? decodeProjectId(currentProjectId) : ''
  const computed = useComputedColumns({
    workspaceDir: workspaceDirForComputed,
    category: effectiveType?.category,
    objectTypeRef: effectiveNodeId && effectiveTypeId ? `${effectiveNodeId}::${effectiveTypeId}` : undefined,
    visibleKeys: useMemo(() => [...visibleFieldsExcel, ...visibleFieldsWord], [visibleFieldsExcel, visibleFieldsWord]),
    enabled: effectiveType?.category === 'requirement' || effectiveType?.category === 'test',
    // GH126 — panneau ⚙️ ouvert : exécuter les colonnes éclatées pour lister leurs sous-colonnes.
    discover: showFieldConfig,
  })
  const computedColumnsMap = computed.columnsMap
  // Clé d'une colonne dont la requête n'existe plus / n'est plus partagée / ne s'applique plus :
  // ignorée à l'affichage, jamais réécrite dans les préférences.
  const filterComputed = computed.filterFields
  // GH137 — colonnes de lien ramenées au schéma courant (`link::` d'un type « deux sens » → ses deux
  // colonnes de sens) : affichage et panneau « Champs visibles » ; la préférence n'est réécrite qu'à
  // la prochaine modification par l'utilisateur.
  const viewTypeRef = effectiveNodeId && effectiveTypeId ? `${effectiveNodeId}::${effectiveTypeId}` : undefined
  const excelFields = useMemo(
    () => normalizeLinkColumns(visibleFieldsExcel, linkTypes, viewTypeRef, effectiveType?.category),
    [visibleFieldsExcel, linkTypes, viewTypeRef, effectiveType?.category],
  )
  const shownFieldsExcel = useMemo(() => filterComputed(excelFields), [excelFields, filterComputed])
  const shownFieldsWord = useMemo(() => filterComputed(visibleFieldsWord), [visibleFieldsWord, filterComputed])
  const mergeComputed = computed.merge
  const displayObjects = useMemo(() => mergeComputed(objects), [mergeComputed, objects])
  const { open: openComputedTarget, message: computedOpenMessage } = useOpenRowTarget(computed.projectRepoPath, workspaceDirForComputed)

  // GH105 — liens de tous les links.yaml du workspace (un objet affiche ceux dont il est la source
  // ou la cible, quel que soit le repo qui les stocke).
  const linksPending = ws.linksPending

  const { data: allRequirements = [] } = useQuery({
    queryKey: ['requirements-all', repoPath],
    queryFn: () => api.requirements.list(repoPath, {}),
    enabled: !!repoPath,
  })

  const { data: allTests = [] } = useQuery({
    queryKey: ['tests-all', repoPath],
    queryFn: () => api.tests.list(repoPath),
    enabled: !!repoPath,
  })

  const refToCategory = useMemo(() => {
    const map = new Map<string, string>()
    for (const { node } of flattenSystemNodes(nodes)) {
      for (const ot of node.objectTypes ?? []) {
        map.set(`${node.name}::${ot.name}`, ot.category)
      }
    }
    return map
  }, [nodes])

  const candidateObjects = useMemo(() => [
    ...allRequirements.map(r => ({ id: r.id, title: r.title, objectTypeRef: r.objectTypeRef, category: refToCategory.get(r.objectTypeRef) })),
    ...(allTests as TestCase[]).map(t => ({ id: t.id, title: t.title, objectTypeRef: t.objectTypeRef, category: refToCategory.get(t.objectTypeRef) })),
  ], [allRequirements, allTests, refToCategory])

  const linksByObjectId: Map<string, ObjectLink[]> = ws.linksByObjectId

  // ── Couverture de test (T138) ────────────────────────────────────────────────
  // Champ système optionnel `coverageStatus` — désactivé par défaut dans Excel/Word (coché via le
  // panneau ⚙️), toujours affiché dans Édition (cf. specs/T138-design.md, pas d'onglet "Édition"
  // dans FieldConfigModal aujourd'hui). `enabled` évite d'appeler `traceability:matrix` (qui
  // recalcule la couverture de tout le repo) tant qu'aucune des 3 vues n'en a besoin.
  const coverageNeeded = visibleFieldsExcel.includes('coverageStatus')
    || visibleFieldsWord.includes('coverageStatus')
    || (viewMode === 'edit' && effectiveType?.category === 'requirement')

  // GH105 — couverture calculée sur les liens et tests de tout le workspace.
  const { data: matrix, isPending: matrixPending } = useQuery({
    queryKey: ['traceability-matrix', repoPath, ws.workspaceDir],
    queryFn: () => api.traceability.matrix(repoPath, {}, ws.workspaceDir),
    enabled: !!repoPath && coverageNeeded,
  })

  // GH83 — ⚠ « Impact à vérifier » des vues Excel/Word : `objects` est normalisé (chaînes des
  // champs affichables) et ne porte pas le flag T172.
  const revalidationIds = useMemo(
    () => new Set((rawObjects as (Requirement | TestCase)[]).filter(o => o.needsRevalidation).map(o => o.id)),
    [rawObjects],
  )

  const coverageByReqId = useMemo(() => {
    const map = new Map<string, { coverageStatus: CoverageStatus; cells: MatrixCell[] }>()
    for (const row of matrix?.requirements ?? []) {
      map.set(row.requirement.id, { coverageStatus: row.coverageStatus, cells: row.cells })
    }
    return map
  }, [matrix])

  const testsById = useMemo(() => {
    const map = new Map<string, TestCase>()
    // GH105 — tests des autres repos (couverture par des liens inter-repos) : titre seul.
    for (const o of ws.objects) if (o.category === 'test') map.set(o.id, { id: o.id, title: o.title } as TestCase)
    for (const tc of allTests as TestCase[]) map.set(tc.id, tc)
    return map
  }, [allTests, ws.objects])

  // ── Link navigation callbacks (T37) — after candidateObjects + editingObjectId ──

  // GH105 — l'objet lié peut vivre dans un autre repo du workspace : la Vue Système bascule alors
  // sur son repo (sélection T72), « ← Retour » revient au repo de départ.
  const navigateToObject = useCallback((peerId: string, opts?: { newTab?: boolean }) => {
    const wsTarget = ws.objectsById.get(peerId)
    const target = wsTarget ?? candidateObjects.find(c => c.id === peerId)
    if (!target) return
    const targetRepoPath = wsTarget?.repoPath ?? repoPath

    // T134 — a new tab is a fresh route mount with no access to this component's local state
    // (viewMode/pendingNavObjectId), so it can't reuse the in-place tree navigation below. The
    // standalone /req or /test detail page resolves an object from the URL alone, same as
    // SearchPanel's "open result" navigation.
    if (opts?.newTab) {
      const pathname = target.category === 'test' ? `/test/${peerId}` : `/req/${peerId}`
      openTab(pathname, { repoPath: targetRepoPath, projectId: currentProjectId })
      return
    }

    const parts = target.objectTypeRef.split('::')
    if (parts.length !== 2) return
    const [targetNodeId, targetTypeId] = parts

    setBackHistory(prev => [...prev, {
      repoPath,
      nodeId: effectiveNodeId,
      typeId: effectiveTypeId,
      objectId: editingObjectId,
      viewMode,
    }])

    beginLinkNavigation(targetRepoPath, targetNodeId, targetTypeId)
    if (viewMode !== 'word') {
      setPendingNavObjectId(peerId)
      setViewMode('edit')
    }
    if (isSameRepo(targetRepoPath, repoPath)) navigateTo(targetNodeId, targetTypeId)
    else navigateToRepo(targetRepoPath, targetNodeId, targetTypeId)
  }, [ws.objectsById, candidateObjects, effectiveNodeId, effectiveTypeId, editingObjectId, viewMode, navigateTo, navigateToRepo, openTab, repoPath, currentProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleGoBack = useCallback(() => {
    setBackHistory(prev => {
      const entry = prev[prev.length - 1]
      if (!entry) return prev
      beginLinkNavigation(entry.repoPath, entry.nodeId, entry.typeId)
      if (entry.viewMode === 'edit' && entry.objectId) {
        setPendingNavObjectId(entry.objectId)
        setViewMode('edit')
      } else {
        setViewMode(entry.viewMode)
      }
      if (isSameRepo(entry.repoPath, repoPath)) navigateTo(entry.nodeId, entry.typeId)
      else navigateToRepo(entry.repoPath, entry.nodeId, entry.typeId)
      return prev.slice(0, -1)
    })
  }, [navigateTo, navigateToRepo, repoPath, effectiveNodeId, effectiveTypeId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Marque une navigation par lien vers (repo, nœud, type) : l'historique n'est pas vidé tant que
   *  la sélection n'y est pas arrivée ; destination courante = rien à attendre. */
  function beginLinkNavigation(targetRepoPath: string, nodeId: string, typeId: string) {
    const here = isSameRepo(targetRepoPath, repoPath) && nodeId === effectiveNodeId && typeId === effectiveTypeId
    isLinkNavigationRef.current = !here
    linkNavTargetRef.current = here ? null : { repoPath: targetRepoPath, nodeId, typeId, until: Date.now() + LINK_NAV_TIMEOUT_MS }
  }

  // Unified back handler passed to EditView: link nav if history exists, else restore the view the user came from
  const handleEditBack = useCallback(() => {
    if (backHistory.length > 0) {
      handleGoBack()
    } else {
      setEditingNodeId(null)
      setViewMode(prevViewModeRef.current)
    }
  }, [backHistory, handleGoBack, setEditingNodeId])

  const typeKey = effectiveNodeId && effectiveTypeId ? `${effectiveNodeId}::${effectiveTypeId}` : null
  const { data: savedPrefs, isPlaceholderData: isPrefsPlaceholder, isPending: prefsPending } = useQuery({
    queryKey: ['pref-visibility', repoPath, username, typeKey],
    queryFn: async () => {
      if (!repoPath || !username || !typeKey) return null
      return api.pref.getFieldVisibility(repoPath, username, typeKey)
    },
    // Attendre l'identité : lancée avec le repli `local` puis relancée avec le vrai login, la
    // requête appliquait deux jeux de colonnes successifs (glitch à l'ouverture de la vue).
    enabled: !!repoPath && !!username && !!typeKey && !identityPending,
    // Garde les prefs du type précédent affichées pendant le fetch du nouveau type plutôt que
    // de repasser par `undefined` : sans ça, changer de type retombait un instant sur le
    // `fallback` (peu de colonnes) avant de recevoir les vraies prefs, d'où le "flash" de
    // colonnes en moins puis en plus.
    placeholderData: keepPreviousData,
  })

  // Prefs (et type) dont dérivent les colonnes visibles actuelles.
  // GH170 — appliquées pendant le rendu, pas dans un effet : un effet laissait committer (et
  // peindre) un premier rendu sans prefs appliquées, donc la zone vide de `viewReady`, à chaque
  // remontage de la vue — même avec les prefs en cache (retour sur un onglet).
  const [appliedPrefs, setAppliedPrefs] = useState<{ prefs: typeof savedPrefs; key: string | null } | null>(null)
  // Tant que les prefs affichées sont celles de l'ancien type (placeholder en attendant le
  // fetch du nouveau), ne pas re-dériver les colonnes visibles — sinon on écrase l'affichage
  // courant par le fallback avant que les vraies prefs du nouveau type n'arrivent.
  if (!isPrefsPlaceholder && !prefsPending && (!appliedPrefs || appliedPrefs.prefs !== savedPrefs || appliedPrefs.key !== typeKey)) {
    setAppliedPrefs({ prefs: savedPrefs, key: typeKey })
    const fallback = defaultVisibleFields(effectiveType)
    const excel = savedPrefs?.excel ?? fallback
    const word = savedPrefs?.word ?? fallback
    const edit = savedPrefs?.edit ?? fallback
    // T162 — absent d'une pref écrite avant ce ticket ⇒ titres affichés (défaut)
    const showFoldersExcelNext = savedPrefs?.showFoldersExcel ?? true
    const showFoldersWordNext = savedPrefs?.showFoldersWord ?? true
    setVisibleFieldsExcel(excel)
    setVisibleFieldsWord(word)
    setVisibleFieldsEdit(edit)
    setShowFoldersExcel(showFoldersExcelNext)
    setShowFoldersWord(showFoldersWordNext)
    const collapsedFoldersExcelNext = savedPrefs?.collapsedFoldersExcel ?? []
    const collapsedFoldersWordNext = savedPrefs?.collapsedFoldersWord ?? []
    const freezeColCountExcelNext = savedPrefs?.freezeColCountExcel ?? 0
    setCollapsedFoldersExcel(collapsedFoldersExcelNext)
    setCollapsedFoldersWord(collapsedFoldersWordNext)
    setFreezeColCountExcel(freezeColCountExcelNext)
  }

  const autoSaveMutation = useMutation({
    // GH163 — `comment` : commentaire de modification d'un changement de statut (formulaire).
    mutationFn: async ({ objectId, field, value, comment }: { objectId: string; field: string; value: string; comment?: string }) => {
      const cat = effectiveType?.category
      if (!cat || !repoPath || !objectId) return
      if (field === 'status') {
        if (cat === 'requirement') return api.requirements.transition(repoPath, objectId, { toStatus: value, comment })
        if (cat === 'test') return api.tests.update(repoPath, objectId, { status: value, modificationComment: comment } as UpdateTestCaseDto)
        return
      }
      if (SYSTEM_FIELDS_SET.has(field)) return
      const dto = field === 'title'
        ? { title: value }
        : { fields: { [field]: value } }
      if (cat === 'requirement') return api.requirements.update(repoPath, objectId, dto)
      if (cat === 'test') return api.tests.update(repoPath, objectId, dto as UpdateTestCaseDto)
    },
    onSuccess: async (_, variables) => {
      // Awaited (not fire-and-forget): `invalidateQueries` resolves once its refetch lands.
      // clearPendingEditsFor must not run before that — otherwise `objects` briefly falls
      // back to the pre-save `rawObjects` snapshot still sitting in the query cache (no
      // pendingEdits override left to mask it), and RichTextField's external-resync effect
      // sees that stale rollback as a genuine value change: it replaces the live document
      // with it, which for a richtext field just edited (e.g. a new empty list line) means
      // the just-typed trailing content visibly vanishes and the caret jumps.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['objects', repoPath, effectiveType?.category, effectiveNodeId, effectiveTypeId] }),
        qc.invalidateQueries({ queryKey: ['object', repoPath, effectiveType?.category, variables.objectId] }),
      ])
      if (variables.field === 'title') invalidateCandidateObjects()
      if (variables.field === 'status') invalidateImpactedObjects()
      clearPendingEditsFor(variables.objectId, variables.field, variables.value)
    },
    onError: (err) => {
      console.error('[EditView] Erreur sauvegarde champ:', err)
    },
  })

  // Debounced per objectId+field — mirrors handleWordViewStepsChange/stepsTimers below.
  // Saving on every keystroke (as this used to) let an older save's response land after
  // a newer keystroke; its onSuccess unconditionally cleared the optimistic pendingEdit
  // and the refetched (stale, pre-latest-keystroke) value flowed back into RichTextField,
  // whose external-resync effect then reset the live editor — wiping whatever had just
  // been typed (most visibly, a space between two words, since it's the fastest keystroke).
  const inlineEditTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const handleAutoInlineEdit = useCallback((objectId: string, field: string, value: string) => {
    handleInlineEdit(objectId, field, value)
    if (!objectId) return
    const key = `${objectId}:${field}`
    const existing = inlineEditTimers.current.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      autoSaveMutation.mutate({ objectId, field, value })
      inlineEditTimers.current.delete(key)
    }, 800)
    inlineEditTimers.current.set(key, timer)
  }, [handleInlineEdit, autoSaveMutation])

  const reopenDraftMutation = useMutation({
    mutationFn: async ({ objectId, targetStatus }: { objectId: string; targetStatus: string }) => {
      const cat = effectiveType?.category
      if (!cat || !repoPath) return
      if (cat === 'requirement') return api.requirements.openDraft(repoPath, objectId, targetStatus)
      if (cat === 'test') return api.tests.openDraft(repoPath, objectId, targetStatus)
    },
    onSuccess: (_, { objectId }) => {
      qc.invalidateQueries({ queryKey: ['objects', repoPath, effectiveType?.category, effectiveNodeId, effectiveTypeId] })
      qc.invalidateQueries({ queryKey: ['object', repoPath, effectiveType?.category, objectId] })
      invalidateImpactedObjects()
      clearPendingEditsFor(objectId, 'status')
    },
    onError: (err) => {
      console.error('[ReopenDraft] Erreur:', err)
    },
  })

  const handleReopenDraft = useCallback((objectId: string, targetStatus: string) => {
    reopenDraftMutation.mutate({ objectId, targetStatus })
  }, [reopenDraftMutation])

  const handleRenameNode = useCallback((nodeId: string, name: string) => {
    if (!repoPath || !effectiveNodeId || !effectiveTypeId) return
    const newRoot = renameNodeInTree(root, nodeId, name)
    setRoot(newRoot)
    api.tree.save(repoPath, { nodeId: effectiveNodeId, typeId: effectiveTypeId, root: newRoot })
      .then(() => qc.invalidateQueries({ queryKey: ['tree', repoPath, effectiveNodeId, effectiveTypeId] }))
      .catch(err => console.error('[RenameNode] Erreur save tree:', err))

    // T136 — le "Nom" affiché partout dans la Vue Système (arbre, colonne Label, en-tête
    // Word/Édition) EST le nom du nœud d'arbre, mais c'est le champ `title` de l'objet
    // (jamais mis à jour par ce renommage tant que ceci n'existait pas) qui alimente la
    // liste de candidats du sélecteur de lien (LinkCombobox) : sans cette synchro, le titre
    // d'un objet renommé restait figé (ex: sur "Sans titre") dans ce sélecteur pour toujours.
    const cat = effectiveType?.category
    const node = treeFindNode(root, nodeId)
    const objectId = node?.kind === 'item' ? node.objectId : undefined
    if (objectId && cat === 'requirement') {
      api.requirements.update(repoPath, objectId, { title: name })
        .then(() => invalidateCandidateObjects())
        .catch(err => console.error('[RenameNode] Erreur sync titre requirement:', err))
    } else if (objectId && cat === 'test') {
      api.tests.update(repoPath, objectId, { title: name } as UpdateTestCaseDto)
        .then(() => invalidateCandidateObjects())
        .catch(err => console.error('[RenameNode] Erreur sync titre test:', err))
    }
  }, [repoPath, effectiveNodeId, effectiveTypeId, effectiveType?.category, root, setRoot, qc, invalidateCandidateObjects])

  const handleRootChangeDnd = useCallback((newRoot: TypeTreeNode[]) => {
    if (!repoPath || !effectiveNodeId || !effectiveTypeId) return
    setRoot(newRoot)
    api.tree.save(repoPath, { nodeId: effectiveNodeId, typeId: effectiveTypeId, root: newRoot })
      .then(() => qc.invalidateQueries({ queryKey: ['tree', repoPath, effectiveNodeId, effectiveTypeId] }))
      .catch(err => console.error('[DndRow] Erreur save tree:', err))
  }, [repoPath, effectiveNodeId, effectiveTypeId, setRoot, qc])

  const handleEditBlurField = useCallback(async (field: string, value: string, comment?: string) => {
    if (field === 'name' && editingNodeId && value.trim()) {
      handleRenameNode(editingNodeId, value.trim())
      return
    }
    if (editingObjectId) {
      autoSaveMutation.mutate({ objectId: editingObjectId, field, value, comment })
    } else if (field === 'title' && value.trim() && editingNodeId && effectiveType && repoPath) {
      const objectTypeRef = `${effectiveNodeId}::${effectiveTypeId}`
      setIsCreating(true)
      try {
        let createdId: string
        if (effectiveType.category === 'requirement') {
          const req = await api.requirements.create(repoPath, { objectTypeRef, title: value.trim(), fields: {} })
          createdId = req.id
        } else if (effectiveType.category === 'test') {
          const tc = await api.tests.create(repoPath, { objectTypeRef, title: value.trim(), steps: [], fields: {} })
          createdId = tc.id
        } else {
          return
        }
        const updatedRoot = updateNodeObjectId(root, editingNodeId, createdId)
        setRoot(updatedRoot)
        await api.tree.save(repoPath, { nodeId: effectiveNodeId, typeId: effectiveTypeId, root: updatedRoot })
        qc.invalidateQueries({ queryKey: ['tree', repoPath, effectiveNodeId, effectiveTypeId] })
        qc.invalidateQueries({ queryKey: ['objects', repoPath, effectiveType.category, effectiveNodeId, effectiveTypeId] })
        invalidateCandidateObjects()
      } catch (err) {
        console.error('Erreur création objet:', err)
      } finally {
        setIsCreating(false)
      }
    }
  }, [editingObjectId, editingNodeId, effectiveType, effectiveNodeId, effectiveTypeId, repoPath, autoSaveMutation, root, setRoot, qc, handleRenameNode, invalidateCandidateObjects])

  // Appelé par EditView au moment de la navigation (onBack) — sauvegarde tous les champs modifiés en une seule requête
  // Si editingObjectId est null (nouveau nœud sans objet), crée l'objet avec les valeurs remplies
  //
  // T159 — `target` (optionnel) : cible explicitement un objet + sa baseline serveur, au lieu
  // de l'objet couramment édité. Utilisé par EditView quand il faut persister l'objet SORTANT
  // après un changement d'`editingNodeId` à EditView monté (double-clic dans l'arbre, nav vers
  // un objet lié) — à ce moment `editingObjectId`/`objectData` désignent déjà le nouvel objet.
  // Aussi utilisé par l'autosave debouncé du richtext. Une seule requête `update` par appel,
  // jamais deux writes concurrents sur le même fichier (read-modify-write non sérialisé côté
  // main). Pas de création d'objet quand `target` est fourni.
  const handleFlushEditValues = useCallback(async (
    localValues: Record<string, string>,
    target?: { objectId: string; category: string; baseline: Record<string, string> },
  ): Promise<boolean> => {
    // `|| ` not `??` — an empty-string category from EditView must still fall back.
    const cat = target?.category || effectiveType?.category
    if (!cat || !repoPath) return true
    const objectId = target?.objectId ?? editingObjectId
    if (!target && !editingNodeId) return true

    if (objectId) {
      // Objet existant — sauvegarder les champs modifiés
      const baseline = target?.baseline ?? objectData ?? {}
      const changedFields: Record<string, string> = {}
      let newTitle: string | undefined
      for (const [field, value] of Object.entries(localValues)) {
        if (field === 'section' || field === 'name') continue
        if (SYSTEM_FIELDS_SET.has(field)) continue
        if (field === 'status') continue
        const serverValue = baseline[field] ?? ''
        if (value === serverValue) continue
        if (field === 'title') { newTitle = value.trim() || undefined }
        else { changedFields[field] = value }
      }
      if (!newTitle && Object.keys(changedFields).length === 0) return true
      const dto = {
        ...(newTitle ? { title: newTitle } : {}),
        ...(Object.keys(changedFields).length > 0 ? { fields: changedFields } : {}),
      }
      // Retourne false si l'écriture a échoué → EditView ré-arme son flag `dirty` et
      // retentera (prochaine frappe / switch / démontage) au lieu de perdre l'édition.
      try {
        if (cat === 'requirement') {
          await api.requirements.update(repoPath, objectId, dto)
        } else if (cat === 'test') {
          await api.tests.update(repoPath, objectId, dto as UpdateTestCaseDto)
        } else {
          return true
        }
      } catch (err) {
        console.error('[FlushEdit] Erreur update:', err)
        return false
      }
      qc.invalidateQueries({ queryKey: ['objects', repoPath, cat, effectiveNodeId, effectiveTypeId] })
      qc.invalidateQueries({ queryKey: ['object', repoPath, cat, objectId] })
      if (newTitle) invalidateCandidateObjects()
      return true
    } else if (!target && editingNodeId) {
      // Nouvel objet — créer avec les valeurs remplies
      const title = localValues['title']?.trim() || editingTreeNode?.name?.trim() || t('system.systemView.untitled')
      const customFields: Record<string, string> = {}
      for (const [field, value] of Object.entries(localValues)) {
        if (field === 'section' || field === 'name' || SYSTEM_FIELDS_SET.has(field) || field === 'status' || field === 'title') continue
        if (value !== '') customFields[field] = value
      }
      // Ne créer que si au moins un champ est rempli (hors titre issu du nom du nœud)
      if (Object.keys(customFields).length === 0 && !localValues['title']?.trim()) return true

      const objectTypeRef = `${effectiveNodeId}::${effectiveTypeId}`
      const afterCreate = (newId: string) => {
        const updatedRoot = updateNodeObjectId(root, editingNodeId, newId)
        setRoot(updatedRoot)
        api.tree.save(repoPath, { nodeId: effectiveNodeId, typeId: effectiveTypeId, root: updatedRoot })
          .then(() => {
            qc.invalidateQueries({ queryKey: ['tree', repoPath, effectiveNodeId, effectiveTypeId] })
            qc.invalidateQueries({ queryKey: ['objects', repoPath, cat, effectiveNodeId, effectiveTypeId] })
            invalidateCandidateObjects()
          })
          .catch(err => console.error('[FlushEdit] Erreur save tree après création:', err))
      }
      if (cat === 'requirement') {
        api.requirements.create(repoPath, { objectTypeRef, title, fields: customFields })
          .then(req => afterCreate(req.id))
          .catch(err => console.error('[FlushEdit] Erreur création requirement:', err))
      } else if (cat === 'test') {
        api.tests.create(repoPath, { objectTypeRef, title, steps: [], fields: customFields })
          .then(tc => afterCreate(tc.id))
          .catch(err => console.error('[FlushEdit] Erreur création test:', err))
      }
    }
    return true
  }, [editingObjectId, editingNodeId, editingTreeNode, effectiveType, repoPath, objectData, effectiveNodeId, effectiveTypeId, qc, root, setRoot, invalidateCandidateObjects])

  const savePrefsMutation = useMutation({
    mutationFn: async (patch: Partial<FieldVisibilityPref>) => {
      if (!repoPath || !username || !typeKey) return
      await api.pref.setFieldVisibility(repoPath, username, typeKey, patch)
      return patch
    },
    // Sans ceci, la query ['pref-visibility', ...] garde en cache la valeur d'avant
    // modification (staleTime 60s) : un aller-retour de vue dans ce délai fait rejouer
    // le useEffect ci-dessus avec l'ancien savedPrefs et écrase silencieusement le choix
    // de visibilité qu'on vient pourtant d'enregistrer sur disque. GH176 — fusionné dans
    // l'entrée en cache, partagée avec le sélecteur de tests (`picker`…), sans la remplacer.
    onSuccess: (patch) => {
      if (!patch) return
      qc.setQueryData<FieldVisibilityPref | null>(['pref-visibility', repoPath, username, typeKey],
        prev => ({ ...prev, ...patch }) as FieldVisibilityPref)
    },
  })

  // T162 — un seul objet de pref porte les colonnes des 3 vues + les booléens « titres de
  // dossiers ». GH176 — chaque handler n'envoie que sa clé : le main fusionne dans l'entrée
  // (plus besoin de renvoyer l'objet complet, qui effaçait les clés écrites ailleurs).
  const persistPrefs = useCallback((override: Partial<FieldVisibilityPref>) => {
    savePrefsMutation.mutate(override)
  }, [savePrefsMutation])

  const handleChangeExcel = useCallback((fields: string[]) => {
    setVisibleFieldsExcel(fields)
    persistPrefs({ excel: fields })
  }, [persistPrefs])

  const handleChangeWord = useCallback((fields: string[]) => {
    setVisibleFieldsWord(fields)
    persistPrefs({ word: fields })
  }, [persistPrefs])

  const handleChangeEdit = useCallback((fields: string[]) => {
    setVisibleFieldsEdit(fields)
    persistPrefs({ edit: fields })
  }, [persistPrefs])

  const handleChangeShowFoldersExcel = useCallback((show: boolean) => {
    setShowFoldersExcel(show)
    persistPrefs({ showFoldersExcel: show })
  }, [persistPrefs])

  const handleChangeShowFoldersWord = useCallback((show: boolean) => {
    setShowFoldersWord(show)
    persistPrefs({ showFoldersWord: show })
  }, [persistPrefs])

  const handleCollapsedFoldersExcelChange = useCallback((ids: string[]) => {
    setCollapsedFoldersExcel(ids)
    persistPrefs({ collapsedFoldersExcel: ids })
  }, [persistPrefs])

  const handleCollapsedFoldersWordChange = useCallback((ids: string[]) => {
    setCollapsedFoldersWord(ids)
    persistPrefs({ collapsedFoldersWord: ids })
  }, [persistPrefs])

  const handleFreezeColCountExcelChange = useCallback((count: number) => {
    setFreezeColCountExcel(count)
    persistPrefs({ freezeColCountExcel: count })
  }, [persistPrefs])

  // Vues Tableau / Document affichées seulement quand tout ce qui détermine leur rendu est là :
  // colonnes visibles du type (prefs), arbre du type, objets, liens et couverture s'ils sont
  // affichés. Sans ça, la vue se peignait 3 à 4 fois à l'ouverture (colonnes par défaut et
  // cellules vides, puis données, puis vraies colonnes) — autant de glitches, et autant de
  // rendus complets du tableau qui retardaient l'affichage final.
  const shownFields = viewMode === 'word' ? visibleFieldsWord : visibleFieldsExcel
  const viewReady = appliedPrefs?.key === typeKey
    && rootKey === `${effectiveNodeId}|${effectiveTypeId}`
    && !objectsPending
    && !(linksPending && shownFields.some(isLinkColumn))
    && !(matrixPending && shownFields.includes('coverageStatus'))

  // GH170 — callbacks des vues Tableau / Document à identité stable : recréés à chaque rendu, ils
  // re-rendaient toutes les cellules (mémoïsées) à chaque re-rendu de la vue, refetch compris.
  const stableOpenComputedTarget = useStableCallback(openComputedTarget)
  const stableLinkChange = useStableCallback(ws.invalidate)
  const stableInlineEdit = useStableCallback(handleAutoInlineEdit)
  const stableRenameNode = useStableCallback(handleRenameNode)
  const stableRootChangeDnd = useStableCallback(handleRootChangeDnd)
  const stableReopenDraft = useStableCallback(handleReopenDraft)
  const stableChangeExcel = useStableCallback(handleChangeExcel)
  const stableStepsChange = useStableCallback(handleWordViewStepsChange)
  const stableEditOpen = useStableCallback((nodeId: string) => {
    setEditingNodeId(nodeId)
    setViewMode('edit')
  })
  const stableNavigateToObject = useStableCallback(navigateToObject)
  const stableCreateItemObject = useStableCallback(createItemObject)
  const stableCollapsedFoldersExcelChange = useStableCallback(handleCollapsedFoldersExcelChange)
  const stableCollapsedFoldersWordChange = useStableCallback(handleCollapsedFoldersWordChange)
  const stableFreezeColCountExcelChange = useStableCallback(handleFreezeColCountExcelChange)

  // ── Empty / loading states ────────────────────────────────────────────────

  if (schemaLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
        Chargement…
      </div>
    )
  }

  if (nodes.length === 0 || !effectiveNode) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
        {t('sidebar.system.noComponentConfiguredBody')} {t('sidebar.system.goToDataModel')}
      </div>
    )
  }

  if (objectTypes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
        {t('sidebar.system.noElementConfigured')}
      </div>
    )
  }

  if (!effectiveType) {
    return (
      <NoTypeForCategory category={category} repoPath={repoPath} projectId={currentProjectId ?? ''} className="flex-1 text-sm" />
    )
  }

  // ── Compact toolbar ───────────────────────────────────────────────────────

  const titleLabel = [
    effectiveNode.label || effectiveNodeId,
    effectiveType ? (effectiveType.label || effectiveTypeId) : '',
  ]
    .filter(Boolean)
    .join(' / ')

  return (
    <WorkspaceLinksProvider value={ws}>
    <ParamRefProvider repoPath={repoPath} workspaceDir={currentProjectId ? decodeProjectId(currentProjectId) : ''} projectId={currentProjectId ?? ''}>
    <RichTextProvider>
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={currentProjectId}
        title={
          viewMode === 'edit' && objectData?.['id'] ? (
            <>
              {titleLabel}
              <span className="ml-2 text-xs font-mono text-ink-3 font-normal">{objectData['id']}</span>
            </>
          ) : titleLabel
        }
        back={
          viewMode === 'edit'
            // T92 — flush-then-navigate, same sequence EditView's own "Retour" used to run.
            ? { label: t('layout.viewHeader.back'), onClick: () => editViewRef.current?.triggerBack() }
            : backHistory.length > 0
              ? { label: t('layout.viewHeader.back'), onClick: handleGoBack }
              : undefined
        }
        actions={
          <>
            {/* Richtext toolbar — apparaît contextuellement quand un champ richtext est actif */}
            <RichTextToolbar repoPath={repoPath} />

            {/* Undo / Redo */}
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              title={t('system.systemView.undo')}
              className="text-xs text-ink-3 hover:text-ink disabled:opacity-30 px-1"
            >
              ↩
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              title={t('system.systemView.redo')}
              className="text-xs text-ink-3 hover:text-ink disabled:opacity-30 px-1"
            >
              ↪
            </button>

            {/* Export (T43) — cahier d'exigences (sprint 1) et cahier de test (sprint 2), hors
                édition d'un élément unique. Campagnes : cf. campaign.$campaignId.tsx (sprint 2). */}
            {effectiveType?.category === 'requirement' && viewMode !== 'edit' && effectiveNodeId && effectiveTypeId && (
              <ExportButton
                kind="requirements"
                formats={['xlsx', 'docx', 'pdf']}
                repoPath={repoPath}
                getSuggestedBaseName={async () => {
                  const headSha = await api.git.headSha(repoPath)
                  return requirementsExportBaseName(effectiveNode?.label || effectiveNodeId, headSha)
                }}
                getPayload={(format, { templated }) => buildDocumentExportPayload(format, templated)}
                getPrintParams={() => ({
                  repoPath,
                  username,
                  filter,
                  objectTypeRef: `${effectiveNodeId}::${effectiveTypeId}`,
                  componentLabel: effectiveNode?.label || effectiveNodeId,
                  workspaceDir: currentProjectId ? decodeProjectId(currentProjectId) : '',
                })}
              />
            )}
            {effectiveType?.category === 'test' && viewMode !== 'edit' && effectiveNodeId && effectiveTypeId && (
              <ExportButton
                kind="tests"
                formats={['xlsx', 'docx', 'pdf']}
                repoPath={repoPath}
                getSuggestedBaseName={async () => {
                  const headSha = await api.git.headSha(repoPath)
                  return testsExportBaseName(effectiveNode?.label || effectiveNodeId, headSha)
                }}
                getPayload={(format, { templated }) => buildDocumentExportPayload(format, templated)}
                getPrintParams={() => ({
                  repoPath,
                  username,
                  filter,
                  objectTypeRef: `${effectiveNodeId}::${effectiveTypeId}`,
                  componentLabel: effectiveNode?.label || effectiveNodeId,
                  workspaceDir: currentProjectId ? decodeProjectId(currentProjectId) : '',
                })}
              />
            )}

            {/* Field config — hidden for campaign types */}
            {effectiveType?.category !== 'campaign' && (
              <button
                type="button"
                onClick={() => setShowFieldConfig(v => !v)}
                title={t('system.fieldConfig.configureColumns')}
                className="text-ink-3 hover:text-ink p-1 rounded hover:bg-hover"
              >
                <Settings size={14} />
              </button>
            )}

            {/* Hauteur max des lignes — vue tableau uniquement */}
            {effectiveType?.category !== 'campaign' && viewMode === 'excel' && (
              <RowMaxHeightButton value={excelRowMaxLines} onChange={setExcelRowMaxLines} />
            )}

            {/* View mode selector — hidden for campaign types */}
            {effectiveType?.category !== 'campaign' && (
              <div className="flex border border-edge rounded overflow-hidden">
                {(
                  [
                    { mode: 'excel' as ViewMode, icon: <Grid3x3 size={13} />, title: t('system.systemView.tableView') },
                    { mode: 'word' as ViewMode, icon: <FileText size={13} />, title: t('system.systemView.documentView') },
                  ] as const
                ).map(({ mode, icon, title }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setEditingNodeId(null)
                      setViewMode(mode)
                    }}
                    title={title}
                    className={[
                      'flex items-center justify-center w-7 h-6 transition-colors',
                      viewMode === mode
                        ? 'bg-ink text-prim-fg'
                        : 'text-ink-3 hover:text-ink hover:bg-hover',
                    ].join(' ')}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            )}
          </>
        }
      />

      {computedOpenMessage && (
        <p className="px-4 py-1 text-xs text-status-warning" data-testid="computed-open-message">{computedOpenMessage}</p>
      )}

      {/* ── Field config popover ── */}
      {showFieldConfig && (
        <FieldConfigModal
          typeDef={effectiveType}
          objectTypeRef={effectiveNodeId && effectiveTypeId ? `${effectiveNodeId}::${effectiveTypeId}` : undefined}
          linkTypes={linkTypes}
          activeTab={viewMode === 'word' ? 'word' : 'excel'}
          visibleFieldsExcel={excelFields}
          visibleFieldsWord={visibleFieldsWord}
          onChangeExcel={handleChangeExcel}
          onChangeWord={handleChangeWord}
          showFoldersExcel={showFoldersExcel}
          showFoldersWord={showFoldersWord}
          onChangeShowFoldersExcel={handleChangeShowFoldersExcel}
          onChangeShowFoldersWord={handleChangeShowFoldersWord}
          onClose={() => setShowFieldConfig(false)}
          computedColumns={computed.available}
          computedPanel={computed.panel}
        />
      )}

      {/* ── Document view ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {effectiveType?.category === 'campaign' && (
          <CampaignListView
            repoPath={repoPath}
            component={effectiveNodeId || undefined}
            level={effectiveTypeId || undefined}
          />
        )}
        {effectiveType?.category !== 'campaign' && viewMode !== 'edit' && !viewReady && <ViewLoading />}
        {effectiveType?.category !== 'campaign' && viewMode === 'excel' && viewReady && (
          <ExcelView
            key={typeKey ?? ''}
            root={root}
            typeDef={effectiveType}
            objects={displayObjects}
            visibleFields={shownFieldsExcel}
            computedColumns={computedColumnsMap}
            onOpenComputedTarget={stableOpenComputedTarget}
            foldersHidden={!showFoldersExcel}
            sectionNumbers={sectionNumbers}
            linkTypes={linkTypes}
            linksByObjectId={linksByObjectId}
            coverageByReqId={coverageByReqId}
            revalidationIds={revalidationIds}
            testsById={testsById}
            repoPath={repoPath}
            candidateObjects={candidateObjects}
            onLinkChange={stableLinkChange}
            onInlineEdit={readOnly ? undefined : stableInlineEdit}
            onRenameNode={readOnly ? undefined : stableRenameNode}
            onRootChange={readOnly ? undefined : stableRootChangeDnd}
            onColumnsReorder={stableChangeExcel}
            generateId={generateId}
            stepsByObjectId={stepsByObjectId}
            onStepsChange={readOnly ? undefined : stableStepsChange}
            onEditOpen={stableEditOpen}
            onNavigateToObject={stableNavigateToObject}
            filter={filter}
            filterOptions={filterOptions}
            onItemNodeAdded={readOnly ? undefined : stableCreateItemObject}
            gotoNodeId={gotoNodeId}
            gotoSeq={gotoSeq}
            rowMaxLines={excelRowMaxLines >= ROW_MAX_LINES_ALL ? Infinity : excelRowMaxLines}
            collapsedFolders={collapsedFoldersExcel}
            onCollapsedFoldersChange={stableCollapsedFoldersExcelChange}
            freezeColCount={freezeColCountExcel}
            onFreezeColCountChange={stableFreezeColCountExcelChange}
          />
        )}
        {effectiveType?.category !== 'campaign' && viewMode === 'word' && viewReady && (
          <WordView
            key={typeKey ?? ''}
            root={root}
            typeDef={effectiveType}
            objects={displayObjects}
            visibleFields={shownFieldsWord}
            computedColumns={computedColumnsMap}
            onOpenComputedTarget={stableOpenComputedTarget}
            foldersHidden={!showFoldersWord}
            sectionNumbers={sectionNumbers}
            linkTypes={linkTypes}
            linksByObjectId={linksByObjectId}
            coverageByReqId={coverageByReqId}
            revalidationIds={revalidationIds}
            testsById={testsById}
            repoPath={repoPath}
            candidateObjects={candidateObjects}
            onLinkChange={stableLinkChange}
            onInlineEdit={readOnly ? undefined : stableInlineEdit}
            onRenameNode={readOnly ? undefined : stableRenameNode}
            onReopenDraft={readOnly ? undefined : stableReopenDraft}
            stepsByObjectId={stepsByObjectId}
            onStepsChange={readOnly ? undefined : stableStepsChange}
            onEditOpen={stableEditOpen}
            onNavigateToObject={stableNavigateToObject}
            filter={filter}
            filterOptions={filterOptions}
            gotoNodeId={gotoNodeId}
            gotoSeq={gotoSeq}
            collapsedFolders={collapsedFoldersWord}
            onCollapsedFoldersChange={stableCollapsedFoldersWordChange}
          />
        )}
        {effectiveType?.category !== 'campaign' && viewMode === 'edit' && (
          <EditView
            ref={editViewRef}
            nodeId={editingNodeId}
            nodeName={editingTreeNode?.name}
            objectData={objectData}
            // `isLoading` (pas juste `!objectData`) : sur erreur de la query (objet
            // introuvable / entrée d'arbre orpheline) il repasse à false → EditView
            // affiche le formulaire vide au lieu de rester bloqué sur « Chargement… ».
            objectLoading={!!editingObjectId && !objectData && loadedObjectLoading}
            typeDef={effectiveType}
            visibleFields={[
              'section', 'name', 'id', 'status',
              ...(effectiveType?.fields.map(f => f.name) ?? []),
            ]}
            sectionNumbers={sectionNumbers}
            readOnly={readOnly}
            linkTypes={linkTypes}
            objectLinks={editingObjectId ? (linksByObjectId.get(editingObjectId) ?? []) : []}
            coverageByReqId={coverageByReqId}
            testsById={testsById}
            repoPath={repoPath}
            candidateObjects={candidateObjects}
            onLinkChange={ws.invalidate}
            onBlurField={handleEditBlurField}
            onFlushValues={handleFlushEditValues}
            onNavigateToObject={navigateToObject}
            onBack={handleEditBack}
          >
            {isEditingTestCase && (
              <div className="border-t border-edge pt-5">
                <p className="text-xs font-medium text-ink-2 mb-3">{t('system.wordView.stepsHeading')}</p>
                <LinkedReqValues
                  repoPath={repoPath}
                  testId={editingObjectId}
                  workspaceDir={currentProjectId ? decodeProjectId(currentProjectId) : ''}
                >
                  <StepsTable
                    steps={testSteps}
                    onChange={setTestSteps}
                    disabled={readOnly}
                    repoPath={repoPath}
                  />
                </LinkedReqValues>
              </div>
            )}
          </EditView>
        )}
      </div>
    </div>
    </RichTextProvider>
    </ParamRefProvider>
    </WorkspaceLinksProvider>
  )
}
