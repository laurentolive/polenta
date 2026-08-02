import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { ImpactNode } from '@polenta/types'
import { api } from '../api'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'
import { CHANGE_TYPE_LABEL_KEY, STATUS_LABEL_KEY } from './impact-analysis'

/** Route imprimable — analyse d'impact (T43 sprint 3). Contrairement à `print.query-result.tsx`,
 *  une analyse d'impact est un objet persisté avec un ID stable — suit le pattern standard
 *  (recharge via `repoPath`/`analysisId`, cf. `print.requirements.tsx`). Rendu simplifié en lecture
 *  seule (pas d'édition de statut/commentaire, contrairement à `impact-analysis.tsx`). */
export const Route = createFileRoute('/print/impact-analysis')({
  component: PrintImpactAnalysisPage,
  validateSearch: (s: Record<string, unknown>) => ({
    repoPath: (s['repoPath'] as string) ?? '',
    analysisId: (s['analysisId'] as string) ?? '',
  }),
})

function ImpactNodeRow({ node, depth }: { node: ImpactNode; depth: number }) {
  const { t } = useTranslation()
  return (
    <>
      <div className="text-xs py-1 border-b border-print-border" style={{ paddingLeft: `${depth * 16}px` }}>
        <span className="font-mono text-print-ink-2">{node.elementId}</span>
        <span className="ml-2">{node.title}</span>
        <span className="ml-2 text-print-ink-2">({node.linkType})</span>
        <span className="ml-2 font-medium">{t(STATUS_LABEL_KEY[node.status])}</span>
      </div>
      {node.children.map(child => (
        <ImpactNodeRow key={child.elementId} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

function PrintImpactAnalysisPage() {
  const { t } = useTranslation()
  const { repoPath, analysisId } = Route.useSearch()

  const { data: analysis, isSuccess } = useQuery({
    queryKey: ['print-impact-analysis', repoPath, analysisId],
    queryFn: () => api.impactAnalysis.get(repoPath, analysisId),
    enabled: !!repoPath && !!analysisId,
  })

  useNotifyPrintReady(isSuccess)

  if (!analysis) return <div className="p-10 bg-print-bg min-h-screen" />

  return (
    <div className="p-10 bg-print-bg text-print-ink text-sm min-h-screen">
      <h1 className="text-xl font-semibold mb-1">
        {t('printImpactAnalysisPage.title', { from: analysis.fromBaseline.tag, to: analysis.toBaseline.tag })}
      </h1>
      <p className="text-print-ink-2 mb-8">
        {analysis.label} — {t('printImpactAnalysisPage.changedRequirementsCount', { count: analysis.changedRequirements.length })}
      </p>
      <div className="space-y-6">
        {analysis.changedRequirements.map(req => (
          <section key={req.reqId} className="break-inside-avoid border-b border-print-border pb-4">
            <div className="font-mono text-xs text-print-ink-2">{req.reqId}</div>
            <h2 className="text-base font-medium">{req.title}</h2>
            <p className="text-xs text-print-ink-2 mb-2">{t('printImpactAnalysisPage.changeType', { type: t(CHANGE_TYPE_LABEL_KEY[req.changeType]) })}</p>
            {req.descendantTree.length > 0 && (
              <>
                <p className="text-xs font-medium text-print-ink-2 mt-2">{t('printImpactAnalysisPage.descendantTree')}</p>
                {req.descendantTree.map(node => (
                  <ImpactNodeRow key={node.elementId} node={node} depth={0} />
                ))}
              </>
            )}
            {req.ascendantTree.length > 0 && (
              <>
                <p className="text-xs font-medium text-print-ink-2 mt-2">{t('printImpactAnalysisPage.ascendantTree')}</p>
                {req.ascendantTree.map(node => (
                  <ImpactNodeRow key={node.elementId} node={node} depth={0} />
                ))}
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
