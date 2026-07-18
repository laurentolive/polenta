import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { ImpactNode } from '@polenta/types'
import { api } from '../api'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'

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
  return (
    <>
      <div className="text-xs py-1 border-b border-slate-100" style={{ paddingLeft: `${depth * 16}px` }}>
        <span className="font-mono text-slate-500">{node.elementId}</span>
        <span className="ml-2">{node.title}</span>
        <span className="ml-2 text-slate-400">({node.linkType})</span>
        <span className="ml-2 font-medium">{node.status}</span>
      </div>
      {node.children.map(child => (
        <ImpactNodeRow key={child.elementId} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

function PrintImpactAnalysisPage() {
  const { repoPath, analysisId } = Route.useSearch()

  const { data: analysis, isSuccess } = useQuery({
    queryKey: ['print-impact-analysis', repoPath, analysisId],
    queryFn: () => api.impactAnalysis.get(repoPath, analysisId),
    enabled: !!repoPath && !!analysisId,
  })

  useNotifyPrintReady(isSuccess)

  if (!analysis) return <div className="p-10 bg-white min-h-screen" />

  return (
    <div className="p-10 bg-white text-slate-900 text-sm min-h-screen">
      <h1 className="text-xl font-semibold mb-1">
        Analyse d'impact — {analysis.fromBaseline.tag} → {analysis.toBaseline.tag}
      </h1>
      <p className="text-slate-500 mb-8">
        {analysis.label} — {analysis.changedRequirements.length} exigence(s) modifiée(s)
      </p>
      <div className="space-y-6">
        {analysis.changedRequirements.map(req => (
          <section key={req.reqId} className="break-inside-avoid border-b border-slate-200 pb-4">
            <div className="font-mono text-xs text-slate-500">{req.reqId}</div>
            <h2 className="text-base font-medium">{req.title}</h2>
            <p className="text-xs text-slate-500 mb-2">Type de changement : {req.changeType}</p>
            {req.descendantTree.length > 0 && (
              <>
                <p className="text-xs font-medium text-slate-600 mt-2">Arbre descendant</p>
                {req.descendantTree.map(node => (
                  <ImpactNodeRow key={node.elementId} node={node} depth={0} />
                ))}
              </>
            )}
            {req.ascendantTree.length > 0 && (
              <>
                <p className="text-xs font-medium text-slate-600 mt-2">Arbre ascendant</p>
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
