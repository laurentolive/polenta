import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { RichTextViewer } from '../components/RichTextViewer'
import { ViewHeader } from '../components/layout/ViewHeader'
import { substituteParams } from '../lib/testParams'
import { useResolvedCampaignTest } from '../hooks/useResolvedCampaignTest'
import type { StepResultValue, TestRunResult } from '@polenta/types'

export const Route = createFileRoute('/campaign/$campaignId_/run/$testId')({
  component: TestRunViewPage,
  validateSearch: (search: Record<string, unknown>) => ({
    repoPath: (search['repoPath'] as string) ?? '',
    projectId: (search['projectId'] as string) ?? '',
    component: search['component'] as string | undefined,
    level: search['level'] as string | undefined,
  }),
})

const STEP_RESULT_CLASS: Record<StepResultValue, string> = {
  NOT_EXECUTED: 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-300',
  PASS:         'bg-green-100 text-green-700 dark:bg-green-800/40 dark:text-green-300',
  FAIL:         'bg-red-100 text-red-700 dark:bg-red-800/40 dark:text-red-300',
  BLOCKED:      'bg-orange-100 text-orange-700 dark:bg-orange-800/40 dark:text-orange-300',
  SKIP:         'bg-yellow-100 text-yellow-700 dark:bg-yellow-800/40 dark:text-yellow-300',
}

const STEP_RESULT_LABEL: Record<StepResultValue, string> = {
  NOT_EXECUTED: 'Non exécuté',
  PASS:         'Passé',
  FAIL:         'Échoué',
  BLOCKED:      'Bloqué',
  SKIP:         'Ignoré',
}

const GLOBAL_RESULT_CLASS: Record<TestRunResult, string> = {
  PASS:       'bg-green-100 text-green-700 dark:bg-green-800/40 dark:text-green-300',
  FAIL:       'bg-red-100 text-red-700 dark:bg-red-800/40 dark:text-red-300',
  BLOCKED:    'bg-orange-100 text-orange-700 dark:bg-orange-800/40 dark:text-orange-300',
  INCOMPLETE: 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-300',
}

const GLOBAL_RESULT_LABEL: Record<TestRunResult, string> = {
  PASS:       'Passé',
  FAIL:       'Échoué',
  BLOCKED:    'Bloqué',
  INCOMPLETE: 'Incomplet',
}

function TestRunViewPage() {
  // Le segment d'URL s'appelle historiquement "testId" mais porte désormais l'entryId de
  // l'inclusion du test dans la campagne (T97 sprint 2).
  const { campaignId, testId: entryId } = Route.useParams()
  const navigate = useNavigate()
  const { repoPath, projectId, component, level } = Route.useSearch()

  const { data: campaign, isLoading: loadingCampaign } = useQuery({
    queryKey: ['campaign', repoPath, campaignId],
    queryFn: () => api.campaigns.get(repoPath, campaignId),
    enabled: !!repoPath,
  })

  const campaignRun = campaign?.runs.find(r => r.entryId === entryId)
  const testCaseId = campaignRun?.testCaseId
  const runId = campaignRun?.runId
  const paramValues = campaignRun?.paramValues

  const { testCase: tc, isLoading: loadingTc } = useResolvedCampaignTest(repoPath, testCaseId, campaignRun?.testSnapshot)

  const { data: runs = [], isLoading: loadingRuns } = useQuery({
    queryKey: ['test-runs', repoPath, testCaseId],
    queryFn: () => api.tests.runs(repoPath, testCaseId!),
    enabled: !!repoPath && !!runId && !!testCaseId,
  })

  const run = runId ? runs.find(r => r.id === runId) : undefined

  if (!repoPath) return <p className="p-6 text-sm text-ink-2">Paramètre <code>repoPath</code> manquant.</p>
  if (loadingCampaign || loadingTc || (!!runId && loadingRuns)) return <p className="p-6 text-sm text-ink-3">Chargement…</p>
  if (!campaignRun) return <p className="p-6 text-sm text-ink-2">Entrée de campagne introuvable : {entryId}</p>
  if (!tc) return <p className="p-6 text-sm text-ink-2">Cas de test introuvable : {testCaseId}</p>

  const sortedSteps = [...(tc.steps ?? [])].sort((a, b) => a.order - b.order)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        back={{
          label: 'Retour à la campagne',
          onClick: () => navigate({
            to: '/campaign/$campaignId',
            params: { campaignId },
            search: { repoPath, projectId, component, level },
          }),
        }}
        title={tc.title}
        subtitle={<span className="font-mono">{tc.id}</span>}
        actions={
          <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300">
            {tc.status}
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl p-6">
      {/* Execution result badge */}
      <div className="mb-6">
        {run ? (
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${GLOBAL_RESULT_CLASS[run.result]}`}>
            <span>{GLOBAL_RESULT_LABEL[run.result]}</span>
            <span className="text-xs opacity-70">
              · {new Date(run.executedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
              · {run.executedBy}
            </span>
          </div>
        ) : (
          <div className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-500 dark:bg-gray-700/40 dark:text-gray-400">
            Non exécuté
          </div>
        )}
      </div>

      <div className="space-y-6">
        {/* Preconditions */}
        {tc.preconditions && (
          <div>
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">Préconditions</p>
            <div className="border border-edge rounded px-3 py-2 bg-hover">
              <RichTextViewer value={substituteParams(tc.preconditions, paramValues)} repoPath={repoPath} />
            </div>
          </div>
        )}

        {/* Steps */}
        {sortedSteps.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">Étapes</p>
            <div className="space-y-3">
              {sortedSteps.map((step, idx) => {
                const stepResult = run?.stepResults.find(sr => sr.order === step.order)
                return (
                  <div key={step.order} className="border border-edge rounded">
                    {/* Step header */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-hover border-b border-edge">
                      <span className="text-xs font-mono text-ink-3 shrink-0">#{idx + 1}</span>
                      {stepResult && (
                        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${STEP_RESULT_CLASS[stepResult.result]}`}>
                          {STEP_RESULT_LABEL[stepResult.result]}
                        </span>
                      )}
                    </div>

                    {/* Step body: action + expected result */}
                    <div className="grid grid-cols-2 gap-0 divide-x divide-edge">
                      <div className="px-3 py-2">
                        <p className="text-xs text-ink-3 mb-1">Action</p>
                        <RichTextViewer value={substituteParams(step.action, paramValues)} repoPath={repoPath} />
                      </div>
                      <div className="px-3 py-2">
                        <p className="text-xs text-ink-3 mb-1">Résultat attendu</p>
                        <RichTextViewer value={substituteParams(step.expectedResult, paramValues)} repoPath={repoPath} />
                      </div>
                    </div>

                    {/* Step comment from run */}
                    {stepResult?.comment && (
                      <div className="px-3 pb-2 pt-1 border-t border-edge">
                        <p className="text-xs text-ink-3 mb-1">Commentaire</p>
                        <RichTextViewer value={stepResult.comment} repoPath={repoPath} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Postconditions */}
        {tc.postconditions && (
          <div>
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">Postconditions</p>
            <div className="border border-edge rounded px-3 py-2 bg-hover">
              <RichTextViewer value={substituteParams(tc.postconditions, paramValues)} repoPath={repoPath} />
            </div>
          </div>
        )}

        {/* Global run notes */}
        {run?.notes && (
          <div>
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">Notes générales</p>
            <div className="border border-edge rounded px-3 py-2 bg-hover">
              <RichTextViewer value={run.notes} repoPath={repoPath} />
            </div>
          </div>
        )}
      </div>
      </div>
      </div>
    </div>
  )
}
