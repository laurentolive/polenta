import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { api } from '../api'
import { RichTextField } from '../components/RichTextField'
import { RichTextViewer } from '../components/RichTextViewer'
import { RichTextProvider } from '../contexts/RichTextContext'
import { RichTextToolbar } from '../components/system/RichTextToolbar'
import { ViewHeader } from '../components/layout/ViewHeader'
import { substituteParams } from '../lib/testParams'
import { useResolvedCampaignTest } from '../hooks/useResolvedCampaignTest'
import type { TestRunResult, StepResultValue } from '@polenta/types'

export const Route = createFileRoute('/campaign/$campaignId_/execute/$testId')({
  component: ExecuteTestPage,
  validateSearch: (search: Record<string, unknown>) => ({
    repoPath: (search['repoPath'] as string) ?? '',
    projectId: (search['projectId'] as string) ?? '',
    component: search['component'] as string | undefined,
    level: search['level'] as string | undefined,
  }),
})

const STEP_RESULT_OPTIONS: { value: StepResultValue; label: string; cls: string }[] = [
  { value: 'NOT_EXECUTED', label: 'Non exécuté', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-300' },
  { value: 'PASS',         label: 'Passé',        cls: 'bg-green-100 text-green-700 dark:bg-green-800/40 dark:text-green-300' },
  { value: 'FAIL',         label: 'Échoué',       cls: 'bg-red-100 text-red-700 dark:bg-red-800/40 dark:text-red-300' },
  { value: 'BLOCKED',      label: 'Bloqué',       cls: 'bg-orange-100 text-orange-700 dark:bg-orange-800/40 dark:text-orange-300' },
  { value: 'SKIP',         label: 'Ignoré',       cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-800/40 dark:text-yellow-300' },
]

const GLOBAL_RESULT_OPTIONS: { value: TestRunResult; label: string }[] = [
  { value: 'PASS',       label: 'Passé' },
  { value: 'FAIL',       label: 'Échoué' },
  { value: 'BLOCKED',    label: 'Bloqué' },
  { value: 'INCOMPLETE', label: 'Incomplet' },
]

interface StepExecState {
  order: number
  result: StepResultValue
  comment: string
}

function computeGlobalResult(stepResults: StepResultValue[]): TestRunResult {
  if (stepResults.some(r => r === 'FAIL')) return 'FAIL'
  if (stepResults.some(r => r === 'BLOCKED')) return 'BLOCKED'
  if (stepResults.some(r => r === 'NOT_EXECUTED')) return 'INCOMPLETE'
  return 'PASS'
}

function mapResultToStatus(result: TestRunResult) {
  switch (result) {
    case 'PASS': return 'PASS' as const
    case 'FAIL': return 'FAIL' as const
    case 'BLOCKED': return 'BLOCKED' as const
    case 'INCOMPLETE': return 'INCOMPLETE' as const
  }
}

function ExecuteTestPage() {
  // Le segment d'URL s'appelle historiquement "testId" mais porte désormais l'entryId de
  // l'inclusion du test dans la campagne (un même test peut être inclus plusieurs fois
  // s'il a des paramètres — T97 sprint 2).
  const { campaignId, testId: entryId } = Route.useParams()
  const { repoPath, projectId, component, level } = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: campaign, isLoading: loadingCampaign } = useQuery({
    queryKey: ['campaign', repoPath, campaignId],
    queryFn: () => api.campaigns.get(repoPath, campaignId),
    enabled: !!repoPath,
  })
  const entry = campaign?.runs.find(r => r.entryId === entryId)
  const testCaseId = entry?.testCaseId
  const paramValues = entry?.paramValues

  const { testCase, isLoading: loadingTest } = useResolvedCampaignTest(repoPath, testCaseId, entry?.testSnapshot)

  const sortedSteps = [...(testCase?.steps ?? [])].sort((a, b) => a.order - b.order)

  const [stepStates, setStepStates] = useState<StepExecState[]>([])
  const [globalNotes, setGlobalNotes] = useState('')
  const [globalResult, setGlobalResult] = useState<TestRunResult>('INCOMPLETE')
  const [resultOverridden, setResultOverridden] = useState(false)
  const [execError, setExecError] = useState<string | null>(null)

  useEffect(() => {
    if (testCase) {
      setStepStates(
        [...(testCase.steps ?? [])].sort((a, b) => a.order - b.order).map(s => ({
          order: s.order,
          result: 'NOT_EXECUTED' as StepResultValue,
          comment: '',
        }))
      )
    }
  }, [testCase])

  useEffect(() => {
    if (!resultOverridden) {
      setGlobalResult(computeGlobalResult(stepStates.map(s => s.result)))
    }
  }, [stepStates, resultOverridden])

  const executeMutation = useMutation({
    mutationFn: async () => {
      const run = await api.tests.execute(repoPath, testCaseId!, {
        stepResults: stepStates.map(s => ({ order: s.order, result: s.result, comment: s.comment })),
        notes: globalNotes.trim() || undefined,
        result: globalResult,
      })
      const campaignStatus = mapResultToStatus(globalResult)
      await api.campaigns.updateRun(repoPath, campaignId, entryId, campaignStatus, run.id)
      return run
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', repoPath, campaignId] })
      qc.invalidateQueries({ queryKey: ['campaigns', repoPath] })
      navigate({
        to: '/campaign/$campaignId',
        params: { campaignId },
        search: { repoPath, projectId, component, level },
      })
    },
    onError: (err: unknown) => {
      setExecError(err instanceof Error ? err.message : 'Erreur inconnue')
    },
  })

  function goBack() {
    navigate({
      to: '/campaign/$campaignId',
      params: { campaignId },
      search: { repoPath, projectId, component, level },
    })
  }

  function setStepResult(order: number, result: StepResultValue) {
    setStepStates(prev => prev.map(s => s.order === order ? { ...s, result } : s))
  }

  function setStepComment(order: number, comment: string) {
    setStepStates(prev => prev.map(s => s.order === order ? { ...s, comment } : s))
  }

  if (!repoPath) {
    return <p className="p-6 text-sm text-ink-2">Paramètre <code>repoPath</code> manquant.</p>
  }
  if (loadingCampaign || loadingTest) return <p className="p-6 text-sm text-ink-3">Chargement…</p>
  if (!entry) return <p className="p-6 text-sm text-ink-2">Entrée de campagne introuvable : {entryId}</p>
  if (!testCase) return <p className="p-6 text-sm text-ink-2">Test introuvable : {testCaseId}</p>

  return (
    <RichTextProvider>
      <div className="flex flex-col h-full">
        <ViewHeader
          currentProjectId={projectId}
          back={{ label: 'Retour', onClick: goBack }}
          title={
            <>
              <span className="text-xs font-mono text-ink-3 mr-2">{testCase.id}</span>
              {testCase.title}
            </>
          }
          actions={
            <>
              <RichTextToolbar repoPath={repoPath} />
              <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300">
                {testCase.status}
              </span>
            </>
          }
        />

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
            {/* Preconditions */}
            {testCase.preconditions && (
              <div>
                <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">Préconditions</p>
                <div className="text-sm text-ink border border-edge rounded px-4 py-3 bg-hover/30">
                  <RichTextViewer value={substituteParams(testCase.preconditions, paramValues)} repoPath={repoPath} />
                </div>
              </div>
            )}

            {/* Steps */}
            <div>
              <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-3">Étapes</p>
              <div className="space-y-4">
                {sortedSteps.map((step, idx) => {
                  const state = stepStates.find(s => s.order === step.order)
                  const resultValue = state?.result ?? 'NOT_EXECUTED'
                  const opt = STEP_RESULT_OPTIONS.find(o => o.value === resultValue) ?? STEP_RESULT_OPTIONS[0]
                  return (
                    <div key={step.order} className="border border-edge rounded overflow-hidden">
                      {/* Step header */}
                      <div className="flex items-center gap-3 px-4 py-2.5 bg-hover/20 border-b border-edge">
                        <span className="text-xs font-mono text-ink-3 shrink-0">#{idx + 1}</span>
                        <select
                          value={resultValue}
                          onChange={e => setStepResult(step.order, e.target.value as StepResultValue)}
                          className={`text-xs border rounded px-2 py-1 ml-auto ${opt.cls}`}
                        >
                          {STEP_RESULT_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Step action + expected result */}
                      <div className="grid grid-cols-2 divide-x divide-edge">
                        <div className="px-4 py-3">
                          <p className="text-xs text-ink-3 mb-1.5">Action</p>
                          <RichTextViewer value={substituteParams(step.action, paramValues)} repoPath={repoPath} />
                        </div>
                        <div className="px-4 py-3">
                          <p className="text-xs text-ink-3 mb-1.5">Résultat attendu</p>
                          <RichTextViewer value={substituteParams(step.expectedResult, paramValues)} repoPath={repoPath} />
                        </div>
                      </div>

                      {/* Step comment */}
                      <div className="px-4 pb-3 pt-2 border-t border-edge">
                        <p className="text-xs text-ink-3 mb-1.5">Commentaire</p>
                        <RichTextField
                          value={state?.comment ?? ''}
                          onChange={v => setStepComment(step.order, v)}
                          placeholder="Observations sur cette étape (optionnel)…"
                          repoPath={repoPath}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Postconditions */}
            {testCase.postconditions && (
              <div>
                <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">Postconditions</p>
                <div className="text-sm text-ink border border-edge rounded px-4 py-3 bg-hover/30">
                  <RichTextViewer value={substituteParams(testCase.postconditions, paramValues)} repoPath={repoPath} />
                </div>
              </div>
            )}

            {/* Global comment */}
            <div>
              <label className="block text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">
                Commentaire global
              </label>
              <RichTextField
                value={globalNotes}
                onChange={setGlobalNotes}
                placeholder="Observations générales, contexte d'exécution…"
                repoPath={repoPath}
              />
            </div>

            {/* Global result */}
            <div>
              <label className="block text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">
                Résultat global
              </label>
              <div className="flex items-center gap-3">
                <select
                  value={globalResult}
                  onChange={e => {
                    setGlobalResult(e.target.value as TestRunResult)
                    setResultOverridden(true)
                  }}
                  className="input-field text-sm"
                >
                  {GLOBAL_RESULT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {resultOverridden && (
                  <button
                    type="button"
                    onClick={() => {
                      setResultOverridden(false)
                      setGlobalResult(computeGlobalResult(stepStates.map(s => s.result)))
                    }}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    Recalculer depuis les étapes
                  </button>
                )}
              </div>
            </div>

            {execError && (
              <p className="text-sm text-red-500">{execError}</p>
            )}
          </div>
        </div>

        {/* Sticky footer */}
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-edge bg-surface shrink-0">
          <button
            type="button"
            onClick={goBack}
            disabled={executeMutation.isPending}
            className="btn-secondary"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => executeMutation.mutate()}
            disabled={executeMutation.isPending}
            className="btn-primary"
          >
            {executeMutation.isPending ? 'Enregistrement…' : 'Soumettre le résultat'}
          </button>
        </div>
      </div>
    </RichTextProvider>
  )
}
