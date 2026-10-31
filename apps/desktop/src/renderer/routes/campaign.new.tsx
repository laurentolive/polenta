import { isFieldRequiredNow, objectFieldReader } from '@polenta/types'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { decodeInstances } from '../lib/reqInstances'
import { api } from '../api'
import { useProjectSchema, getObjectTypeRefs, getTestTypeRefs } from '../hooks/useProjectSchema'
import { DynamicField } from '../components/DynamicField'
import { RichTextProvider } from '../contexts/RichTextContext'
import { RichTextToolbar } from '../components/system/RichTextToolbar'
import { ViewHeader } from '../components/layout/ViewHeader'
import {
  buildReqInstances, effectiveReqSelection, isAddComplete, isIteratingPreview, type ReqSelectionState,
} from '../lib/reqInstances'
import { TestPickerModal, type PickerResult } from '../components/campaign/TestPickerModal'
import { useParamPreview } from '../hooks/useParamPreview'
import { decodeProjectId } from '../lib/projectId'
import type { TestCase } from '@polenta/types'
import {
  EMPTY_CARRY_STATE, carryCoverage, isCarryComplete, toCarriedSelection, withCarryPrecedence,
  type CarryEligibility, type CarryState, type PickedCarry,
} from '../lib/carryOver'

export const Route = createFileRoute('/campaign/new')({
  component: NewCampaignPage,
  validateSearch: (search: Record<string, unknown>) => ({
    repoPath: (search['repoPath'] as string) ?? '',
    projectId: (search['projectId'] as string) ?? '',
    component: search['component'] as string | undefined,
    level: search['level'] as string | undefined,
    // T46 : pré-remplissage depuis "Générer une campagne" dans l'analyse d'impact —
    // testCaseIds est une liste d'IDs séparés par des virgules, title un titre suggéré.
    title: search['title'] as string | undefined,
    testCaseIds: search['testCaseIds'] as string | undefined,
    /** GH207 — changeset qui crée la campagne, et instances retenues (`TEST-1:SW-1|SW-2,…`). */
    ...(search['changeset'] ? { changeset: search['changeset'] as string } : {}),
    ...(search['instances'] ? { instances: search['instances'] as string } : {}),
  }),
})

function buildDefaultFields(typeDef: { fields: Array<{ name: string; default?: unknown }> } | undefined): Record<string, string> {
  if (!typeDef) return {}
  const result: Record<string, string> = {}
  for (const f of typeDef.fields) {
    result[f.name] = f.default !== undefined ? String(f.default) : ''
  }
  return result
}

function NewCampaignPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { repoPath, projectId, component, level, title: prefillTitle, testCaseIds: prefillTestCaseIds, changeset, instances } = Route.useSearch()

  const [title, setTitle] = useState(prefillTitle ?? '')
  const [baselineRef, setBaselineRef] = useState('')
  const [selectedTests, setSelectedTests] = useState<Set<string>>(
    () => new Set(prefillTestCaseIds ? prefillTestCaseIds.split(',').filter(Boolean) : []),
  )
  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({})
  // T179 — tests itérants : exigences cochées et valeurs saisies par instance.
  const [reqSel, setReqSel] = useState<ReqSelectionState>({})
  // GH64 — entrées reportées depuis d'autres campagnes, et état de l'onglet pour sa réouverture.
  const [carried, setCarried] = useState<PickedCarry[]>([])
  const [carryState, setCarryState] = useState<CarryState>(EMPTY_CARRY_STATE)
  const [error, setError] = useState<string | null>(null)
  // GH33 — sélecteur ouvert : sélection et saisies à restituer (figées à l'ouverture).
  const [pickerInitial, setPickerInitial] = useState<PickerResult | null>(null)

  // TanStack Router ne remonte pas ce composant pour une navigation vers cette même route
  // (seuls les search params changent) — sans ce resync, rouvrir "Nouvelle Campagne" depuis la
  // barre latérale pendant qu'on est déjà sur /campaign/new laisserait le titre/la sélection
  // du préremplissage précédent affichés malgré la nouvelle navigation.
  useEffect(() => {
    setTitle(prefillTitle ?? '')
    setSelectedTests(new Set(prefillTestCaseIds ? prefillTestCaseIds.split(',').filter(Boolean) : []))
    setParamValues({})
    setReqSel(decodeInstances(instances))
    setCarried([])
    setCarryState(EMPTY_CARRY_STATE)
    setPickerInitial(null)
  }, [prefillTitle, prefillTestCaseIds, instances])

  const { data: schema } = useProjectSchema(repoPath)
  // GH146 — `type` est la ref complète `<nœud>::<type>` (comme `objectTypeRef`), pas le seul nom.
  const campaignTypes = getObjectTypeRefs(schema, 'campaign')

  const [type, setType] = useState<string>('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [fieldsInitialized, setFieldsInitialized] = useState(false)

  useEffect(() => {
    if (schema && !fieldsInitialized) {
      const allTypes = getObjectTypeRefs(schema, 'campaign')
      // Depuis le panneau Campagnes, `level` est le type de campagne sélectionné : le présélectionner.
      const fromPanel = level
        ? allTypes.find(r => r.ref === `${component}::${level}`) ?? allTypes.find(r => r.typeDef.name === level)
        : undefined
      const resolved = fromPanel ?? allTypes[0]
      setType(resolved?.ref ?? '')
      setFields(buildDefaultFields(resolved?.typeDef))
      setFieldsInitialized(true)
    }
  }, [schema, fieldsInitialized, component, level])

  const handleTypeChange = (newType: string) => {
    setType(newType)
    setFields(buildDefaultFields(campaignTypes.find(r => r.ref === newType)?.typeDef))
  }

  const typeDef = campaignTypes.find(r => r.ref === type)?.typeDef
  // GH146 — sans composant/niveau fournis (création depuis l'analyse d'impact), on les déduit du
  // type choisi : la campagne doit rester listée dans le panneau Campagnes, filtré par composant.
  const [typeNode, typeName] = type.includes('::') ? type.split('::') : [undefined, undefined]

  const { data: allTests = [] } = useQuery({
    queryKey: ['tests', repoPath],
    queryFn: () => api.tests.list(repoPath),
    enabled: !!repoPath,
  })

  const allTestsById = new Map(allTests.map(tc => [tc.id, tc]))

  // Filter tests by component (node) and level (objectType) when specified.
  // objectTypeRef format: "componentName::objectTypeName"
  // GH12 — `level` n'est un filtre que s'il désigne un type de **test** : depuis le panneau
  // Campagnes, c'est le type de campagne sélectionné, qui excluait alors tous les tests ; dans ce
  // cas seul le composant filtre.
  const testTypeRefs = getTestTypeRefs(schema).map(r => r.ref)
  const levelIsTestType = !!level && testTypeRefs.some(ref =>
    component ? ref === `${component}::${level}` : ref.endsWith(`::${level}`))
  const tests = allTests.filter(t => {
    if (level && levelIsTestType) {
      return component ? t.objectTypeRef === `${component}::${level}` : t.objectTypeRef.endsWith(`::${level}`)
    }
    if (component) return t.objectTypeRef.startsWith(`${component}::`)
    return true
  })
  // GH64 — périmètre des tests reportables à la création (même filtre que l'onglet Tests).
  const testIdsInScope = useMemo(() => new Set(tests.map(tc => tc.id)), [tests])

  // T171 — résolution prévisionnelle des paramètres des tests sélectionnés, lue au `baselineRef`
  // saisi (sans repli sur l'état courant) ou sur l'état courant : références résolues affichées en
  // lecture seule, non résolues signalées avant validation, seules les autres sont à saisir.
  // Porte sur toute la sélection — préremplissage T46 inclus, qui peut référencer des tests hors
  // du filtre composant/niveau courant (cf. specs/T97.md, correctif revue de code).
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  const { previews: paramPreviews, isLoading: previewLoading } = useParamPreview(
    repoPath, { baselineRef: baselineRef.trim() || undefined }, [...selectedTests, ...carried.map(c => c.testCaseId)], workspaceDir,
  )
  // Nouvelle campagne : aucune exigence n'a encore d'instance.
  const noneYet = () => new Set<string>()
  // Une campagne peut être créée sans test : aucune instance exigée.
  // GH64 — priorité au report : tests et exigences couverts par une entrée reportée ne sont pas
  // ajoutés une seconde fois depuis l'onglet Tests (la sélection de l'onglet reste intacte).
  const precedence = withCarryPrecedence([...selectedTests], noneYet, carryCoverage(carried, paramPreviews))
  // Une baseline modifiée après la sélection peut demander de nouvelles saisies aux reportées.
  const paramsComplete = isAddComplete(precedence.testIds, paramPreviews, paramValues, reqSel, precedence.presentOf, false)
    && isCarryComplete(carried, paramPreviews)
  const selectionCount = precedence.testIds.length + carried.length
  const isCarryEligible = useCallback(
    (tc: TestCase): CarryEligibility => (testIdsInScope.has(tc.id) ? 'ok' : 'outOfScope'),
    [testIdsInScope],
  )

  const { data: tags = [] } = useQuery({
    queryKey: ['git-tags', repoPath],
    queryFn: () => api.sync.tags(repoPath),
    enabled: !!repoPath,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.campaigns.create(repoPath, {
        title,
        objectTypeRef: type || undefined,
        fields,
        baselineRef: baselineRef.trim() || undefined,
        testCaseIds: precedence.testIds,
        paramValuesByTest: paramValues,
        reqInstances: buildReqInstances(precedence.testIds, paramPreviews, reqSel, precedence.presentOf),
        carried: toCarriedSelection(carried),
        component: component || typeNode || undefined,
        level: level || typeName || undefined,
        ...(changeset && { changeset }),
      }, workspaceDir || undefined),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['campaigns', repoPath] })
      navigate({
        to: '/campaign/$campaignId',
        params: { campaignId: result.id },
        search: { repoPath, projectId, component: component || undefined, level: level || undefined },
      })
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t('common.unknownError'))
    },
  })

  const submitForm = () => {
    if (createMutation.isPending) return
    if (!title.trim()) { setError(t('requirementsPage.titleRequired')); return }
    if (!repoPath) { setError(t('common.projectNotLoaded')); return }
    if (previewLoading || !paramsComplete) {
      setError(t('campaignPage.paramsIncomplete'))
      return
    }
    setError(null)
    createMutation.mutate()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submitForm()
  }

  return (
    <RichTextProvider>
      <div className="flex flex-col h-full overflow-hidden">
        <ViewHeader
          currentProjectId={projectId}
          title={t('campaignPage.newTitle')}
          actions={<RichTextToolbar repoPath={repoPath} />}
        />

        <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl p-6">

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              {t('requirementsPage.titleLabel')} <span className="text-status-danger">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('campaignPage.titlePlaceholder')}
              className="input-field w-full"
              autoFocus
            />
          </div>

          {campaignTypes.length > 0 && (
            <>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">{t('system.editView.colType')}</label>
                <select value={type} onChange={e => handleTypeChange(e.target.value)} className="input-field w-full">
                  {campaignTypes.map(r => (
                    <option key={r.ref} value={r.ref}>{r.label}</option>
                  ))}
                </select>
              </div>

              {typeDef?.fields.map(f => (
                <DynamicField key={f.name} field={f}
                  value={fields[f.name] ?? String(f.default ?? '')}
                  requiredNow={isFieldRequiredNow(f, objectFieldReader(typeDef, { status: 'planned', fields: fields }))}
                  onChange={v => setFields(prev => ({ ...prev, [f.name]: v }))}
                  repoPath={repoPath}
                  interfaceRoles={schema?.roles?.map(r => r.name)}
                  onSubmit={submitForm}
                />
              ))}
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-ink mb-1">{t('campaignPage.baselineLabel')}</label>
            <input
              type="text"
              list="baseline-tags"
              value={baselineRef}
              onChange={e => setBaselineRef(e.target.value)}
              placeholder={t('campaignPage.baselinePlaceholder')}
              className="input-field w-full"
            />
            {tags.length > 0 && (
              <datalist id="baseline-tags">
                {tags.map(tag => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
            )}
          </div>

          {/* Test case selection — GH33 : sélecteur en modale (Vue Excel filtrable, 2 étapes) */}
          <div>
            <p className="text-sm font-medium text-ink mb-2">
              {t('campaignPage.testCasesSelected', { count: selectionCount })}
            </p>
            <button
              type="button"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ['campaign-param-preview'] })
                setPickerInitial({ testIds: [...selectedTests], paramValues, reqSel, carried, carryState })
              }}
              className="text-xs text-status-info hover:opacity-80 border border-status-info-border rounded px-3 py-1.5"
            >
              {selectionCount === 0 ? t('campaignPage.picker.openSelect') : t('campaignPage.picker.edit')}
            </button>
            {selectionCount > 0 && (
              <ul className="mt-2 border border-edge rounded divide-y max-h-64 overflow-y-auto">
                {precedence.testIds.map(id => {
                  const p = paramPreviews.get(id)
                  const iterating = isIteratingPreview(p)
                  const instances = iterating ? Object.keys(effectiveReqSelection(id, p, precedence.presentOf(id), reqSel)).length : 1
                  const values = Object.entries(paramValues[id] ?? {}).filter(([, v]) => v.trim())
                  return (
                    <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="font-mono text-ink-3 shrink-0">{id}</span>
                      <span className="text-ink truncate">{allTestsById.get(id)?.title ?? ''}</span>
                      {iterating && (
                        <span className="shrink-0 text-[10px] text-ink-3">{t('campaignPage.picker.instances', { count: instances })}</span>
                      )}
                      {values.length > 0 && (
                        <span className="ml-auto shrink min-w-0 truncate text-[10px] text-ink-3 font-mono">
                          {values.map(([k, v]) => `${k}=${v}`).join(', ')}
                        </span>
                      )}
                    </li>
                  )
                })}
                {carried.map(c => {
                  const values = c.reqInstances
                    ? c.reqInstances.map(r => r.requirementId)
                    : Object.entries(c.paramValues ?? {}).filter(([, v]) => v.trim()).map(([k, v]) => `${k}=${v}`)
                  return (
                    <li key={`${c.campaignId}/${c.entryId}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="font-mono text-ink-3 shrink-0">{c.testCaseId}</span>
                      <span className="text-ink truncate">{allTestsById.get(c.testCaseId)?.title ?? ''}</span>
                      <span
                        className="shrink-0 font-mono text-[10px] text-ink-3"
                        title={t('campaignPage.carriedFrom', { campaignId: c.campaignId, entryId: c.entryId })}
                      >
                        ↩ {c.campaignId}
                      </span>
                      {c.requirementId && <span className="shrink-0 font-mono text-[10px] text-ink-3">· {c.requirementId}</span>}
                      {values.length > 0 && (
                        <span className="ml-auto shrink min-w-0 truncate text-[10px] text-ink-3 font-mono">{values.join(', ')}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {selectionCount > 0 && !previewLoading && !paramsComplete && (
              <p className="mt-1 text-xs text-status-warning">{t('campaignPage.paramsIncomplete')}</p>
            )}
          </div>
          {pickerInitial && (
            <TestPickerModal
              repoPath={repoPath}
              workspaceDir={workspaceDir}
              mode="create"
              candidates={tests}
              allTests={allTests}
              defaultTypeRef={component && level ? `${component}::${level}` : undefined}
              previewSource={{ baselineRef: baselineRef.trim() || undefined }}
              initial={pickerInitial}
              presentOf={noneYet}
              isEligible={isCarryEligible}
              onConfirm={result => {
                setSelectedTests(new Set(result.testIds))
                setParamValues(result.paramValues)
                setReqSel(result.reqSel)
                setCarried(result.carried)
                setCarryState(result.carryState)
                setPickerInitial(null)
              }}
              onCancel={() => setPickerInitial(null)}
            />
          )}

          {error && <p className="text-sm text-status-danger">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={createMutation.isPending || previewLoading || !paramsComplete}
              className="btn-primary"
            >
              {createMutation.isPending ? t('common.creating') : t('campaignPage.createCampaign')}
            </button>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
        </div>
        </div>
      </div>
    </RichTextProvider>
  )
}
