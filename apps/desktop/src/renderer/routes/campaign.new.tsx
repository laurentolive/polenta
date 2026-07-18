import { createFileRoute, useNavigate } from '@tanstack/react-router'
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
  // Carte non filtrée : la sélection (préremplissage T46 inclus) peut référencer des tests
  // hors du filtre composant/niveau courant — la validation des paramètres doit malgré
  // tout les couvrir (cf. specs/T97.md, correctif revue de code).
  const allTestsMap = new Map(allTests.map(t => [t.id, t]))

  // Filter tests by component (node) and level (objectType) when specified.
  // objectTypeRef format: "componentName::objectTypeName"
  const tests = allTests.filter(t => {
    if (component && level) return t.objectTypeRef === `${component}::${level}`
    if (component) return t.objectTypeRef.startsWith(`${component}::`)
    if (level) return t.objectTypeRef.endsWith(`::${level}`)
    return true
  })

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
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['campaigns', repoPath] })
      navigate({
        to: '/campaign/$campaignId',
        params: { campaignId: result.id },
        search: { repoPath, projectId, component: component || undefined, level: level || undefined },
      })
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setError('Le titre est obligatoire.'); return }
    if (!repoPath) { setError('Projet non chargé.'); return }
    if (!isParamsComplete(selectedTests, allTestsMap, paramValues)) {
      setError('Renseignez la valeur de chaque paramètre des tests sélectionnés.')
      return
    }
    setError(null)
    createMutation.mutate()
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
          title="Nouvelle Campagne de test"
          actions={<RichTextToolbar repoPath={repoPath} />}
        />

        <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl p-6">

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Titre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex : Campagne validation sprint 11"
              className="input-field w-full"
              autoFocus
            />
          </div>

          {campaignTypes.length > 0 && (
            <>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Type</label>
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
                />
              ))}
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-ink mb-1">Baseline (tag git ou SHA)</label>
            <input
              type="text"
              list="baseline-tags"
              value={baselineRef}
              onChange={e => setBaselineRef(e.target.value)}
              placeholder="v1.2.0 ou abc1234"
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
              Cas de test ({selectedTests.size} sélectionné{selectedTests.size !== 1 ? 's' : ''})
            </p>
            {tests.length === 0 ? (
              <p className="text-xs text-ink-3 italic">Aucun cas de test disponible</p>
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
                        testCase={t}
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

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={createMutation.isPending || !isParamsComplete(selectedTests, allTestsMap, paramValues)}
              className="btn-primary"
            >
              {createMutation.isPending ? 'Création…' : 'Créer la campagne'}
            </button>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="btn-secondary"
            >
              Annuler
            </button>
          </div>
        </form>
        </div>
        </div>
      </div>
    </RichTextProvider>
  )
}
