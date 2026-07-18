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
import { StepsTable } from '../StepsTable'
import type { StepDraft } from '../StepsTable'
import { Grid3x3, FileText, Settings } from 'lucide-react'
import { CampaignListView } from './CampaignListView'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSystemView } from '../../contexts/SystemViewContext'
import { treeFindNode, treeFindByObjectId, computeSectionNumbers } from '../../hooks/useTreeState'
import { ExcelView } from './ExcelView'
import { WordView } from './WordView'
import { EditView, type EditViewHandle } from './EditView'
import { api } from '../../api'
import { RichTextProvider } from '../../contexts/RichTextContext'
import { RichTextToolbar } from './RichTextToolbar'
import { ViewHeader } from '../layout/ViewHeader'
import { ExportButton } from '../export/ExportButton'
import { requirementsExportBaseName, testsExportBaseName } from '../export/exportFilenames'
import { buildExportRows } from '../../lib/exportColumns'
import { normalizeObject } from '../../lib/normalizeObject'
import type { ObjectLink, ObjectTypeDefinition, LinkTypeDefinition, Requirement, TestCase, TypeTreeNode } from '@polenta/types'
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
  onClose: () => void
}) {
  const [tab, setTab] = useState<ConfigTab>(activeTab)

  const systemFieldLabels: Record<string, string> = {
    section: 'Section', name: 'Label', id: 'ID', status: 'Statut', version: 'Version',
    createdAt: 'Créé le', updatedAt: 'Modifié le', author: 'Auteur',
    steps: 'Étapes',
  }

  const systemFields = ['section', 'name', 'id', 'status', 'version', 'createdAt', 'author']
  const customFields = (typeDef?.fields ?? []).map(f => f.name)
  const category = typeDef?.category
  const relevantLinkTypes = getRelevantLinkTypes(linkTypes, objectTypeRef, category).map(r => r.lt)
  // section / name / id / status / version sont toujours affichés dans l'en-tête de la carte en vue
  // Document (cf. WordView.ItemCard) — les proposer à cocher là n'aurait aucun effet visible
  const fieldsAlwaysInWordHeader = new Set(['section', 'name', 'id', 'status', 'version'])
  const allFields = [...new Set([...systemFields, ...customFields])]
    .filter(f => tab !== 'word' || !fieldsAlwaysInWordHeader.has(f))
  const hasSteps = category === 'test'

  const currentFields = tab === 'excel' ? visibleFieldsExcel : visibleFieldsWord
  const onChangeCurrent = tab === 'excel' ? onChangeExcel : onChangeWord

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
    excel: 'Tableau',
    word: 'Document',
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
          <p className="text-sm font-semibold text-ink">Champs visibles</p>
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
          {(['excel', 'word'] as ConfigTab[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={[
                'flex-1 py-1 transition-colors',
                tab === t
                  ? 'bg-ink text-prim-fg font-medium'
                  : 'text-ink-3 hover:text-ink hover:bg-hover',
              ].join(' ')}
            >
              {tabLabels[t]}
            </button>
          ))}
        </div>

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
              <p className="text-xs text-ink-3 font-medium mb-1">Cas de test</p>
              <label className="flex items-center gap-2 text-xs text-ink cursor-pointer hover:bg-hover px-1 py-0.5 rounded">
                <input
                  type="checkbox"
                  checked={currentFields.includes('steps')}
                  onChange={() => toggle('steps')}
                  className="h-3 w-3 accent-ink"
                />
                <span>Étapes</span>
              </label>
            </div>
          )}

          {/* Link type columns */}
          <div className="pt-2 mt-1 border-t border-edge">
            <p className="text-xs text-ink-3 font-medium mb-1">Liens</p>
            {relevantLinkTypes.length === 0 ? (
              <p className="text-xs text-ink-3 italic">Aucun type de lien pour ce type</p>
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
                        <span className="text-amber-500" title="sourceRefs ou targetRefs manquant">⚠</span>
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
          onClick={() => onChangeCurrent(defaultFields)}
          className="mt-3 text-xs text-ink-3 hover:text-ink underline"
        >
          Réinitialiser
        </button>
      </div>
    </div>
  )
}

// ── Main SystemView ───────────────────────────────────────────────────────────

export function SystemView() {
  const qc = useQueryClient()
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
    setRoot,
    canUndo,
    canRedo,
    undo,
    redo,
    readOnly,
    filter,
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
  } = useSystemView()

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

  // When a node is set for editing (from tree double-click), switch to edit mode
  useEffect(() => {
    if (editingNodeId !== null) {
      setViewMode('edit')
    }
  }, [editingNodeId])

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

  const { data: loadedObject } = useQuery({
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

  const { data: rawObjects = [] } = useQuery({
    queryKey: ['objects', repoPath, effectiveType?.category, effectiveNodeId, effectiveTypeId],
    queryFn: async () => {
      if (!repoPath || !effectiveType?.category || !effectiveNodeId || !effectiveTypeId) return []
      const ref = `${effectiveNodeId}::${effectiveTypeId}`
      if (effectiveType.category === 'requirement') {
        const all = await api.requirements.list(repoPath, {})
        return all.filter(r => r.objectTypeRef === ref)
      }
      if (effectiveType.category === 'test') {
        const all = await api.tests.list(repoPath)
        return all.filter(t => t.objectTypeRef === ref)
      }
      return []
    },
    enabled: !!repoPath && !!effectiveType?.category && !!effectiveNodeId && !!effectiveTypeId,
  })

  const objects = useMemo(
    () => (rawObjects as (Requirement | TestCase)[]).map(o => {
      const normalized = normalizeObject(o)
      const edits = pendingEdits[normalized.id]
      if (!edits) return normalized
      return { ...normalized, ...edits }
    }),
    [rawObjects, pendingEdits]
  )

  const stepsByObjectId = useMemo((): Map<string, { action: string; expectedResult: string }[]> | undefined => {
    if (effectiveType?.category !== 'test') return undefined
    const map = new Map<string, { action: string; expectedResult: string }[]>()
    for (const obj of rawObjects as TestCase[]) {
      if (obj.id) {
        map.set(obj.id, (obj.steps ?? []).slice().sort((a, b) => a.order - b.order).map(s => ({ action: s.action, expectedResult: s.expectedResult })))
      }
    }
    return map
  }, [rawObjects, effectiveType?.category])

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

  const { data: identity } = useQuery({
    queryKey: ['identity', repoPath],
    queryFn: () => api.auth.resolveIdentity(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  const username = identity?.login ?? 'local'

  const { data: allLinks = [] } = useQuery({
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
    for (const node of nodes) {
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

  // ── Link navigation callbacks (T37) — after candidateObjects + editingObjectId ──

  const navigateToObject = useCallback((peerId: string) => {
    const target = candidateObjects.find(c => c.id === peerId)
    if (!target) return
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
  }, [candidateObjects, effectiveNodeId, effectiveTypeId, editingObjectId, viewMode, navigateTo])

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

  const { data: savedPrefs } = useQuery({
    queryKey: ['pref-visibility', repoPath, username, typeKey],
    queryFn: async () => {
      if (!repoPath || !username || !typeKey) return null
      return api.pref.getFieldVisibility(repoPath, username, typeKey)
    },
    enabled: !!repoPath && !!username && !!typeKey,
  })

  useEffect(() => {
    const fallback = [
      'section',
      'name',
      'id',
      'status',
      ...(effectiveType?.category === 'requirement' ? ['version'] : []),
      ...(effectiveType?.category === 'test' ? ['steps'] : []),
      ...(effectiveType?.fields.slice(0, 3).map(f => f.name) ?? []),
    ]
    setVisibleFieldsExcel(savedPrefs?.excel ?? fallback)
    setVisibleFieldsWord(savedPrefs?.word ?? fallback)
    setVisibleFieldsEdit(savedPrefs?.edit ?? fallback)
  }, [savedPrefs, effectiveTypeId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['objects', repoPath, effectiveType?.category, effectiveNodeId, effectiveTypeId] })
      qc.invalidateQueries({ queryKey: ['object', repoPath, effectiveType?.category, variables.objectId] })
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
  }, [repoPath, effectiveNodeId, effectiveTypeId, root, setRoot, qc])

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
      } catch (err) {
        console.error('Erreur création objet:', err)
      } finally {
        setIsCreating(false)
      }
    }
  }, [editingObjectId, editingNodeId, effectiveType, effectiveNodeId, effectiveTypeId, repoPath, autoSaveMutation, root, setRoot, qc, handleRenameNode])

  // Appelé par EditView au moment de la navigation (onBack) — sauvegarde tous les champs modifiés en une seule requête
  // Si editingObjectId est null (nouveau nœud sans objet), crée l'objet avec les valeurs remplies
  const handleFlushEditValues = useCallback((localValues: Record<string, string>) => {
    const cat = effectiveType?.category
    if (!cat || !repoPath || !editingNodeId) return

    if (editingObjectId) {
      // Objet existant — sauvegarder les champs modifiés
      const changedFields: Record<string, string> = {}
      let newTitle: string | undefined
      for (const [field, value] of Object.entries(localValues)) {
        if (field === 'section' || field === 'name') continue
        if (SYSTEM_FIELDS_SET.has(field)) continue
        if (field === 'status') continue
        const serverValue = objectData?.[field] ?? ''
        if (value === serverValue) continue
        if (field === 'title') { newTitle = value.trim() || undefined }
        else { changedFields[field] = value }
      }
      if (!newTitle && Object.keys(changedFields).length === 0) return
      const dto = {
        ...(newTitle ? { title: newTitle } : {}),
        ...(Object.keys(changedFields).length > 0 ? { fields: changedFields } : {}),
      }
      if (cat === 'requirement') {
        api.requirements.update(repoPath, editingObjectId, dto)
          .then(() => qc.invalidateQueries({ queryKey: ['objects', repoPath, cat, effectiveNodeId, effectiveTypeId] }))
          .catch(err => console.error('[FlushEdit] Erreur update requirement:', err))
      } else if (cat === 'test') {
        api.tests.update(repoPath, editingObjectId, dto as UpdateTestCaseDto)
          .then(() => qc.invalidateQueries({ queryKey: ['objects', repoPath, cat, effectiveNodeId, effectiveTypeId] }))
          .catch(err => console.error('[FlushEdit] Erreur update test:', err))
      }
    } else {
      // Nouvel objet — créer avec les valeurs remplies
      const title = localValues['title']?.trim() || editingTreeNode?.name?.trim() || 'Sans titre'
      const customFields: Record<string, string> = {}
      for (const [field, value] of Object.entries(localValues)) {
        if (field === 'section' || field === 'name' || SYSTEM_FIELDS_SET.has(field) || field === 'status' || field === 'title') continue
        if (value !== '') customFields[field] = value
      }
      // Ne créer que si au moins un champ est rempli (hors titre issu du nom du nœud)
      if (Object.keys(customFields).length === 0 && !localValues['title']?.trim()) return

      const objectTypeRef = `${effectiveNodeId}::${effectiveTypeId}`
      const afterCreate = (newId: string) => {
        const updatedRoot = updateNodeObjectId(root, editingNodeId, newId)
        setRoot(updatedRoot)
        api.tree.save(repoPath, { nodeId: effectiveNodeId, typeId: effectiveTypeId, root: updatedRoot })
          .then(() => {
            qc.invalidateQueries({ queryKey: ['tree', repoPath, effectiveNodeId, effectiveTypeId] })
            qc.invalidateQueries({ queryKey: ['objects', repoPath, cat, effectiveNodeId, effectiveTypeId] })
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
  }, [editingObjectId, editingNodeId, editingTreeNode, effectiveType, repoPath, objectData, effectiveNodeId, effectiveTypeId, qc, root, setRoot])

  const savePrefsMutation = useMutation({
    mutationFn: async (views: { excel: string[]; word: string[]; edit: string[] }) => {
      if (!repoPath || !username || !typeKey) return
      await api.pref.setFieldVisibility(repoPath, username, typeKey, views)
    },
  })

  const handleChangeExcel = useCallback((fields: string[]) => {
    setVisibleFieldsExcel(fields)
    savePrefsMutation.mutate({ excel: fields, word: visibleFieldsWord, edit: visibleFieldsEdit })
  }, [visibleFieldsWord, visibleFieldsEdit, savePrefsMutation])

  const handleChangeWord = useCallback((fields: string[]) => {
    setVisibleFieldsWord(fields)
    savePrefsMutation.mutate({ excel: visibleFieldsExcel, word: fields, edit: visibleFieldsEdit })
  }, [visibleFieldsExcel, visibleFieldsEdit, savePrefsMutation])

  const handleChangeEdit = useCallback((fields: string[]) => {
    setVisibleFieldsEdit(fields)
    savePrefsMutation.mutate({ excel: visibleFieldsExcel, word: visibleFieldsWord, edit: fields })
  }, [visibleFieldsExcel, visibleFieldsWord, savePrefsMutation])

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
        Aucun composant configuré. Allez dans Projet → Modèle de données.
      </div>
    )
  }

  if (objectTypes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
        Aucun élément configuré
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
            ? { label: 'Retour', onClick: () => editViewRef.current?.triggerBack() }
            : backHistory.length > 0
              ? { label: 'Retour', onClick: handleGoBack }
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
              title="Annuler (Ctrl+Z)"
              className="text-xs text-ink-3 hover:text-ink disabled:opacity-30 px-1"
            >
              ↩
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              title="Rétablir (Ctrl+Y)"
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
                getPayload={(format) => {
                  const { columns, rows } = buildExportRows(
                    format === 'docx' ? visibleFieldsWord : visibleFieldsExcel,
                    root, objects, sectionNumbers, stepsByObjectId, effectiveType, filter,
                  )
                  return { componentLabel: effectiveNode?.label || effectiveNodeId, columns, rows }
                }}
                getPrintParams={() => ({
                  repoPath,
                  username,
                  filter,
                  objectTypeRef: `${effectiveNodeId}::${effectiveTypeId}`,
                  componentLabel: effectiveNode?.label || effectiveNodeId,
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
                getPayload={(format) => {
                  const { columns, rows } = buildExportRows(
                    format === 'docx' ? visibleFieldsWord : visibleFieldsExcel,
                    root, objects, sectionNumbers, stepsByObjectId, effectiveType, filter,
                  )
                  return { componentLabel: effectiveNode?.label || effectiveNodeId, columns, rows }
                }}
                getPrintParams={() => ({
                  repoPath,
                  username,
                  filter,
                  objectTypeRef: `${effectiveNodeId}::${effectiveTypeId}`,
                  componentLabel: effectiveNode?.label || effectiveNodeId,
                })}
              />
            )}

            {/* Field config — hidden for campaign types */}
            {effectiveType?.category !== 'campaign' && (
              <button
                type="button"
                onClick={() => setShowFieldConfig(v => !v)}
                title="Configurer les colonnes"
                className="text-ink-3 hover:text-ink p-1 rounded hover:bg-hover"
              >
                <Settings size={14} />
              </button>
            )}

            {/* View mode selector — hidden for campaign types */}
            {effectiveType?.category !== 'campaign' && (
              <div className="flex border border-edge rounded overflow-hidden">
                {(
                  [
                    { mode: 'excel' as ViewMode, icon: <Grid3x3 size={13} />, title: 'Vue tableau' },
                    { mode: 'word' as ViewMode, icon: <FileText size={13} />, title: 'Vue document' },
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
        {effectiveType?.category !== 'campaign' && viewMode === 'excel' && (
          <ExcelView
            root={root}
            typeDef={effectiveType}
            objects={objects}
            visibleFields={visibleFieldsExcel}
            sectionNumbers={sectionNumbers}
            linkTypes={linkTypes}
            linksByObjectId={linksByObjectId}
            repoPath={repoPath}
            candidateObjects={candidateObjects}
            onLinkChange={() => qc.invalidateQueries({ queryKey: ['links-all', repoPath] })}
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
            onItemNodeAdded={readOnly ? undefined : createItemObject}
          />
        )}
        {effectiveType?.category !== 'campaign' && viewMode === 'word' && (
          <WordView
            root={root}
            typeDef={effectiveType}
            objects={objects}
            visibleFields={visibleFieldsWord}
            sectionNumbers={sectionNumbers}
            linkTypes={linkTypes}
            linksByObjectId={linksByObjectId}
            repoPath={repoPath}
            candidateObjects={candidateObjects}
            onLinkChange={() => qc.invalidateQueries({ queryKey: ['links-all', repoPath] })}
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
          />
        )}
        {effectiveType?.category !== 'campaign' && viewMode === 'edit' && (
          <EditView
            ref={editViewRef}
            nodeId={editingNodeId}
            nodeName={editingTreeNode?.name}
            objectData={objectData}
            typeDef={effectiveType}
            visibleFields={[
              'section', 'name', 'id', 'status',
              ...(effectiveType?.fields.map(f => f.name) ?? []),
            ]}
            sectionNumbers={sectionNumbers}
            readOnly={readOnly}
            linkTypes={linkTypes}
            objectLinks={editingObjectId ? (linksByObjectId.get(editingObjectId) ?? []) : []}
            repoPath={repoPath}
            candidateObjects={candidateObjects}
            onLinkChange={() => qc.invalidateQueries({ queryKey: ['links-all', repoPath] })}
            onBlurField={handleEditBlurField}
            onFlushValues={handleFlushEditValues}
            onNavigateToObject={navigateToObject}
            onBack={handleEditBack}
          >
            {isEditingTestCase && (
              <div className="border-t border-edge pt-5">
                <p className="text-xs font-medium text-ink-2 mb-3">Étapes</p>
                <StepsTable
                  steps={testSteps}
                  onChange={setTestSteps}
                  disabled={readOnly}
                  repoPath={repoPath}
                />
              </div>
            )}
          </EditView>
        )}
      </div>
    </div>
    </RichTextProvider>
  )
}
