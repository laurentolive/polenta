import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { requirementSuffix, resolveCampaignRuns } from '../lib/campaignTests'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'
import { useEntryRequirements } from '../hooks/useEntryRequirements'
import { entryRequirementIds } from '@polenta/types'
import { RUN_STATUS_LABEL_KEY } from '../lib/runStatus'

/** Route imprimable — rapport de campagne (T43 sprint 2), statut d'exécution par test. */
export const Route = createFileRoute('/print/campaign-report')({
  component: PrintCampaignReportPage,
  validateSearch: (s: Record<string, unknown>) => ({
    repoPath: (s['repoPath'] as string) ?? '',
    campaignId: (s['campaignId'] as string) ?? '',
    workspaceDir: (s['workspaceDir'] as string) ?? '',
  }),
})

function PrintCampaignReportPage() {
  const { t } = useTranslation()
  const { repoPath, campaignId, workspaceDir } = Route.useSearch()

  const { data: campaign, isSuccess: campaignLoaded } = useQuery({
    queryKey: ['print-campaign', repoPath, campaignId],
    queryFn: () => api.campaigns.get(repoPath, campaignId),
    enabled: !!repoPath && !!campaignId,
  })
  const { data: tests, isSuccess: testsLoaded } = useQuery({
    queryKey: ['print-tests', repoPath],
    queryFn: () => api.tests.list(repoPath),
    enabled: !!repoPath,
  })

  // GH442 — mêmes exigences que la grille (une erreur de lecture n'empêche pas l'impression : repli sur l'instance).
  const { data: requirements, isSuccess: reqLoaded, isError: reqFailed } = useEntryRequirements(repoPath, campaign, workspaceDir || undefined)

  useNotifyPrintReady(campaignLoaded && testsLoaded && (reqLoaded || reqFailed))

  if (!campaign || !tests) return <div className="p-10 bg-print-bg min-h-screen" />

  const resolved = resolveCampaignRuns(campaign, tests)

  return (
    <div className="p-10 bg-print-bg text-print-ink text-sm min-h-screen">
      <h1 className="text-xl font-semibold mb-1">{t('printCampaignReportPage.title', { title: campaign.title })}</h1>
      <p className="text-print-ink-2 mb-8">{t('printCampaignReportPage.idAndStatus', { id: campaign.id, status: campaign.status })}</p>
      <div className="space-y-4">
        {resolved.map(({ run, test: tc }) => {
          const status = run.status
          return (
            <section key={run.entryId} className="break-inside-avoid border-b border-print-border pb-3">
              <div className="font-mono text-xs text-print-ink-2">{tc.id}{requirementSuffix(requirements?.[run.entryId] ?? entryRequirementIds(run))}</div>
              <h2 className="text-base font-medium">{tc.title}</h2>
              <p className="text-xs font-medium mt-1">{t('printCampaignReportPage.result', { label: t(RUN_STATUS_LABEL_KEY[status]) })}</p>
              {run.executedAt && (
                <p className="text-xs text-print-ink-2">
                  {run.executedBy
                    ? t('printCampaignReportPage.executedOnBy', { date: run.executedAt, by: run.executedBy })
                    : t('printCampaignReportPage.executedOn', { date: run.executedAt })}
                </p>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
