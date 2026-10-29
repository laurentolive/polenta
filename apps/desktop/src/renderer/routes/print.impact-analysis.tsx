import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { ImpactNode } from '@polenta/types'
import { api } from '../api'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'
import { STATUS_LABEL_KEY } from '../lib/impactStatus'

/** Route imprimable — analyse d'impact d'un change (GH199, ex-analyse entre baselines T43).
 *  Recharge le change et son analyse via `repoPath` / `changeId` ; rendu en lecture seule. */
export const Route = createFileRoute('/print/impact-analysis')({
  component: PrintImpactAnalysisPage,
  validateSearch: (s: Record<string, unknown>) => ({
    repoPath: (s['repoPath'] as string) ?? '',
    changeId: (s['changeId'] as string) ?? '',
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
  const { repoPath, changeId } = Route.useSearch()

  const { data, isSuccess } = useQuery({
    queryKey: ['print-change-analysis', repoPath, changeId],
    queryFn: async () => {
      const [change, analysis] = await Promise.all([api.changes.get(repoPath, changeId), api.changes.analysis(repoPath, changeId)])
      return { change, analysis }
    },
    enabled: !!repoPath && !!changeId,
  })

  useNotifyPrintReady(isSuccess)

  if (!data) return <div className="p-10 bg-print-bg min-h-screen" />
  const { change, analysis } = data

  return (
    <div className="p-10 bg-print-bg text-print-ink text-sm min-h-screen">
      <h1 className="text-xl font-semibold mb-1">{t('printImpactAnalysisPage.title', { id: change.id, title: change.title })}</h1>
      <p className="text-print-ink-2 mb-8">
        {change.range ? `${change.range.from.ref} → ${change.range.to.ref} — ` : ''}
        {t('printImpactAnalysisPage.rootsCount', { count: analysis.roots.length })}
      </p>
      <div className="space-y-6">
        {analysis.roots.map(root => (
          <section key={root.elementId} className="break-inside-avoid border-b border-print-border pb-4">
            <div className="font-mono text-xs text-print-ink-2">{root.elementId}</div>
            <h2 className="text-base font-medium">{root.title}</h2>
            {root.descendantTree.length > 0 && (
              <>
                <p className="text-xs font-medium text-print-ink-2 mt-2">{t('printImpactAnalysisPage.descendantTree')}</p>
                {root.descendantTree.map(node => <ImpactNodeRow key={node.elementId} node={node} depth={0} />)}
              </>
            )}
            {root.ascendantTree.length > 0 && (
              <>
                <p className="text-xs font-medium text-print-ink-2 mt-2">{t('printImpactAnalysisPage.ascendantTree')}</p>
                {root.ascendantTree.map(node => <ImpactNodeRow key={node.elementId} node={node} depth={0} />)}
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
