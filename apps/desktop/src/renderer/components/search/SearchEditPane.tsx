/**
 * SearchEditPane — édition inline d'un résultat de recherche (T167 sprint 2).
 *
 * Câble `EditView` (le même composant que le double-clic dans les vues
 * Exigences / Tests) dans la zone principale de `/search`, **sans quitter la
 * route** : `editing` vit dans `SearchContext`, « Retour aux résultats »
 * (`onBack`) le remet à `null`.
 *
 * Version allégée de la machinerie de `SystemView` : pas d'arbre (pas de
 * renommage de nœud, pas de `tree.save`), pas d'undo/redo, pas de création
 * d'objet (`editing.id` désigne toujours un objet existant), pas de retour
 * arrière multi-niveaux (`backHistory`). La navigation vers un objet lié ouvre
 * un nouvel onglet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api'
import { EditView, type EditViewHandle } from '../system/EditView'
import { StepsTable, type StepDraft } from '../StepsTable'
import { ViewHeader } from '../layout/ViewHeader'
import { RichTextProvider } from '../../contexts/RichTextContext'
import { RichTextToolbar } from '../system/RichTextToolbar'
import { useVersioning } from '../../contexts/VersioningContext'
import { useTabs } from '../../contexts/TabsContext'
import { useProjectSchema, getReqTypeDef, getTestTypeDef } from '../../hooks/useProjectSchema'
import { flattenSystemNodes } from '@polenta/types'
import type { ObjectLink, Requirement, TestCase, CoverageStatus, MatrixCell } from '@polenta/types'
import type { UpdateTestCaseDto } from '@polenta/zod-schemas'

// Mêmes champs « système » non ré-écrits que `SystemView`.
const SYSTEM_FIELDS_SET = new Set(['id', 'createdAt', 'updatedAt', 'author', 'objectTypeRef', 'version', 'status'])

interface Props {
  editing: { id: string; itemType: 'requirement' | 'test' }
  repoPath: string
  projectId: string
  onBack: () => void
}

export function SearchEditPane({ editing, repoPath, projectId, onBack }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { openTab } = useTabs()
  const { isReadonly } = useVersioning()
  const { data: schema } = useProjectSchema(repoPath)

  const category = editing.itemType
  const editViewRef = useRef<EditViewHandle>(null)

  // ── Objet édité ───────────────────────────────────────────────────────────
  const { data: loadedObject, isLoading: loadedObjectLoading } = useQuery<Requirement | TestCase>({
    queryKey: ['object', repoPath, category, editing.id],
    queryFn: async () => {
      if (category === 'requirement') return api.requirements.get(repoPath, editing.id)
      return api.tests.get(repoPath, editing.id)
    },
    enabled: !!repoPath,
    gcTime: 0,
  })

  const objectData = useMemo((): Record<string, string> | null => {
    if (!loadedObject) return null
    const o = loadedObject
    return {
      id: o.id,
      title: o.title ?? '',
      status: o.status ?? '',
      createdAt: o.createdAt ?? '',
      updatedAt: o.updatedAt ?? '',
      author: o.createdBy ?? '',
      objectTypeRef: o.objectTypeRef ?? '',
      ...Object.fromEntries(
        Object.entries(o.fields ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)]),
      ),
    }
  }, [loadedObject])

  const objectTypeRef = objectData?.['objectTypeRef'] ?? ''
  const typeDef = category === 'requirement'
    ? getReqTypeDef(schema, objectTypeRef)
    : getTestTypeDef(schema, objectTypeRef)

  const visibleFields = useMemo(
    () => ['name', 'id', 'status', ...(typeDef?.fields.map((f) => f.name) ?? [])],
    [typeDef],
  )

  // ── Liens / candidats / couverture ────────────────────────────────────────
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
    for (const { node } of flattenSystemNodes(schema?.nodes ?? [])) {
      for (const ot of node.objectTypes ?? []) map.set(`${node.name}::${ot.name}`, ot.category)
    }
    return map
  }, [schema])

  const candidateObjects = useMemo(() => [
    ...allRequirements.map((r) => ({ id: r.id, title: r.title, objectTypeRef: r.objectTypeRef, category: refToCategory.get(r.objectTypeRef) })),
    ...(allTests as TestCase[]).map((tc) => ({ id: tc.id, title: tc.title, objectTypeRef: tc.objectTypeRef, category: refToCategory.get(tc.objectTypeRef) })),
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

  const coverageNeeded = category === 'requirement'
  const { data: matrix } = useQuery({
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
  const testsById = useMemo(
    () => new Map((allTests as TestCase[]).map((tc) => [tc.id, tc])),
    [allTests],
  )

  // ── Étapes (test) ─────────────────────────────────────────────────────────
  const [testSteps, setTestSteps] = useState<StepDraft[]>([])
  const testStepsRef = useRef<StepDraft[]>([])
  const stepsDirtyRef = useRef(false)
  // Id du test pour lequel `testSteps` a été semé depuis le serveur — évite d'écraser
  // une édition en cours quand `loadedObject` est simplement refetché (même objet).
  const stepsSeededIdRef = useRef<string | null>(null)
  const isEditingTestCase = category === 'test'

  useEffect(() => { testStepsRef.current = testSteps }, [testSteps])

  const flushSteps = useCallback(async (objectId: string, steps: StepDraft[]) => {
    if (!repoPath || !stepsDirtyRef.current) return
    stepsDirtyRef.current = false
    try {
      await api.tests.update(repoPath, objectId, {
        steps: steps.map((s, i) => ({ order: i + 1, action: s.action, expectedResult: s.expectedResult, notes: null })),
      } as UpdateTestCaseDto)
      qc.invalidateQueries({ queryKey: ['tests', repoPath] })
      qc.invalidateQueries({ queryKey: ['object', repoPath, 'test', objectId] })
    } catch (err) {
      console.error('[SearchEditPane] steps flush', err)
      stepsDirtyRef.current = true
    }
  }, [repoPath, qc])

  // Sème `testSteps` UNIQUEMENT au 1er chargement / changement d'objet — pas à
  // chaque refetch du même objet (sinon les étapes en cours d'édition sont écrasées).
  useEffect(() => {
    if (!loadedObject || category !== 'test') return
    if (stepsSeededIdRef.current === loadedObject.id) return
    stepsSeededIdRef.current = loadedObject.id
    stepsDirtyRef.current = false
    const tc = loadedObject as TestCase
    const sorted = (tc.steps ?? []).slice().sort((a, b) => a.order - b.order).map((s) => ({ action: s.action, expectedResult: s.expectedResult }))
    setTestSteps(sorted.length > 0 ? sorted : [{ action: '', expectedResult: '' }])
  }, [loadedObject, category])

  // Autosave debouncé des étapes.
  useEffect(() => {
    if (!repoPath || !isEditingTestCase || isReadonly || !stepsDirtyRef.current) return
    const timer = setTimeout(() => { void flushSteps(editing.id, testStepsRef.current) }, 800)
    return () => clearTimeout(timer)
  }, [testSteps, repoPath, isEditingTestCase, isReadonly, editing.id, flushSteps])

  // Flush des étapes non sauvegardées de l'objet SORTANT au changement d'élément / démontage.
  useEffect(() => {
    const outgoingId = editing.id
    return () => { void flushSteps(outgoingId, testStepsRef.current) }
  }, [editing.id, flushSteps])

  const handleStepsChange = useCallback((steps: StepDraft[]) => {
    stepsDirtyRef.current = true
    setTestSteps(steps)
  }, [])

  // ── Sauvegardes ──────────────────────────────────────────────────────────
  const invalidateAfterSave = useCallback((objectId: string, titleChanged: boolean) => {
    qc.invalidateQueries({ queryKey: ['object', repoPath, category, objectId] })
    // rafraîchit la liste des résultats de recherche (mêmes clés que SearchContext)
    qc.invalidateQueries({ queryKey: [category === 'requirement' ? 'requirements' : 'tests', repoPath] })
    if (titleChanged) {
      qc.invalidateQueries({ queryKey: ['requirements-all', repoPath] })
      qc.invalidateQueries({ queryKey: ['tests-all', repoPath] })
    }
  }, [qc, repoPath, category])

  const saveField = useCallback(async (objectId: string, field: string, value: string) => {
    if (!repoPath || !objectId) return
    if (field === 'status') {
      if (category === 'requirement') await api.requirements.transition(repoPath, objectId, { toStatus: value })
      else await api.tests.update(repoPath, objectId, { status: value } as UpdateTestCaseDto)
      invalidateAfterSave(objectId, false)
      return
    }
    if (SYSTEM_FIELDS_SET.has(field)) return
    const dto = field === 'title' ? { title: value } : { fields: { [field]: value } }
    if (category === 'requirement') await api.requirements.update(repoPath, objectId, dto)
    else await api.tests.update(repoPath, objectId, dto as UpdateTestCaseDto)
    invalidateAfterSave(objectId, field === 'title')
  }, [repoPath, category, invalidateAfterSave])

  // Blur d'un champ = sauvegarde immédiate (comme `SystemView.handleEditBlurField`).
  // La coalescence des frappes richtext est gérée en interne par `EditView`
  // (autosave debouncé → `onFlushValues`), pas ici.
  const handleBlurField = useCallback((field: string, value: string) => {
    if (field === 'section') return
    // `name` = le titre en Vue Recherche (pas de nœud d'arbre à renommer).
    const realField = field === 'name' ? 'title' : field
    void saveField(editing.id, realField, value).catch((err) => console.error('[SearchEditPane] saveField', err))
  }, [editing.id, saveField])

  // Persiste en une requête les champs de `values` qui diffèrent de leur baseline serveur.
  // Adapté de `SystemView.handleFlushEditValues`, branche « objet existant » uniquement.
  const handleFlushValues = useCallback(async (
    values: Record<string, string>,
    target?: { objectId: string; category: string; baseline: Record<string, string> },
  ): Promise<boolean> => {
    const cat = target?.category || category
    if (!repoPath) return true
    const objectId = target?.objectId ?? editing.id
    const baseline = target?.baseline ?? objectData ?? {}
    const changedFields: Record<string, string> = {}
    let newTitle: string | undefined
    for (const [field, value] of Object.entries(values)) {
      if (field === 'section' || field === 'name') continue
      if (SYSTEM_FIELDS_SET.has(field)) continue
      const serverValue = baseline[field] ?? ''
      if (value === serverValue) continue
      if (field === 'title') newTitle = value.trim() || undefined
      else changedFields[field] = value
    }
    if (!newTitle && Object.keys(changedFields).length === 0) return true
    const dto = {
      ...(newTitle ? { title: newTitle } : {}),
      ...(Object.keys(changedFields).length > 0 ? { fields: changedFields } : {}),
    }
    try {
      if (cat === 'requirement') await api.requirements.update(repoPath, objectId, dto)
      else await api.tests.update(repoPath, objectId, dto as UpdateTestCaseDto)
    } catch (err) {
      console.error('[SearchEditPane] flush error', err)
      return false
    }
    invalidateAfterSave(objectId, !!newTitle)
    return true
  }, [category, repoPath, editing.id, objectData, invalidateAfterSave])

  const handleLinkChange = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['links-all', repoPath] })
    qc.invalidateQueries({ queryKey: ['traceability-matrix', repoPath] })
  }, [qc, repoPath])

  const handleNavigateToObject = useCallback((peerId: string) => {
    const target = candidateObjects.find((c) => c.id === peerId)
    const path = target?.category === 'test' ? `/test/${peerId}` : `/req/${peerId}`
    openTab(path, { repoPath, projectId })
  }, [candidateObjects, openTab, repoPath, projectId])

  const typeLabel = typeDef?.label ?? t('sidebar.search.title')

  return (
    <RichTextProvider>
      <div className="flex flex-col h-full overflow-hidden">
        <ViewHeader
          currentProjectId={projectId}
          title={
            <>
              {typeLabel}
              <span className="ml-2 text-xs font-mono text-ink-3 font-normal">{editing.id}</span>
            </>
          }
          back={{ label: t('search.edit.back'), onClick: () => editViewRef.current?.triggerBack() }}
          actions={<RichTextToolbar repoPath={repoPath} />}
        />
        <div className="flex-1 overflow-hidden flex flex-col">
          <EditView
            ref={editViewRef}
            nodeId={editing.id}
            nodeName={objectData?.['title']}
            objectData={objectData}
            objectLoading={!objectData && loadedObjectLoading}
            typeDef={typeDef}
            visibleFields={visibleFields}
            readOnly={isReadonly}
            linkTypes={schema?.linkTypes ?? []}
            objectLinks={linksByObjectId.get(editing.id) ?? []}
            coverageByReqId={coverageByReqId}
            testsById={testsById}
            repoPath={repoPath}
            candidateObjects={candidateObjects}
            onLinkChange={handleLinkChange}
            onBlurField={handleBlurField}
            onFlushValues={handleFlushValues}
            onNavigateToObject={handleNavigateToObject}
            onBack={onBack}
          >
            {isEditingTestCase && (
              <div className="border-t border-edge pt-5">
                <p className="text-xs font-medium text-ink-2 mb-3">{t('system.wordView.stepsHeading')}</p>
                <StepsTable
                  steps={testSteps}
                  onChange={handleStepsChange}
                  disabled={isReadonly}
                  repoPath={repoPath}
                />
              </div>
            )}
          </EditView>
        </div>
      </div>
    </RichTextProvider>
  )
}
