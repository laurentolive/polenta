/**
 * KpiWidget — "juste une grosse valeur + libellé" (T77-design.md), no chart. Only
 * `fieldMapping.measure` is used. Aggregation choice: a single-row result shows that
 * row's value as-is; a multi-row result sums `measure` across rows (a KPI needing a
 * different aggregate — average, max… — isn't covered here, since there's no
 * aggregation picker in `WidgetConfigModal`; the underlying query is expected to
 * already return the right shape, e.g. via `GROUP BY`/`COUNT(*)`).
 */
import type { QueryResult, WidgetFieldMapping } from '@polenta/types'
import { WidgetEmptyState } from './WidgetEmptyState'
import { formatNumber, toNumber } from './numeric'

interface Props {
  result: QueryResult | null
  fieldMapping: WidgetFieldMapping
}

export function KpiWidget({ result, fieldMapping }: Props) {
  const { measure } = fieldMapping
  if (!measure) return <WidgetEmptyState message="Choisissez une mesure." />

  const rows = result?.rows ?? []
  if (rows.length === 0) return <WidgetEmptyState message="Aucune donnée pour cette requête." />

  const value = rows.length === 1 ? toNumber(rows[0][measure]) : rows.reduce((sum, r) => sum + toNumber(r[measure]), 0)

  return (
    <div className="flex flex-col items-center justify-center h-full gap-1">
      <span className="text-4xl font-semibold text-ink tabular-nums">{formatNumber(value)}</span>
      <span className="text-xs text-ink-3 truncate max-w-full">{measure}</span>
    </div>
  )
}
