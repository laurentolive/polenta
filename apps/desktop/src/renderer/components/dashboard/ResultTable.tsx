/**
 * ResultTable — renders a QueryResult as a plain HTML table for the Requêtes view
 * (T77 sprint 1). Handles the empty-result case explicitly (T77-tests.md cas
 * limite: "0 ligne" must show an explicit state, not a blank table).
 */

import { useTranslation } from 'react-i18next'
import type { QueryResult } from '@polenta/types'

function formatCell(v: unknown, booleanLabels: { true: string; false: string }): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? booleanLabels.true : booleanLabels.false
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function ResultTable({ result }: { result: QueryResult | null }) {
  const { t } = useTranslation()
  const booleanLabels = { true: t('dashboardPage.resultTable.booleanTrue'), false: t('dashboardPage.resultTable.booleanFalse') }

  if (!result) {
    return <p className="text-xs text-ink-3 py-6 text-center">{t('dashboardPage.resultTable.executeQueryHint')}</p>
  }

  if (result.rows.length === 0) {
    return <p className="text-xs text-ink-3 py-6 text-center">{t('dashboardPage.resultTable.noRowForQuery')}</p>
  }

  return (
    <div className="overflow-auto border border-edge rounded-lg max-h-[420px]">
      <table className="min-w-full text-xs">
        <thead className="bg-canvas sticky top-0">
          <tr>
            {result.columns.map((col) => (
              <th key={col.name} className="text-left font-medium text-ink-2 px-3 py-2 border-b border-edge whitespace-nowrap">
                {col.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-b border-edge-subtle last:border-0 hover:bg-hover">
              {result.columns.map((col) => (
                <td key={col.name} className="px-3 py-1.5 text-ink whitespace-nowrap">
                  {formatCell(row[col.name], booleanLabels)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-1.5 text-[11px] text-ink-3 border-t border-edge bg-canvas">
        {t('dashboardPage.resultTable.rowCount', { count: result.rows.length })}
      </p>
    </div>
  )
}
