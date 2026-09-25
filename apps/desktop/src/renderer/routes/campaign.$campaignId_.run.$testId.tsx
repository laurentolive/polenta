import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation, Trans } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { RichTextViewer } from '../components/RichTextViewer'
import { ViewHeader } from '../components/layout/ViewHeader'
import { FrozenParamRefProvider } from '../contexts/ParamRefContext'
import { isT171Run, substituteRunParams } from '../lib/testParams'
import { RunParamsInfo } from '../components/RunParamsInfo'
import { useResolvedCampaignTest } from '../hooks/useResolvedCampaignTest'
import { toIntlLocale } from '../i18n/useLocale'
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
  NOT_EXECUTED: 'bg-status-neutral-bg text-status-neutral',
  PASS:         'bg-status-success-bg text-status-success',
  FAIL:         'bg-status-danger-bg text-status-danger',
  BLOCKED:      'bg-status-warning-bg text-status-warning',
  SKIP:         'bg-status-warning-bg text-status-warning',
}

const STEP_RESULT_LABEL_KEY: Record<StepResultValue, string> = {
  NOT_EXECUTED: 'campaignPage.stepResult.notExecuted',
  PASS:         'campaignPage.runStatus.pass',
  FAIL:         'campaignPage.runStatus.fail',
  BLOCKED:      'campaignPage.runStatus.blocked',
  SKIP:         'campaignPage.stepResult.skip',
}

const GLOBAL_RESULT_CLASS: Record<TestRunResult, string> = {
  PASS:       'bg-status-success-bg text-status-success',
  FAIL:       'bg-status-danger-bg text-status-danger',
  BLOCKED:    'bg-status-warning-bg text-status-warning',
  INCOMPLETE: 'bg-status-neutral-bg text-status-neutral',
}

const GLOBAL_RESULT_LABEL_KEY: Record<TestRunResult, string> = {
  PASS:       'campaignPage.runStatus.pass',
  FAIL:       'campaignPage.runStatus.fail',
  BLOCKED:    'campaignPage.runStatus.blocked',
  INCOMPLETE: 'campaignPage.runStatus.incomplete',
}

function TestRunViewPage() {
  const { t, i18n } = useTranslation()
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

  // T171 — instance T171 : texte brut, les références sont rendues par FrozenParamRefProvider.
  // Instance antérieure (T97) : substitution d'origine en amont, code Markdown compris.
  const runText = (text: string) => (isT171Run(campaignRun) ? text : substituteRunParams(text, campaignRun))
  const { testCase: tc, isLoading: loadingTc } = useResolvedCampaignTest(repoPath, testCaseId, campaignRun?.testSnapshot)

  const { data: runs = [], isLoading: loadingRuns } = useQuery({
    queryKey: ['test-runs', repoPath, testCaseId],
    queryFn: () => api.tests.runs(repoPath, testCaseId!),
    enabled: !!repoPath && !!runId && !!testCaseId,
  })

  const run = runId ? runs.find(r => r.id === runId) : undefined

  if (!repoPath) return <p className="p-6 text-sm text-ink-2"><Trans i18nKey="testsPage.missingRepoPath" components={{ code: <code /> }} /></p>
  if (loadingCampaign || loadingTc || (!!runId && loadingRuns)) return <p className="p-6 text-sm text-ink-3">{t('common.loading')}</p>
  if (!campaignRun) return <p className="p-6 text-sm text-ink-2">{t('campaignPage.entryNotFound', { entryId })}</p>
  if (!tc) return <p className="p-6 text-sm text-ink-2">{t('testsPage.notFound', { testId: testCaseId })}</p>

  const sortedSteps = [...(tc.steps ?? [])].sort((a, b) => a.order - b.order)

  return (
    <FrozenParamRefProvider run={campaignRun}>
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        back={{
          label: t('campaignPage.backToCampaign'),
          onClick: () => navigate({
            to: '/campaign/$campaignId',
            params: { campaignId },
            search: { repoPath, projectId, component, level },
          }),
        }}
        title={tc.title}
        subtitle={<span className="font-mono">{tc.id}</span>}
        actions={
          <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-status-neutral-bg text-status-neutral">
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
            <span>{t(GLOBAL_RESULT_LABEL_KEY[run.result])}</span>
            <span className="text-xs opacity-70">
              · {new Date(run.executedAt).toLocaleDateString(toIntlLocale(i18n.language), { day: 'numeric', month: 'long', year: 'numeric' })}
              · {run.executedBy}
            </span>
          </div>
        ) : (
          <div className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-status-neutral-bg text-status-neutral">
            {t('campaignPage.stepResult.notExecuted')}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <RunParamsInfo run={campaignRun} />
        {/* Preconditions */}
        {tc.preconditions && (
          <div>
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">{t('testsPage.preconditions')}</p>
            <div className="border border-edge rounded px-3 py-2 bg-hover">
              <RichTextViewer value={runText(tc.preconditions)} repoPath={repoPath} />
            </div>
          </div>
        )}

        {/* Steps */}
        {sortedSteps.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">{t('system.wordView.stepsHeading')}</p>
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
                          {t(STEP_RESULT_LABEL_KEY[stepResult.result])}
                        </span>
                      )}
                    </div>

                    {/* Step body: action + expected result */}
                    <div className="grid grid-cols-2 gap-0 divide-x divide-edge">
                      <div className="px-3 py-2">
                        <p className="text-xs text-ink-3 mb-1">{t('system.stepsTable.action')}</p>
                        <RichTextViewer value={runText(step.action)} repoPath={repoPath} />
                      </div>
                      <div className="px-3 py-2">
                        <p className="text-xs text-ink-3 mb-1">{t('system.stepsTable.expectedResult')}</p>
                        <RichTextViewer value={runText(step.expectedResult)} repoPath={repoPath} />
                      </div>
                    </div>

                    {/* Step comment from run */}
                    {stepResult?.comment && (
                      <div className="px-3 pb-2 pt-1 border-t border-edge">
                        <p className="text-xs text-ink-3 mb-1">{t('campaignPage.comment')}</p>
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
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">{t('testsPage.postconditions')}</p>
            <div className="border border-edge rounded px-3 py-2 bg-hover">
              <RichTextViewer value={runText(tc.postconditions)} repoPath={repoPath} />
            </div>
          </div>
        )}

        {/* Global run notes */}
        {run?.notes && (
          <div>
            <p className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">{t('campaignPage.generalNotes')}</p>
            <div className="border border-edge rounded px-3 py-2 bg-hover">
              <RichTextViewer value={run.notes} repoPath={repoPath} />
            </div>
          </div>
        )}
      </div>
      </div>
      </div>
    </div>
    </FrozenParamRefProvider>
  )
}
