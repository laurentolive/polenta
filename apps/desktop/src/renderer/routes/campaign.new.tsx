import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useProjectSchema, getAllObjectTypes } from '../hooks/useProjectSchema'
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
  const { repoPath, projectId, component, level, title: prefillTitle, testCaseIds: prefillTestCaseIds } = Route.useSearch()

  const [title, setTitle] = useState(prefillTitle ?? '')
  const [baselineRef, setBaselineRef] = useState('')
  const [selectedTests, setSelectedTests] = useState<Set<string>>(
    () => new Set(prefillTestCaseIds ? prefillTestCaseIds.split(',').filter(Boolean) : []),
  )
  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({})
  // T179 — tests itérants : exigences cochées et valeurs saisies par instance.
  const [reqSel, setReqSel] = useState<ReqSelectionState>({})
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
    setReqSel({})
    setPickerInitial(null)
  }, [prefillTitle, prefillTestCaseIds])

  const { data: schema } = useProjectSchema(repoPath)
  const campaignTypes = getAllObjectTypes(schema, 'campaign')

  const [type, setType] = useState<string>('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [fieldsInitialized, setFieldsInitialized] = useState(false)

  useEffect(() => {
    if (schema && !fieldsInitialized) {
      const allTypes = getAllObjectTypes(schema, 'campaign')
      const resolvedType = allTypes[0]?.name ?? ''
      setType(resolvedType)
      setFields(buildDefaultFields(allTypes.find(t => t.name === resolvedType)))
      setFieldsInitialized(true)
    }
  }, [schema, fieldsInitialized])

  const handleTypeChange = (newType: string) => {
    setType(newType)
    setFields(buildDefaultFields(campaignTypes.find(t => t.name === newType)))
  }

  const typeDef = campaignTypes.find(t => t.name === type)

  const { data: allTests = [] } = useQuery({
    queryKey: ['tests', repoPath],
    queryFn: () => api.tests.list(repoPath),
    enabled: !!repoPath,
  })

  const allTestsById = new Map(allTests.map(tc => [tc.id, tc]))

  // Filter tests by component (node) and level (objectType) when specified.
  // objectTypeRef format: "componentName::objectTypeName"
  const tests = allTests.filter(t => {
    if (component && level) return t.objectTypeRef === `${component}::${level}`
    if (component) return t.objectTypeRef.startsWith(`${component}::`)
    if (level) return t.objectTypeRef.endsWith(`::${level}`)
    return true
  })

  // T171 — résolution prévisionnelle des paramètres des tests sélectionnés, lue au `baselineRef`
  // saisi (sans repli sur l'état courant) ou sur l'état courant : références résolues affichées en
  // lecture seule, non résolues signalées avant validation, seules les autres sont à saisir.
  // Porte sur toute la sélection — préremplissage T46 inclus, qui peut référencer des tests hors
  // du filtre composant/niveau courant (cf. specs/T97.md, correctif revue de code).
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  const { previews: paramPreviews, isLoading: previewLoading } = useParamPreview(
    repoPath, { baselineRef: baselineRef.trim() || undefined }, [...selectedTests], workspaceDir,
  )
  // Nouvelle campagne : aucune exigence n'a encore d'instance.
  const noneYet = () => new Set<string>()
  // Une campagne peut être créée sans test : aucune instance exigée.
  const paramsComplete = isAddComplete(selectedTests, paramPreviews, paramValues, reqSel, noneYet, false)

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
        testCaseIds: [...selectedTests],
        paramValuesByTest: paramValues,
        reqInstances: buildReqInstances(selectedTests, paramPreviews, reqSel, noneYet),
        component: component || undefined,
        level: level || undefined,
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
                  {campaignTypes.map(t => (
                    <option key={t.name} value={t.name}>{t.label ?? t.name}</option>
                  ))}
                </select>
              </div>

              {typeDef?.fields.map(f => (
                <DynamicField key={f.name} field={f}
                  value={fields[f.name] ?? String(f.default ?? '')}
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
              {t('campaignPage.testCasesSelected', { count: selectedTests.size })}
            </p>
            <button
              type="button"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ['campaign-param-preview'] })
                setPickerInitial({ testIds: [...selectedTests], paramValues, reqSel })
              }}
              className="text-xs text-status-info hover:opacity-80 border border-status-info-border rounded px-3 py-1.5"
            >
              {selectedTests.size === 0 ? t('campaignPage.picker.openSelect') : t('campaignPage.picker.edit')}
            </button>
            {selectedTests.size > 0 && (
              <ul className="mt-2 border border-edge rounded divide-y max-h-64 overflow-y-auto">
                {[...selectedTests].map(id => {
                  const p = paramPreviews.get(id)
                  const iterating = isIteratingPreview(p)
                  const instances = iterating ? Object.keys(effectiveReqSelection(id, p, noneYet(), reqSel)).length : 1
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
              </ul>
            )}
            {selectedTests.size > 0 && !previewLoading && !paramsComplete && (
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
              onConfirm={result => {
                setSelectedTests(new Set(result.testIds))
                setParamValues(result.paramValues)
                setReqSel(result.reqSel)
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
