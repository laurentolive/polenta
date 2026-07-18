import { createFileRoute } from '@tanstack/react-router'
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
      <h1 className="text-xl font-semibold mb-1">Cahier de campagne — {campaign.title}</h1>
      <p className="text-slate-500 mb-8">{campaign.id} — {resolved.length} test(s)</p>
      <div className="space-y-4">
        {resolved.map(({ run, test: t }) => (
          <section key={run.entryId} className="break-inside-avoid border-b border-slate-200 pb-3">
            <div className="font-mono text-xs text-slate-500">{t.id}</div>
            <h2 className="text-base font-medium">{t.title}</h2>
            <p className="text-xs text-slate-500">Statut : {t.status} — Type : {t.objectTypeRef}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
