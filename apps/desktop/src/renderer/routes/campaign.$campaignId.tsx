import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation, Trans } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Trash2, Play, Eye, Pencil, Copy, AlertTriangle } from 'lucide-react'
import { api } from '../api'
import { useProjectSchema, getCampaignTypeDef, getTestTypeDef } from '../hooks/useProjectSchema'
import { DynamicField } from '../components/DynamicField'
import { RichTextViewer } from '../components/RichTextViewer'
import { RichTextProvider } from '../contexts/RichTextContext'
import { RichTextToolbar } from '../components/system/RichTextToolbar'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useRegisterTabDirty, useSetTabTitle } from '../contexts/TabsContext'
import { TestParamFields } from '../components/TestParamFields'
import { isParamsComplete, manualKeysForRun } from '../lib/testParams'
import { useParamPreview } from '../hooks/useParamPreview'
import { decodeProjectId } from '../lib/projectId'
import { UnresolvedParamsBanner } from '../components/UnresolvedParamsBanner'
import { ExportButton } from '../components/export/ExportButton'
import { campaignExportBaseName } from '../components/export/exportFilenames'
import { resolveCampaignRuns, resolveRunTest } from '../lib/campaignTests'
import { useModalHotkeys } from '../hooks/useModalHotkeys'
import type { TestRunStatus, TestCase, ProjectSchema } from '@polenta/types'

export const Route = createFileRoute('/campaign/$campaignId')({
  component: CampaignDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    repoPath: (search['repoPath'] as string) ?? '',
    projectId: (search['projectId'] as string) ?? '',
    component: search['component'] as string | undefined,
    level: search['level'] as string | undefined,
  }),
})

export const RUN_STATUS_LABEL_KEY: Record<TestRunStatus, string> = {
  pending:    'campaignPage.runStatus.pending',
  PASS:       'campaignPage.runStatus.pass',
  FAIL:       'campaignPage.runStatus.fail',
  BLOCKED:    'campaignPage.runStatus.blocked',
  INCOMPLETE: 'campaignPage.runStatus.incomplete',
}

const RUN_STATUS_CLASS: Record<TestRunStatus, string> = {
  pending:    'bg-status-neutral-bg text-status-neutral',
  PASS:       'bg-status-success-bg text-status-success',
  FAIL:       'bg-status-danger-bg text-status-danger',
  BLOCKED:    'bg-status-warning-bg text-status-warning',
  INCOMPLETE: 'bg-status-warning-bg text-status-warning',
}

// Statut "approuvé" résolu depuis `statuses[].isApproval` du type du test (schema.yaml),
// pas depuis le littéral 'approved' — un projet nommant son statut d'approbation
// différemment (ex: "valide") doit quand même être respecté (même logique que
// maturity.util.ts côté main). Repli sur 'approved' si le type n'a pas de statut isApproval.
function isTestApproved(test: TestCase, schema: ProjectSchema | undefined): boolean {
  const typeDef = getTestTypeDef(schema, test.objectTypeRef)
  const approvalStatusName = typeDef?.statuses?.find(s => s.isApproval)?.name
  return test.status === (approvalStatusName ?? 'approved')
}

// ─── Campaign detail page ─────────────────────────────────────────────────────

function CampaignDetailPage() {
  const { t } = useTranslation()
  const { campaignId } = Route.useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { repoPath, projectId, component, level } = Route.useSearch()
  // T171 — résolution des paramètres de la base (repos composants) à l'ajout.
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''

  const [addingTests, setAddingTests] = useState(false)
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set())
  const [addParamValues, setAddParamValues] = useState<Record<string, Record<string, string>>>({})
  const [testFilter, setTestFilter] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editingFields, setEditingFields] = useState<Record<string, string> | null>(null)
  const [editingParamsFor, setEditingParamsFor] = useState<string | null>(null)
  const [editParamValues, setEditParamValues] = useState<Record<string, string>>({})
  const [duplicatingFor, setDuplicatingFor] = useState<string | null>(null)
  const [duplicateParamValues, setDuplicateParamValues] = useState<Record<string, string>>({})
  const [isConfirmingAdd, setIsConfirmingAdd] = useState(false)

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', repoPath, campaignId],
    queryFn: () => api.campaigns.get(repoPath, campaignId),
    enabled: !!repoPath,
  })
  useSetTabTitle(campaign?.title)
  // editingFields !== null means the "Modifier les champs" panel is open with an unsaved draft
  // (Annuler/Enregistrer, same explicit-draft shape as schema.tsx/req.$reqId.tsx's isDirty/hasChanges).
  useRegisterTabDirty(editingFields !== null)

  const { data: schema } = useProjectSchema(repoPath)

  const updateFieldsMutation = useMutation({
    mutationFn: (fields: Record<string, string>) =>
      api.campaigns.update(repoPath, campaignId, { fields }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', repoPath, campaignId] })
      setEditingFields(null)
    },
  })

  const { data: tests = [], isLoading: testsLoading } = useQuery({
    queryKey: ['tests', repoPath],
    queryFn: () => api.tests.list(repoPath),
    enabled: !!repoPath,
  })

  // T171 — références à saisir / lues dans la base / non résolues, pour chaque test approuvé
  // candidat à l'ajout (ou à une nouvelle instance), lues à la source de la campagne.
  const { previews: paramPreviews, isLoading: previewLoading } = useParamPreview(
    repoPath, { campaignId }, tests.map(t => t.id), workspaceDir, !!repoPath && tests.length > 0,
  )

  const closeMutation = useMutation({
    mutationFn: (status: 'completed' | 'abandoned') =>
      api.campaigns.close(repoPath, campaignId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', repoPath, campaignId] })
      qc.invalidateQueries({ queryKey: ['campaigns', repoPath] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.campaigns.delete(repoPath, campaignId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns', repoPath] })
      window.history.back()
    },
  })

  useModalHotkeys(
    () => setConfirmDelete(false),
    () => deleteMutation.mutate(),
    !confirmDelete || deleteMutation.isPending,
  )

  const addTestsMutation = useMutation({
    mutationFn: ({ ids, paramValues }: { ids: string[]; paramValues: Record<string, Record<string, string>> }) =>
      api.campaigns.addTests(repoPath, campaignId, ids, paramValues, workspaceDir || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', repoPath, campaignId] })
      qc.invalidateQueries({ queryKey: ['campaigns', repoPath] })
    },
  })

  const updateParamsMutation = useMutation({
    mutationFn: ({ entryId, paramValues }: { entryId: string; paramValues: Record<string, string> }) =>
      api.campaigns.updateRunParams(repoPath, campaignId, entryId, paramValues),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', repoPath, campaignId] })
      setEditingParamsFor(null)
    },
  })

  const duplicateTestMutation = useMutation({
    mutationFn: ({ testCaseId, paramValues }: { testCaseId: string; paramValues: Record<string, string> }) =>
      api.campaigns.duplicateTest(repoPath, campaignId, testCaseId, paramValues, workspaceDir || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', repoPath, campaignId] })
      qc.invalidateQueries({ queryKey: ['campaigns', repoPath] })
      setDuplicatingFor(null)
      setDuplicateParamValues({})
    },
  })

  const removeTestMutation = useMutation({
    mutationFn: (entryId: string) =>
      api.campaigns.removeEntries(repoPath, campaignId, [entryId]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', repoPath, campaignId] })
      qc.invalidateQueries({ queryKey: ['campaigns', repoPath] })
    },
  })

  if (!repoPath) {
    return <p className="p-6 text-sm text-ink-2"><Trans i18nKey="testsPage.missingRepoPath" components={{ code: <code /> }} /></p>
  }
  if (isLoading) return <p className="p-6 text-sm text-ink-3">{t('common.loading')}</p>
  if (!campaign) return <p className="p-6 text-sm text-ink-2">{t('campaignPage.notFound', { campaignId })}</p>

  const typeDef = getCampaignTypeDef(schema, campaign.objectTypeRef)

  function getStringField(key: string): string {
    const v = campaign!.fields?.[key]
    return typeof v === 'string' ? v : (v !== undefined && v !== null ? String(v) : '')
  }

  function startEditingFields() {
    const initial: Record<string, string> = {}
    for (const f of typeDef?.fields ?? []) initial[f.name] = getStringField(f.name)
    setEditingFields(initial)
  }

  const testMap = new Map(tests.map(t => [t.id, t]))
  const isActive = campaign.status === 'planned' || campaign.status === 'in_progress'

  const includedIds = new Set(campaign.testCaseIds)
  // T171 — références à saisir par test, selon la résolution prévisionnelle (base à la source de
  // la campagne). Seules elles comptent pour la complétude et pour la règle d'instance unique.
  const manualKeysById = new Map(tests.map(t => [t.id, paramPreviews.get(t.id)?.manual ?? []]))
  // Un test déjà présent reste proposé s'il a des paramètres **à saisir** — permet d'en ajouter
  // une autre instance directement depuis ce panneau. Un test dont toutes les références sont
  // résolues depuis la base se comporte comme un test sans paramètre : une seule inclusion.
  const availableTests = tests
    .filter(t => isTestApproved(t, schema))
    .filter(t => !includedIds.has(t.id) || (manualKeysById.get(t.id)?.length ?? 0) > 0)
  const filteredAvailable = testFilter.trim()
    ? availableTests.filter(t =>
        t.id.toLowerCase().includes(testFilter.toLowerCase()) ||
        (t.title ?? '').toLowerCase().includes(testFilter.toLowerCase())
      )
    : availableTests

  function getRunParamValues(entryId: string): Record<string, string> {
    return campaign!.runs.find(r => r.entryId === entryId)?.paramValues ?? {}
  }

  function startEditingParams(entryId: string) {
    setEditingParamsFor(entryId)
    setEditParamValues(getRunParamValues(entryId))
  }

  function navigateToView(entryId: string) {
    navigate({
      to: '/campaign/$campaignId/run/$testId',
      params: { campaignId, testId: entryId },
      search: { repoPath, projectId, component, level },
    })
  }

  function toggleToAdd(id: string) {
    setSelectedToAdd(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleConfirmAdd() {
    if (selectedToAdd.size === 0) return
    if (previewLoading || !isParamsComplete(selectedToAdd, manualKeysById, addParamValues)) return

    // Un id déjà présent dans la campagne (test paramétré re-sélectionné) devient une
    // nouvelle instance via duplicateTest() plutôt qu'addTests(), qui déduplique.
    const ids = [...selectedToAdd]
    const newIds = ids.filter(id => !includedIds.has(id))
    const duplicateIds = ids.filter(id => includedIds.has(id))

    setIsConfirmingAdd(true)
    try {
      await Promise.all([
        ...(newIds.length > 0 ? [addTestsMutation.mutateAsync({ ids: newIds, paramValues: addParamValues })] : []),
        ...duplicateIds.map(id => duplicateTestMutation.mutateAsync({ testCaseId: id, paramValues: addParamValues[id] ?? {} })),
      ])
      setAddingTests(false)
      setSelectedToAdd(new Set())
      setAddParamValues({})
      setTestFilter('')
    } finally {
      setIsConfirmingAdd(false)
    }
  }

  return (
    <RichTextProvider>
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        title={campaign.title}
        subtitle={<span className="font-mono">{campaign.id}</span>}
        actions={
          <>
            <RichTextToolbar repoPath={repoPath} />
            {/* `!testsLoading` : `tests` alimente le payload xlsx/docx (`resolveCampaignRuns`,
                utilisé en repli pour les entrées sans `testSnapshot`) — sans cette garde, cliquer
                Exporter avant la fin du chargement de la liste des tests exporterait
                silencieusement un cahier/rapport vide (`tests` vaut `[]` par défaut). */}
            {!testsLoading && (
              <ExportButton
                kind="campaign-plan"
                formats={['xlsx', 'docx', 'pdf']}
                repoPath={repoPath}
                getSuggestedBaseName={async () => {
                  const headSha = await api.git.headSha(repoPath)
                  return campaignExportBaseName(campaign.component || 'projet', campaign.title, headSha, 'plan')
                }}
                getPayload={() => ({ campaign, entries: resolveCampaignRuns(campaign, tests) })}
                getPrintParams={() => ({ repoPath, campaignId })}
              />
            )}
            {/* Rapport de campagne : seulement si au moins un test a été exécuté (cf. specs/T43.md
                §2) — un run "pending" n'a rien à rapporter. */}
            {!testsLoading && campaign.runs.some(r => r.status !== 'pending') && (
              <ExportButton
                kind="campaign-report"
                formats={['docx', 'pdf']}
                repoPath={repoPath}
                getSuggestedBaseName={async () => {
                  const headSha = await api.git.headSha(repoPath)
                  return campaignExportBaseName(campaign.component || 'projet', campaign.title, headSha, 'report')
                }}
                getPayload={() => ({ campaign, entries: resolveCampaignRuns(campaign, tests) })}
                getPrintParams={() => ({ repoPath, campaignId })}
              />
            )}
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              campaign.status === 'completed' ? 'bg-status-success-bg text-status-success' :
              campaign.status === 'in_progress' ? 'bg-status-info-bg text-status-info' :
              campaign.status === 'abandoned' ? 'bg-status-danger-bg text-status-danger' :
              'bg-status-neutral-bg text-status-neutral'
            }`}>
              {campaign.status}
            </span>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl p-6">
      {/* Champs personnalisés (fields{} du type de campagne) */}
      {typeDef && typeDef.fields.length > 0 && (
        <div className="border rounded p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide">{typeDef.label ?? typeDef.name}</p>
            {editingFields === null ? (
              <button
                type="button"
                onClick={startEditingFields}
                title={t('campaignPage.editFields')}
                className="text-ink-3 hover:text-ink p-1 rounded hover:bg-hover"
              >
                <Pencil size={13} />
              </button>
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditingFields(null)} className="text-xs text-ink-3 hover:text-ink">
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => updateFieldsMutation.mutate(editingFields)}
                  disabled={updateFieldsMutation.isPending}
                  className="btn-primary-sm"
                >
                  {updateFieldsMutation.isPending ? t('campaignPage.saving') : t('common.save')}
                </button>
              </div>
            )}
          </div>
          <div className="space-y-3">
            {typeDef.fields.map(f => (
              editingFields !== null ? (
                <DynamicField
                  key={f.name}
                  field={f}
                  value={editingFields[f.name] ?? ''}
                  onChange={v => setEditingFields(prev => ({ ...(prev ?? {}), [f.name]: v }))}
                  repoPath={repoPath}
                  interfaceRoles={schema?.roles?.map(r => r.name)}
                  onSubmit={() => { if (editingFields && !updateFieldsMutation.isPending) updateFieldsMutation.mutate(editingFields) }}
                />
              ) : (
                <div key={f.name}>
                  <p className="text-sm font-medium text-ink mb-1">{f.label ?? f.name}</p>
                  {f.type === 'richtext' ? (
                    <RichTextViewer value={getStringField(f.name)} repoPath={repoPath} />
                  ) : (
                    <p className="text-sm text-ink-2">{getStringField(f.name) || '—'}</p>
                  )}
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {campaign.baselineRef && (
        <p className="text-xs text-ink-2 mb-4">
          {t('campaignPage.baselineLabelPrefix')} <code className="font-mono">{campaign.baselineRef}</code>
        </p>
      )}

      {/* Progress summary */}
      {campaign.runs.length > 0 && (
        <div className="flex gap-3 mb-4 text-xs">
          {(['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE', 'pending'] as TestRunStatus[]).map(s => {
            const count = campaign.runs.filter(r => r.status === s).length
            if (count === 0) return null
            return (
              <span key={s} className={`px-2 py-0.5 rounded-full ${RUN_STATUS_CLASS[s]}`}>
                {count} {s}
              </span>
            )
          })}
        </div>
      )}

      {/* Add tests section */}
      {isActive && (
        <div className="mb-4">
          {!addingTests ? (
            <button
              type="button"
              onClick={() => {
                // T171 — prévisualisation relue à l'ouverture (base ou tests modifiés entre-temps).
                qc.invalidateQueries({ queryKey: ['campaign-param-preview'] })
                setAddingTests(true)
              }}
              className="text-xs text-status-info hover:opacity-80 border border-status-info-border rounded px-3 py-1.5"
            >
              + {t('campaignPage.addTests')}
            </button>
          ) : (
            <div className="border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium">
                  {t('campaignPage.addTestsSelected', { count: selectedToAdd.size })}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setAddingTests(false); setSelectedToAdd(new Set()); setAddParamValues({}); setTestFilter('') }}
                    className="text-xs text-ink-3 hover:text-ink"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmAdd}
                    disabled={selectedToAdd.size === 0 || isConfirmingAdd || previewLoading || !isParamsComplete(selectedToAdd, manualKeysById, addParamValues)}
                    className="btn-primary-sm"
                  >
                    {isConfirmingAdd ? t('campaignPage.adding') : t('campaignPage.addCount', { count: selectedToAdd.size })}
                  </button>
                </div>
              </div>
              {availableTests.length === 0 ? (
                <p className="text-xs text-ink-3 italic">{t('campaignPage.noApprovedTestAvailable')}</p>
              ) : (
                <>
                  <input
                    type="text"
                    value={testFilter}
                    onChange={e => setTestFilter(e.target.value)}
                    placeholder={t('common.filterPlaceholder')}
                    className="input-field w-full text-xs mb-2"
                  />
                  <div className="border border-edge rounded divide-y max-h-48 overflow-y-auto">
                    {filteredAvailable.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-ink-3 italic">{t('common.noResults')}</p>
                    ) : (
                      filteredAvailable.map(availableTest => {
                        const alreadyIncludedCount = campaign!.testCaseIds.filter(id => id === availableTest.id).length
                        return (
                        <div key={availableTest.id}>
                          <label className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-hover">
                            <input
                              type="checkbox"
                              checked={selectedToAdd.has(availableTest.id)}
                              onChange={() => toggleToAdd(availableTest.id)}
                              className="rounded"
                            />
                            <span className="font-mono text-ink-3 shrink-0">{availableTest.id}</span>
                            <span className="text-ink truncate">{availableTest.title}</span>
                            {alreadyIncludedCount > 0 && (
                              <span className="shrink-0 text-[10px] text-ink-3 italic ml-auto">
                                {t('campaignPage.alreadyPresent', { count: alreadyIncludedCount })}
                              </span>
                            )}
                          </label>
                          {selectedToAdd.has(availableTest.id) && (
                            <TestParamFields
                              labels={paramPreviews.get(availableTest.id)?.manual ?? []}
                              resolved={paramPreviews.get(availableTest.id)?.resolved}
                              unresolved={paramPreviews.get(availableTest.id)?.unresolved}
                              values={addParamValues[availableTest.id] ?? {}}
                              onChange={(label, value) => setAddParamValues(prev => ({
                                ...prev,
                                [availableTest.id]: { ...(prev[availableTest.id] ?? {}), [label]: value },
                              }))}
                            />
                          )}
                        </div>
                        )
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* T171 — notification persistante : instances avec des références non résolues. */}
      <UnresolvedParamsBanner runs={campaign.runs} />

      {/* Test case list */}
      <div className="border rounded divide-y mb-3">
        {campaign.runs.length === 0 ? (
          <p className="px-4 py-3 text-xs text-ink-3 italic">{t('campaignPage.noTestCaseInCampaign')}</p>
        ) : (
          campaign.runs.map(run => {
            const { entryId, testCaseId: tcId, status: runStatus, runId, paramValues } = run
            const tc = resolveRunTest(run, testMap)
            // Références à saisir de cette instance (les valeurs lues dans la base sont figées).
            const runManualKeys = tc ? manualKeysForRun(run, tc) : []
            const hasParams = runManualKeys.length > 0
            // État live du test, distinct de `tc` : "Dupliquer" crée une nouvelle instance dont
            // le snapshot sera pris sur l'état *actuel* du test (`duplicateTest()`), pas sur le
            // snapshot figé de l'entrée cliquée — l'icône et le panneau de saisie des paramètres
            // doivent donc refléter les paramètres live, sous peine de proposer des champs qui ne
            // correspondent plus au `{label}` réellement figé dans la nouvelle instance.
            const liveTc = testMap.get(tcId)
            const liveManualKeys = paramPreviews.get(tcId)?.manual ?? []
            const hasLiveParams = liveManualKeys.length > 0
            const isEditingParams = editingParamsFor === entryId
            const isDuplicating = duplicatingFor === entryId
            return (
              <div key={entryId}>
                <div
                  className={`flex items-center gap-3 px-3 py-2 ${!isActive ? 'cursor-pointer hover:bg-hover/50 transition-colors' : ''}`}
                  onClick={!isActive ? () => navigateToView(entryId) : undefined}
                >
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-xs text-ink-3">{tcId}</span>
                    {tc && (
                      <span className="text-xs text-ink ml-2 truncate">{tc.title}</span>
                    )}
                    {(run.unresolvedParams?.length ?? 0) > 0 && (
                      <span
                        className="ml-2 inline-flex items-center gap-0.5 text-[10px] text-status-warning"
                        title={run.unresolvedParams!.map(u => `{${u.ref}} — ${t(`campaignParams.reason.${u.reason}`)}`).join('\n')}
                      >
                        <AlertTriangle size={11} />{t('campaignParams.unresolvedCount', { count: run.unresolvedParams!.length })}
                      </span>
                    )}
                    {paramValues && Object.keys(paramValues).length > 0 && (
                      <span className="block text-[10px] font-mono text-ink-3 truncate">
                        {Object.entries(paramValues).map(([label, value]) => `${label}=${value}`).join(' · ')}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${RUN_STATUS_CLASS[runStatus]}`}>
                    {t(RUN_STATUS_LABEL_KEY[runStatus])}
                  </span>
                  {isActive && hasLiveParams && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        if (isDuplicating) { setDuplicatingFor(null) }
                        else { setDuplicatingFor(entryId); setDuplicateParamValues({}); setEditingParamsFor(null) }
                      }}
                      title={t('campaignPage.addAnotherInstance')}
                      className="shrink-0 text-ink-3 hover:text-ink p-1 rounded hover:bg-hover"
                    >
                      <Copy size={12} />
                    </button>
                  )}
                  {hasParams && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        if (isEditingParams) { setEditingParamsFor(null) }
                        else { startEditingParams(entryId); setDuplicatingFor(null) }
                      }}
                      title={t('campaignPage.editParamValues')}
                      className="shrink-0 text-ink-3 hover:text-ink p-1 rounded hover:bg-hover"
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                  {isActive && runId && (
                    <button
                      type="button"
                      onClick={() => navigateToView(entryId)}
                      title={t('campaignPage.viewResult')}
                      className="shrink-0 flex items-center gap-1 text-xs text-ink-3 hover:text-ink border border-edge rounded px-2 py-0.5 hover:bg-hover transition-colors"
                    >
                      <Eye size={11} />
                      {t('campaignPage.view')}
                    </button>
                  )}
                  {isActive && (
                    <button
                      type="button"
                      onClick={() => navigate({
                        to: '/campaign/$campaignId/execute/$testId',
                        params: { campaignId, testId: entryId },
                        search: { repoPath, projectId, component, level },
                      })}
                      title={t('campaignPage.executeThisTest')}
                      className="shrink-0 flex items-center gap-1 text-xs text-status-info hover:opacity-80 border border-status-info-border rounded px-2 py-0.5 hover:bg-status-info-bg transition-colors"
                    >
                      <Play size={11} />
                      {t('campaignPage.execute')}
                    </button>
                  )}
                </div>
                {isEditingParams && tc && (
                  <div className="px-3 pb-2">
                    <TestParamFields
                      labels={runManualKeys}
                      values={editParamValues}
                      onChange={(label, value) => setEditParamValues(prev => ({ ...prev, [label]: value }))}
                    />
                    <div className="flex gap-2 pl-8">
                      <button
                        type="button"
                        onClick={() => setEditingParamsFor(null)}
                        className="text-xs text-ink-3 hover:text-ink"
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateParamsMutation.mutate({ entryId, paramValues: editParamValues })}
                        disabled={updateParamsMutation.isPending || runManualKeys.some(label => !editParamValues[label]?.trim())}
                        className="btn-primary-sm"
                      >
                        {updateParamsMutation.isPending ? t('campaignPage.saving') : t('common.save')}
                      </button>
                    </div>
                  </div>
                )}
                {isDuplicating && liveTc && (
                  <div className="px-3 pb-2">
                    <p className="pl-6 text-[11px] text-ink-3 mb-1">{t('campaignPage.newInstanceOf', { tcId })}</p>
                    <TestParamFields
                      labels={liveManualKeys}
                      resolved={paramPreviews.get(tcId)?.resolved}
                      unresolved={paramPreviews.get(tcId)?.unresolved}
                      values={duplicateParamValues}
                      onChange={(label, value) => setDuplicateParamValues(prev => ({ ...prev, [label]: value }))}
                    />
                    <div className="flex gap-2 pl-8">
                      <button
                        type="button"
                        onClick={() => { setDuplicatingFor(null); setDuplicateParamValues({}) }}
                        className="text-xs text-ink-3 hover:text-ink"
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateTestMutation.mutate({ testCaseId: tcId, paramValues: duplicateParamValues })}
                        disabled={duplicateTestMutation.isPending || liveManualKeys.some(label => !duplicateParamValues[label]?.trim())}
                        className="btn-primary-sm"
                      >
                        {duplicateTestMutation.isPending ? t('campaignPage.adding') : t('campaignPage.duplicate')}
                      </button>
                    </div>
                  </div>
                )}
                {isActive && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); removeTestMutation.mutate(entryId) }}
                    disabled={removeTestMutation.isPending}
                    title={t('campaignPage.removeTestFromCampaign')}
                    className="shrink-0 text-ink-3 hover:text-status-danger p-1 rounded hover:bg-status-danger-bg transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 items-center flex-wrap">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="btn-secondary"
        >
          {t('layout.viewHeader.back')}
        </button>

        {isActive && (
          <>
            <button
              type="button"
              onClick={() => closeMutation.mutate('completed')}
              disabled={closeMutation.isPending}
              className="bg-status-success-solid text-status-success-fg rounded px-4 py-2 text-sm disabled:opacity-50 hover:opacity-90"
            >
              {closeMutation.isPending ? t('campaignPage.closing') : t('campaignPage.closeCampaign')}
            </button>
            <button
              type="button"
              onClick={() => closeMutation.mutate('abandoned')}
              disabled={closeMutation.isPending}
              className="border border-status-danger-border text-status-danger rounded px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {t('campaignPage.abandon')}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          title={t('campaignPage.deleteCampaignTitle')}
          className="ml-auto text-ink-3 hover:text-status-danger transition-colors p-1.5 rounded hover:bg-status-danger-bg"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40">
          <div className="bg-surface rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h2 className="text-base font-semibold mb-2">{t('sidebar.system.deleteCampaignTitle')}</h2>
            <p className="text-sm text-ink-2 mb-5">
              <Trans i18nKey="sidebar.system.deleteCampaignBody" values={{ title: campaign.title }} components={{ b: <strong /> }} />
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleteMutation.isPending}
                className="btn-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="btn-danger"
              >
                {deleteMutation.isPending ? t('campaignPage.deleting') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
      </div>
    </div>
    </RichTextProvider>
  )
}
