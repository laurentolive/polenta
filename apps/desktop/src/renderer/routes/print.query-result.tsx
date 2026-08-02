import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { QueryResult } from '@polenta/types'
import { ResultTable } from '../components/dashboard/ResultTable'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'

/**
 * Route imprimable — résultats de requête (T43 sprint 3). Contrairement aux autres routes
 * `/print/*`, ne recharge PAS ses données via un ID : un résultat de requête ad hoc n'a pas
 * toujours d'identifiant stable (requête non sauvegardée), donc pas de source à rouvrir de la même
 * façon que `print.requirements.tsx`/`print.impact-analysis.tsx` (cf.
 * `QueryResultExportPayload` dans `@polenta/types`, décision documentée dans specs/T43-design.md).
 * Le `QueryResult` complet transite en JSON dans les search params (`resultJson`) — pas de fetch
 * asynchrone à attendre, donc `useNotifyPrintReady(true)` inconditionnel.
 */
export const Route = createFileRoute('/print/query-result')({
  component: PrintQueryResultPage,
  validateSearch: (s: Record<string, unknown>) => ({
    queryName: (s['queryName'] as string) ?? '',
    resultJson: (s['resultJson'] as string) ?? '',
  }),
})

function PrintQueryResultPage() {
  const { t } = useTranslation()
  const { queryName, resultJson } = Route.useSearch()

  let result: QueryResult
  try {
    result = JSON.parse(resultJson) as QueryResult
  } catch {
    result = { columns: [], rows: [] }
  }

  useNotifyPrintReady(true)

  return (
    <div className="p-10 bg-print-bg text-print-ink text-sm min-h-screen">
      <h1 className="text-xl font-semibold mb-1">{t('printQueryResultPage.title', { queryName })}</h1>
      <p className="text-print-ink-2 mb-8">{t('dashboardPage.resultTable.rowCount', { count: result.rows.length })}</p>
      <ResultTable result={result} />
    </div>
  )
}
