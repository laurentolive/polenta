import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { TEST_RUN_STATUS_LABELS } from '@polenta/types'
import { api } from '../api'
import { resolveCampaignRuns } from '../lib/campaignTests'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'

/** Route imprimable — rapport de campagne (T43 sprint 2), statut d'exécution par test. */
export const Route = createFileRoute('/print/campaign-report')({
  component: PrintCampaignReportPage,
  validateSearch: (s: Record<string, unknown>) => ({
    repoPath: (s['repoPath'] as string) ?? '',
    campaignId: (s['campaignId'] as string) ?? '',
  }),
})

function PrintCampaignReportPage() {
  const { repoPath, campaignId } = Route.useSearch()

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

  useNotifyPrintReady(campaignLoaded && testsLoaded)

  if (!campaign || !tests) return <div className="p-10 bg-white min-h-screen" />

  const resolved = resolveCampaignRuns(campaign, tests)

  return (
    <div className="p-10 bg-white text-slate-900 text-sm min-h-screen">
      <h1 className="text-xl font-semibold mb-1">Rapport de campagne — {campaign.title}</h1>
      <p className="text-slate-500 mb-8">{campaign.id} — statut : {campaign.status}</p>
      <div className="space-y-4">
        {resolved.map(({ run, test: t }) => {
          const status = run.status
          return (
            <section key={run.entryId} className="break-inside-avoid border-b border-slate-200 pb-3">
              <div className="font-mono text-xs text-slate-500">{t.id}</div>
              <h2 className="text-base font-medium">{t.title}</h2>
              <p className="text-xs font-medium mt-1">Résultat : {TEST_RUN_STATUS_LABELS[status]}</p>
              {run.executedAt && (
                <p className="text-xs text-slate-500">
                  Exécuté le {run.executedAt}{run.executedBy ? ` par ${run.executedBy}` : ''}
                </p>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
