import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { resolveCampaignRuns } from '../lib/campaignTests'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'

/** Route imprimable — cahier de campagne (T43 sprint 2), plan des tests inclus sans statut
 *  d'exécution. Recharge campagne + tests à partir de `campaignId`/`repoPath`, comme
 *  `print.requirements.tsx` recharge ses exigences (décision structurante de specs/T43-design.md). */
export const Route = createFileRoute('/print/campaign-plan')({
  component: PrintCampaignPlanPage,
  validateSearch: (s: Record<string, unknown>) => ({
    repoPath: (s['repoPath'] as string) ?? '',
    campaignId: (s['campaignId'] as string) ?? '',
  }),
})

function PrintCampaignPlanPage() {
  const { t } = useTranslation()
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

  if (!campaign || !tests) return <div className="p-10 bg-print-bg min-h-screen" />

  const resolved = resolveCampaignRuns(campaign, tests)

  return (
    <div className="p-10 bg-print-bg text-print-ink text-sm min-h-screen">
      <h1 className="text-xl font-semibold mb-1">{t('printCampaignPlanPage.title', { title: campaign.title })}</h1>
      <p className="text-print-ink-2 mb-8">{campaign.id} — {t('printCampaignPlanPage.testCount', { count: resolved.length })}</p>
      <div className="space-y-4">
        {resolved.map(({ run, test: tc }) => (
          <section key={run.entryId} className="break-inside-avoid border-b border-print-border pb-3">
            <div className="font-mono text-xs text-print-ink-2">{tc.id}</div>
            <h2 className="text-base font-medium">{tc.title}</h2>
            <p className="text-xs text-print-ink-2">{t('printCampaignPlanPage.statusType', { status: tc.status, type: tc.objectTypeRef })}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
