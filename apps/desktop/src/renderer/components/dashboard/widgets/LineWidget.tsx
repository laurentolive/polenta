/**
 * LineWidget — thin recharts wrapper for `type: 'line'` (T77 sprint 2).
 * `fieldMapping.category` is the X axis, `fieldMapping.measure` the Y value.
 * `fieldMapping.series` is optional (multi-série, cf. `WidgetFieldMapping` doc) — when
 * set, rows are pivoted into one row per category with one column per distinct series
 * value, and one `<Line>` is drawn per series. Simplification: if several rows share
 * the same (category, series) pair, the first one wins (`Array.find`, documented
 * rather than summed, since the widget has no aggregation UI — the underlying query
 * is expected to already group by category/series if that's the intent).
 */
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { QueryResult, WidgetFieldMapping } from '@polenta/types'
import { WidgetEmptyState } from './WidgetEmptyState'
import { seriesColor } from './chartColors'
import { toLabel, toNumber } from './numeric'

interface Props {
  result: QueryResult | null
  fieldMapping: WidgetFieldMapping
}

const CATEGORY_KEY = '__category'

export function LineWidget({ result, fieldMapping }: Props) {
  const { t } = useTranslation()
  const { category, measure, series } = fieldMapping
  if (!category || !measure) return <WidgetEmptyState message={t('dashboardPage.widget.chooseCategoryAndMeasure')} />

  const rows = result?.rows ?? []
  if (rows.length === 0) return <WidgetEmptyState message={t('dashboardPage.widget.noData')} />

  let data: Record<string, unknown>[]
  let seriesKeys: string[]

  if (series) {
    const categories = Array.from(new Set(rows.map((r) => toLabel(r[category]))))
    seriesKeys = Array.from(new Set(rows.map((r) => toLabel(r[series]))))
    data = categories.map((cat) => {
      const row: Record<string, unknown> = { [CATEGORY_KEY]: cat }
      for (const sv of seriesKeys) {
        const match = rows.find((r) => toLabel(r[category]) === cat && toLabel(r[series]) === sv)
        row[sv] = match ? toNumber(match[measure]) : null
      }
      return row
    })
  } else {
    data = rows.map((r) => ({ [CATEGORY_KEY]: toLabel(r[category]), [measure]: toNumber(r[measure]) }))
    seriesKeys = [measure]
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--edge-subtle)" vertical={false} />
        <XAxis
          dataKey={CATEGORY_KEY}
          tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
          axisLine={{ stroke: 'var(--edge)' }}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} width={36} />
        <Tooltip
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--edge)', borderRadius: 6, fontSize: 12 }}
        />
        {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }} />}
        {seriesKeys.map((sv, i) => (
          <Line
            key={sv}
            type="monotone"
            dataKey={sv}
            name={sv}
            stroke={seriesColor(i)}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
