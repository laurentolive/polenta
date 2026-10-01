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
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useSystemView } from '../../contexts/SystemViewContext'
import { useTabs } from '../../contexts/TabsContext'
import { treeFindNode, treeFindByObjectId, computeSectionNumbers } from '../../hooks/useTreeState'
import { useSystemObjects } from '../../hooks/useSystemObjects'
import { ExcelView } from './ExcelView'
import { RowMaxHeightButton, ROW_MAX_LINES_MIN, ROW_MAX_LINES_ALL, ROW_MAX_LINES_DEFAULT } from './RowMaxHeightButton'
import { WordView } from './WordView'
import { EditView, type EditViewHandle } from './EditView'
import { api } from '../../api'
import type { FieldVisibilityPref } from '@polenta/api-client'
import { RichTextProvider } from '../../contexts/RichTextContext'
import { ParamRefProvider, useParamResolver } from '../../contexts/ParamRefContext'
import { decodeProjectId } from '../../lib/projectId'
import { RichTextToolbar } from './RichTextToolbar'
import { ViewHeader } from '../layout/ViewHeader'
import { ExportButton } from '../export/ExportButton'
import { requirementsExportBaseName, testsExportBaseName } from '../export/exportFilenames'
import { buildExportOutline, buildExportRows, substituteExportParams, type ExportStep } from '../../lib/exportColumns'
import { normalizeObject } from '../../lib/normalizeObject'
import type { ObjectLink, ObjectTypeDefinition, LinkTypeDefinition, Requirement, TestCase, TypeTreeNode, CoverageStatus, MatrixCell } from '@polenta/types'
import { flattenSystemNodes } from '@polenta/types'
import type { UpdateRequirementDto, UpdateTestCaseDto } from '@polenta/zod-schemas'
import { getRelevantLinkTypes, getLinkTypeLabel, isLinkTypeValid } from './linkUtils'

const SYSTEM_FIELDS_SET = new Set(['id', 'createdAt', 'updatedAt', 'author', 'objectTypeRef', 'version', 'status'])

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = 'excel' | 'word' | 'edit'

interface BackEntry {
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


// ── FieldConfig modal (⚙) — 3 onglets indépendants ──────────────────────────

type ConfigTab = 'excel' | 'word'

function FieldConfigModal({
  typeDef,
  objectTypeRef,
  linkTypes,
  activeTab,
  visibleFieldsExcel,
  visibleFieldsWord,
  onChangeExcel,
  onChangeWord,
  showFoldersExcel,
  showFoldersWord,
  onChangeShowFoldersExcel,
  onChangeShowFoldersWord,
  onClose,
}: {
  typeDef: ObjectTypeDefinition | undefined
  objectTypeRef?: string
  linkTypes: LinkTypeDefinition[]
  activeTab: ConfigTab
  visibleFieldsExcel: string[]
  visibleFieldsWord: string[]
  onChangeExcel: (fields: string[]) => void
  onChangeWord: (fields: string[]) => void
  showFoldersExcel: boolean
  showFoldersWord: boolean
  onChangeShowFoldersExcel: (v: boolean) => void
  onChangeShowFoldersWord: (v: boolean) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ConfigTab>(activeTab)

  const systemFieldLabels: Record<string, string> = {
    section: t('system.fieldConfig.colSection'), name: t('schema.editor.colLabel'), id: t('system.wordView.colId'), status: t('system.wordView.colStatus'), version: t('system.wordView.colVersion'),
    createdAt: t('system.fieldConfig.colCreatedAt'), updatedAt: t('system.fieldConfig.colUpdatedAt'), author: t('system.fieldConfig.colAuthor'),
    steps: t('system.wordView.stepsHeading'), coverageStatus: t('system.fieldConfig.colCoverage'),
  }

  const systemFields = ['section', 'name', 'id', 'status', 'version', 'createdAt', 'author', 'coverageStatus']
  const customFields = (typeDef?.fields ?? []).map(f => f.name)
  const category = typeDef?.category
  const relevantLinkTypes = getRelevantLinkTypes(linkTypes, objectTypeRef, category).map(r => r.lt)
  // section / name / id / status / version sont toujours affichés dans l'en-tête de la carte en vue
  // Document (cf. WordView.ItemCard) — les proposer à cocher là n'aurait aucun effet visible
  const fieldsAlwaysInWordHeader = new Set(['section', 'name', 'id', 'status', 'version'])
  // coverageStatus (T138) n'a de sens que pour les exigences — un TestCase n'a pas de statut de
  // couverture, ne pas le proposer à cocher pour ce type d'objet.
  const allFields = [...new Set([...systemFields, ...customFields])]
    .filter(f => tab !== 'word' || !fieldsAlwaysInWordHeader.has(f))
    .filter(f => f !== 'coverageStatus' || category === 'requirement')
  const hasSteps = category === 'test'

  const currentFields = tab === 'excel' ? visibleFieldsExcel : visibleFieldsWord
  const onChangeCurrent = tab === 'excel' ? onChangeExcel : onChangeWord
  const showFolders = tab === 'excel' ? showFoldersExcel : showFoldersWord
  const onChangeShowFolders = tab === 'excel' ? onChangeShowFoldersExcel : onChangeShowFoldersWord

  // Ordre canonique = celui de la liste affichée dans ce panneau (champs système, puis custom,
  // puis étapes, puis liens). Recocher un champ le remet à sa place plutôt qu'en fin de liste.
  const canonicalOrder = [
    ...allFields,
    ...(hasSteps ? ['steps'] : []),
    ...relevantLinkTypes.map(lt => `link::${lt.name}`),
  ]

  const toggle = (f: string) => {
    const next = currentFields.includes(f)
      ? currentFields.filter(x => x !== f)
      : [...currentFields, f]
    const ordered = canonicalOrder.filter(x => next.includes(x))
    const extra = next.filter(x => !canonicalOrder.includes(x))
    onChangeCurrent([...ordered, ...extra])
  }

  const defaultFields = ['section', 'name', 'id', 'status', ...(typeDef?.fields.slice(0, 3).map(f => f.name) ?? [])]

  const tabLabels: Record<ConfigTab, string> = {
    excel: t('system.fieldConfig.tabExcel'),
    word: t('system.fieldConfig.tabWord'),
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end pt-12 pr-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-edge rounded-lg shadow-xl p-4 w-72"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-ink">{t('system.fieldConfig.visibleFields')}</p>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-3 hover:text-ink text-xs"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border border-edge rounded overflow-hidden mb-3 text-xs">
          {(['excel', 'word'] as ConfigTab[]).map(configTab => (
            <button
              key={configTab}
              type="button"
              onClick={() => setTab(configTab)}
              className={[
                'flex-1 py-1 transition-colors',
                tab === configTab
                  ? 'bg-ink text-prim-fg font-medium'
                  : 'text-ink-3 hover:text-ink hover:bg-hover',
              ].join(' ')}
            >
              {tabLabels[configTab]}
            </button>
          ))}
        </div>

        {/* T162 — afficher / masquer les titres de dossiers (par vue) */}
        <label className="flex items-center gap-2 text-xs text-ink cursor-pointer hover:bg-hover px-1 py-0.5 rounded mb-2 pb-2 border-b border-edge">
          <input
            type="checkbox"
            checked={showFolders}
            onChange={e => onChangeShowFolders(e.target.checked)}
            className="h-3 w-3 accent-ink"
          />
          <span>{t('system.fieldConfig.showFolders')}</span>
        </label>

        {/* Scrollable field list */}
        <div className="overflow-y-auto max-h-80 space-y-1.5">
          {allFields.map(f => (
            <label
              key={f}
              className="flex items-center gap-2 text-xs text-ink cursor-pointer hover:bg-hover px-1 py-0.5 rounded"
            >
              <input
                type="checkbox"
                checked={currentFields.includes(f)}
                onChange={() => toggle(f)}
                className="h-3 w-3 accent-ink"
              />
              <span>{systemFieldLabels[f] ?? typeDef?.fields.find(cf => cf.name === f)?.label ?? f}</span>
              {systemFields.includes(f) && (
                <span className="text-ink-3">(sys)</span>
              )}
            </label>
          ))}

          {/* Steps column (test types only) */}
          {hasSteps && (
            <div className="pt-2 mt-1 border-t border-edge">
              <p className="text-xs text-ink-3 font-medium mb-1">{t('system.fieldConfig.testCase')}</p>
              <label className="flex items-center gap-2 text-xs text-ink cursor-pointer hover:bg-hover px-1 py-0.5 rounded">
                <input
                  type="checkbox"
                  checked={currentFields.includes('steps')}
                  onChange={() => toggle('steps')}
                  className="h-3 w-3 accent-ink"
                />
                <span>{t('system.wordView.stepsHeading')}</span>
              </label>
            </div>
          )}

          {/* Link type columns */}
          <div className="pt-2 mt-1 border-t border-edge">
            <p className="text-xs text-ink-3 font-medium mb-1">{t('system.fieldConfig.links')}</p>
            {relevantLinkTypes.length === 0 ? (
              <p className="text-xs text-ink-3 italic">{t('system.fieldConfig.noLinkTypeForType')}</p>
            ) : (
              <div className="space-y-1.5">
                {relevantLinkTypes.map(lt => {
                  const key = `link::${lt.name}`
                  const displayLabel = getLinkTypeLabel(lt, objectTypeRef, category)
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-xs text-ink cursor-pointer hover:bg-hover px-1 py-0.5 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={currentFields.includes(key)}
                        onChange={() => toggle(key)}
                        className="h-3 w-3 accent-ink"
                      />
                      <span>{displayLabel || lt.name}</span>
                      {!isLinkTypeValid(lt) && (
                        <span className="text-status-warning" title={t('system.fieldConfig.missingRefs')}>⚠</span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </div>



        {/* Reset */}
        <button
          type="button"
          onClick={() => { onChangeCurrent(defaultFields); onChangeShowFolders(true) }}
          className="mt-3 text-xs text-ink-3 hover:text-ink underline"
        >
          Réinitialiser
        </button>
      </div>
    </div>
  )
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
    repoPath,
    schemaLoading,
    nodes,
    linkTypes,
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
    createItemObject,
    gotoNodeId,
    gotoSeq,
    clearGoto,
  } = useSystemView()

  // T171 — résolution des paramètres pour les exports (le ParamRefProvider est monté plus bas).
  const paramResolver = useParamResolver(repoPath, currentProjectId ? decodeProjectId(currentProjectId) : '')

  // T135 — `candidateObjects` (dropdown "ajouter un lien") ne se reconstruit que si ces deux
  // requêtes sont invalidées : sans ça, un titre modifié après le chargement initial (y compris
  // le "Sans titre" posé à la création) reste figé dans la liste de candidats indéfiniment, alors
  // que le titre réel de l'objet est bien à jour partout ailleurs (ex: en rouvrant l'objet).
  const invalidateCandidateObjects = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['requirements-all', repoPath] })
    qc.invalidateQueries({ queryKey: ['tests-all', repoPath] })
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
  const [viewMode, setViewMode] = useState<ViewMode>('excel')
  const viewModeRestoredRef = useRef(false)
  // Remembers the last non-edit view mode so we can restore it when leaving edit
  const prevViewModeRef = useRef<'excel' | 'word'>('excel')
  // T92 — lets ViewHeader's "Retour" button (edit mode) trigger EditView's own
  // flush-then-navigate sequence, now that EditView no longer renders its own back button.
  const editViewRef = useRef<EditViewHandle>(null)

  useEffect(() => {
    if (!repoPath || viewModeRestoredRef.current) return
    viewModeRestoredRef.current = true
    const stored = localStorage.getItem(`polenta:viewMode:${repoPath}`)
    if (stored === 'excel' || stored === 'word') {
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
  const [excelRowMaxLines, setExcelRowMaxLines] = useState<number>(() => {
    const stored = Number(localStorage.getItem('polenta:excelRowMaxLines'))
    return Number.isInteger(stored) && stored >= ROW_MAX_LINES_MIN && stored <= ROW_MAX_LINES_ALL ? stored : ROW_MAX_LINES_DEFAULT
  })
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

  // Clear backHistory when the user navigates manually (not via a link click)
  useEffect(() => {
    if (isLinkNavigationRef.current) {
      isLinkNavigationRef.current = false
      return
    }
    setBackHistory([])
    setPendingNavObjectId(null)
  }, [effectiveNodeId, effectiveTypeId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    gcTime: 0,
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
    const fields = format === 'docx' ? visibleFieldsWord : visibleFieldsExcel
    const { columns, rows } = buildExportRows(fields, root, objects, sectionNumbers, stepsByObjectId, effectiveType, filter)
    // T171 §10 — mêmes valeurs de paramètres qu'à l'écran.
    const substitute = (values: Record<string, string>[]) => substituteExportParams(values, effectiveType, paramResolver.substitute)
    const payload = { componentLabel: effectiveNode?.label || effectiveNodeId || '', columns, rows: substitute(rows) }
    if (!templated) return payload
    const outline = buildExportOutline(fields, root, objects, sectionNumbers, stepsByObjectId, filter, effectiveType)
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
            Object.entries(changes).filter(([k]) => !WRITE_BLOCKED.has(k) && k !== 'title')
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
  const prefsRef = useRef<FieldVisibilityPref>({ excel: [], word: [], edit: [], showFoldersExcel: true, showFoldersWord: true })

  const { data: identityLogin, isPending: identityPending } = useQuery({
    queryKey: ['project-username', repoPath],
    queryFn: () => api.auth.projectUsername(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  const username = identityLogin ?? 'local'

  const { data: allLinks = [], isPending: linksPending } = useQuery({
    queryKey: ['links-all', repoPath],
    queryFn: () => api.requirements.linksAll(repoPath),
    enabled: !!repoPath,
  })

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

  const linksByObjectId = useMemo((): Map<string, ObjectLink[]> => {
    const map = new Map<string, ObjectLink[]>()
    for (const link of allLinks) {
      if (!map.has(link.sourceId)) map.set(link.sourceId, [])
      map.get(link.sourceId)!.push(link)
      if (!map.has(link.targetId)) map.set(link.targetId, [])
      map.get(link.targetId)!.push(link)
    }
    return map
  }, [allLinks])

  // ── Couverture de test (T138) ────────────────────────────────────────────────
  // Champ système optionnel `coverageStatus` — désactivé par défaut dans Excel/Word (coché via le
  // panneau ⚙️), toujours affiché dans Édition (cf. specs/T138-design.md, pas d'onglet "Édition"
  // dans FieldConfigModal aujourd'hui). `enabled` évite d'appeler `traceability:matrix` (qui
  // recalcule la couverture de tout le repo) tant qu'aucune des 3 vues n'en a besoin.
  const coverageNeeded = visibleFieldsExcel.includes('coverageStatus')
    || visibleFieldsWord.includes('coverageStatus')
    || (viewMode === 'edit' && effectiveType?.category === 'requirement')

  const { data: matrix, isPending: matrixPending } = useQuery({
    queryKey: ['traceability-matrix', repoPath],
    queryFn: () => api.traceability.matrix(repoPath),
    enabled: !!repoPath && coverageNeeded,
  })

  const coverageByReqId = useMemo(() => {
    const map = new Map<string, { coverageStatus: CoverageStatus; cells: MatrixCell[] }>()
    for (const row of matrix?.requirements ?? []) {
      map.set(row.requirement.id, { coverageStatus: row.coverageStatus, cells: row.cells })
    }
    return map
  }, [matrix])

  const testsById = useMemo(() => {
    const map = new Map<string, TestCase>()
    for (const tc of allTests as TestCase[]) map.set(tc.id, tc)
    return map
  }, [allTests])

  // ── Link navigation callbacks (T37) — after candidateObjects + editingObjectId ──

  const navigateToObject = useCallback((peerId: string, opts?: { newTab?: boolean }) => {
    const target = candidateObjects.find(c => c.id === peerId)
    if (!target) return

    // T134 — a new tab is a fresh route mount with no access to this component's local state
    // (viewMode/pendingNavObjectId), so it can't reuse the in-place tree navigation below. The
    // standalone /req or /test detail page resolves an object from the URL alone, same as
    // SearchPanel's "open result" navigation.
    if (opts?.newTab) {
      const pathname = target.category === 'test' ? `/test/${peerId}` : `/req/${peerId}`
      openTab(pathname, { repoPath, projectId: currentProjectId })
      return
    }

    const parts = target.objectTypeRef.split('::')
    if (parts.length !== 2) return
    const [targetNodeId, targetTypeId] = parts

    setBackHistory(prev => [...prev, {
      nodeId: effectiveNodeId,
      typeId: effectiveTypeId,
      objectId: editingObjectId,
      viewMode,
    }])

    isLinkNavigationRef.current = true

    if (viewMode === 'word') {
      navigateTo(targetNodeId, targetTypeId)
    } else {
      setPendingNavObjectId(peerId)
      setViewMode('edit')
      navigateTo(targetNodeId, targetTypeId)
    }
  }, [candidateObjects, effectiveNodeId, effectiveTypeId, editingObjectId, viewMode, navigateTo, openTab, repoPath, currentProjectId])

  const handleGoBack = useCallback(() => {
    setBackHistory(prev => {
      const entry = prev[prev.length - 1]
      if (!entry) return prev
      isLinkNavigationRef.current = true
      if (entry.viewMode === 'edit' && entry.objectId) {
        setPendingNavObjectId(entry.objectId)
        setViewMode('edit')
      } else {
        setViewMode(entry.viewMode)
      }
      navigateTo(entry.nodeId, entry.typeId)
      return prev.slice(0, -1)
    })
  }, [navigateTo])

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
  // Type dont les colonnes visibles (prefs) sont appliquées — cf. `viewReady`.
  const [prefsAppliedKey, setPrefsAppliedKey] = useState<string | null>(null)

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

  useEffect(() => {
    // Tant que les prefs affichées sont celles de l'ancien type (placeholder en attendant le
    // fetch du nouveau), ne pas re-dériver les colonnes visibles — sinon on écrase l'affichage
    // courant par le fallback avant que les vraies prefs du nouveau type n'arrivent.
    if (isPrefsPlaceholder || prefsPending) return
    const fallback = [
      'section',
      'name',
      'id',
      'status',
      ...(effectiveType?.category === 'requirement' ? ['version'] : []),
      ...(effectiveType?.category === 'test' ? ['steps'] : []),
      ...(effectiveType?.fields.slice(0, 3).map(f => f.name) ?? []),
    ]
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
    prefsRef.current = {
      excel, word, edit,
      showFoldersExcel: showFoldersExcelNext, showFoldersWord: showFoldersWordNext,
      collapsedFoldersExcel: collapsedFoldersExcelNext, collapsedFoldersWord: collapsedFoldersWordNext,
      freezeColCountExcel: freezeColCountExcelNext,
    }
    setPrefsAppliedKey(typeKey)
  }, [savedPrefs, typeKey, isPrefsPlaceholder, prefsPending]) // eslint-disable-line react-hooks/exhaustive-deps

  const autoSaveMutation = useMutation({
    mutationFn: async ({ objectId, field, value }: { objectId: string; field: string; value: string }) => {
      const cat = effectiveType?.category
      if (!cat || !repoPath || !objectId) return
      if (field === 'status') {
        if (cat === 'requirement') return api.requirements.transition(repoPath, objectId, { toStatus: value })
        if (cat === 'test') return api.tests.update(repoPath, objectId, { status: value } as UpdateTestCaseDto)
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

  const handleEditBlurField = useCallback(async (field: string, value: string) => {
    if (field === 'name' && editingNodeId && value.trim()) {
      handleRenameNode(editingNodeId, value.trim())
      return
    }
    if (editingObjectId) {
      autoSaveMutation.mutate({ objectId: editingObjectId, field, value })
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
    mutationFn: async (views: FieldVisibilityPref) => {
      if (!repoPath || !username || !typeKey) return
      await api.pref.setFieldVisibility(repoPath, username, typeKey, views)
      return views
    },
    // Sans ceci, la query ['pref-visibility', ...] garde en cache la valeur d'avant
    // modification (staleTime 60s) : un aller-retour de vue dans ce délai fait rejouer
    // le useEffect ci-dessus avec l'ancien savedPrefs et écrase silencieusement le choix
    // de visibilité qu'on vient pourtant d'enregistrer sur disque.
    onSuccess: (views) => {
      if (!views) return
      qc.setQueryData(['pref-visibility', repoPath, username, typeKey], views)
    },
  })

  // T162 — un seul objet de pref porte les colonnes des 3 vues + les 2 booléens « titres de
  // dossiers ». Chaque handler applique son override sur `prefsRef` (miroir synchrone) et
  // enregistre l'objet COMPLET : sans ça, changer une colonne remettrait `showFolders*` à
  // `undefined`, et deux appels successifs s'écraseraient mutuellement (closures périmées).
  const persistPrefs = useCallback((override: Partial<FieldVisibilityPref>) => {
    const next = { ...prefsRef.current, ...override }
    prefsRef.current = next
    savePrefsMutation.mutate(next)
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
  const viewReady = prefsAppliedKey === typeKey
    && rootKey === `${effectiveNodeId}|${effectiveTypeId}`
    && !objectsPending
    && !(linksPending && shownFields.some(f => f.startsWith('link::')))
    && !(matrixPending && shownFields.includes('coverageStatus'))

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

  // ── Compact toolbar ───────────────────────────────────────────────────────

  const titleLabel = [
    effectiveNode.label || effectiveNodeId,
    effectiveType ? (effectiveType.label || effectiveTypeId) : '',
  ]
    .filter(Boolean)
    .join(' / ')

  return (
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

      {/* ── Field config popover ── */}
      {showFieldConfig && (
        <FieldConfigModal
          typeDef={effectiveType}
          objectTypeRef={effectiveNodeId && effectiveTypeId ? `${effectiveNodeId}::${effectiveTypeId}` : undefined}
          linkTypes={linkTypes}
          activeTab={viewMode === 'word' ? 'word' : 'excel'}
          visibleFieldsExcel={visibleFieldsExcel}
          visibleFieldsWord={visibleFieldsWord}
          onChangeExcel={handleChangeExcel}
          onChangeWord={handleChangeWord}
          showFoldersExcel={showFoldersExcel}
          showFoldersWord={showFoldersWord}
          onChangeShowFoldersExcel={handleChangeShowFoldersExcel}
          onChangeShowFoldersWord={handleChangeShowFoldersWord}
          onClose={() => setShowFieldConfig(false)}
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
            root={root}
            typeDef={effectiveType}
            objects={objects}
            visibleFields={visibleFieldsExcel}
            foldersHidden={!showFoldersExcel}
            sectionNumbers={sectionNumbers}
            linkTypes={linkTypes}
            linksByObjectId={linksByObjectId}
            coverageByReqId={coverageByReqId}
            testsById={testsById}
            repoPath={repoPath}
            candidateObjects={candidateObjects}
            onLinkChange={() => {
              qc.invalidateQueries({ queryKey: ['links-all', repoPath] })
              qc.invalidateQueries({ queryKey: ['traceability-matrix', repoPath] })
            }}
            onInlineEdit={readOnly ? undefined : handleAutoInlineEdit}
            onRenameNode={readOnly ? undefined : handleRenameNode}
            onRootChange={readOnly ? undefined : handleRootChangeDnd}
            onColumnsReorder={handleChangeExcel}
            generateId={generateId}
            stepsByObjectId={stepsByObjectId}
            onStepsChange={readOnly ? undefined : handleWordViewStepsChange}
            onEditOpen={nodeId => {
              setEditingNodeId(nodeId)
              setViewMode('edit')
            }}
            onNavigateToObject={navigateToObject}
            filter={filter}
            filterOptions={filterOptions}
            onItemNodeAdded={readOnly ? undefined : createItemObject}
            gotoNodeId={gotoNodeId}
            gotoSeq={gotoSeq}
            rowMaxLines={excelRowMaxLines >= ROW_MAX_LINES_ALL ? Infinity : excelRowMaxLines}
            collapsedFolders={collapsedFoldersExcel}
            onCollapsedFoldersChange={handleCollapsedFoldersExcelChange}
            freezeColCount={freezeColCountExcel}
            onFreezeColCountChange={handleFreezeColCountExcelChange}
          />
        )}
        {effectiveType?.category !== 'campaign' && viewMode === 'word' && viewReady && (
          <WordView
            root={root}
            typeDef={effectiveType}
            objects={objects}
            visibleFields={visibleFieldsWord}
            foldersHidden={!showFoldersWord}
            sectionNumbers={sectionNumbers}
            linkTypes={linkTypes}
            linksByObjectId={linksByObjectId}
            coverageByReqId={coverageByReqId}
            testsById={testsById}
            repoPath={repoPath}
            candidateObjects={candidateObjects}
            onLinkChange={() => {
              qc.invalidateQueries({ queryKey: ['links-all', repoPath] })
              qc.invalidateQueries({ queryKey: ['traceability-matrix', repoPath] })
            }}
            onInlineEdit={readOnly ? undefined : handleAutoInlineEdit}
            onRenameNode={readOnly ? undefined : handleRenameNode}
            onReopenDraft={readOnly ? undefined : handleReopenDraft}
            stepsByObjectId={stepsByObjectId}
            onStepsChange={readOnly ? undefined : handleWordViewStepsChange}
            onEditOpen={nodeId => {
              setEditingNodeId(nodeId)
              setViewMode('edit')
            }}
            onNavigateToObject={navigateToObject}
            filter={filter}
            filterOptions={filterOptions}
            gotoNodeId={gotoNodeId}
            gotoSeq={gotoSeq}
            collapsedFolders={collapsedFoldersWord}
            onCollapsedFoldersChange={handleCollapsedFoldersWordChange}
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
            onLinkChange={() => {
              qc.invalidateQueries({ queryKey: ['links-all', repoPath] })
              qc.invalidateQueries({ queryKey: ['traceability-matrix', repoPath] })
            }}
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
  )
}
