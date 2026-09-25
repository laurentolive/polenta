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
import { TestParamFields } from '../components/TestParamFields'
import { isParamsComplete } from '../lib/testParams'
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
  const [error, setError] = useState<string | null>(null)

  // TanStack Router ne remonte pas ce composant pour une navigation vers cette même route
  // (seuls les search params changent) — sans ce resync, rouvrir "Nouvelle Campagne" depuis la
  // barre latérale pendant qu'on est déjà sur /campaign/new laisserait le titre/la sélection
  // du préremplissage précédent affichés malgré la nouvelle navigation.
  useEffect(() => {
    setTitle(prefillTitle ?? '')
    setSelectedTests(new Set(prefillTestCaseIds ? prefillTestCaseIds.split(',').filter(Boolean) : []))
    setParamValues({})
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
  const manualKeysById = new Map([...selectedTests].map(id => [id, paramPreviews.get(id)?.manual ?? []]))

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
    if (previewLoading || !isParamsComplete(selectedTests, manualKeysById, paramValues)) {
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

  function toggleTest(id: string) {
    setSelectedTests(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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

          {/* Test case selection */}
          <div>
            <p className="text-sm font-medium text-ink mb-2">
              {t('campaignPage.testCasesSelected', { count: selectedTests.size })}
            </p>
            {tests.length === 0 ? (
              <p className="text-xs text-ink-3 italic">{t('campaignPage.noTestCaseAvailable')}</p>
            ) : (
              <div className="border border-edge rounded divide-y max-h-48 overflow-y-auto">
                {tests.map(t => (
                  <div key={t.id}>
                    <label className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-hover">
                      <input
                        type="checkbox"
                        checked={selectedTests.has(t.id)}
                        onChange={() => toggleTest(t.id)}
                        className="rounded"
                      />
                      <span className="font-mono text-ink-3 shrink-0">{t.id}</span>
                      <span className="text-ink truncate">{t.title}</span>
                    </label>
                    {selectedTests.has(t.id) && (
                      <TestParamFields
                        labels={paramPreviews.get(t.id)?.manual ?? []}
                        resolved={paramPreviews.get(t.id)?.resolved}
                        unresolved={paramPreviews.get(t.id)?.unresolved}
                        values={paramValues[t.id] ?? {}}
                        onChange={(label, value) => setParamValues(prev => ({
                          ...prev,
                          [t.id]: { ...(prev[t.id] ?? {}), [label]: value },
                        }))}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-status-danger">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={createMutation.isPending || previewLoading || !isParamsComplete(selectedTests, manualKeysById, paramValues)}
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
