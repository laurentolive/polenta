/**
 * BarWidget — thin recharts wrapper for `type: 'bar'` (T77 sprint 2). Renders
 * `fieldMapping.category` on the X axis and `fieldMapping.measure` as bar height.
 * The widget's type is never constrained by the query's result shape (T77.md), so
 * this must degrade gracefully rather than crash on an incomplete mapping or an
 * empty/1-row/1-column result (T77-tests.md cas limites).
 *
 * `fieldMapping.series` (optional) draws one grouped bar per distinct series value,
 * same pivot as `LineWidget`'s multi-série mode: rows are reshaped into one row per
 * category with one column per series value, "first row wins" on a duplicate
 * (category, series) pair (no aggregation UI on the widget itself).
 *
 * `fieldMapping.stacked` (optional, only meaningful alongside `series`) stacks the
 * series on top of each other (single `stackId` shared by every `<Bar>`) instead of
 * the default grouped/side-by-side layout.
 */
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { QueryResult, WidgetFieldMapping } from '@polenta/types'
import { WidgetEmptyState } from './WidgetEmptyState'
import { seriesColor } from './chartColors'
import { toLabel, toNumber } from './numeric'

interface Props {
  result: QueryResult | null
  fieldMapping: WidgetFieldMapping
}

const CATEGORY_KEY = '__category'

export function BarWidget({ result, fieldMapping }: Props) {
  const { t } = useTranslation()
  const { category, measure, series, stacked } = fieldMapping
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
    // Build an explicit {category, measure} pair per row (not a spread of the raw
    // row) so a) `measure` is always coerced to a real number for bar height — a
    // string/boolean/null cell would otherwise render a broken/zero bar — and b)
    // picking the same field for both roles (unusual but not prevented by
    // WidgetConfigModal) can't have the category's string label silently clobber the
    // numeric measure value.
    data = rows.map((r) => ({ [CATEGORY_KEY]: toLabel(r[category]), [measure]: toNumber(r[measure]) }))
    seriesKeys = [measure]
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--edge-subtle)" vertical={false} />
        <XAxis
          dataKey={CATEGORY_KEY}
          tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
          axisLine={{ stroke: 'var(--edge)' }}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} width={36} />
        <Tooltip
          cursor={false}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--edge)', borderRadius: 6, fontSize: 12 }}
          labelStyle={{ color: 'var(--ink)' }}
        />
        {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }} />}
        {seriesKeys.map((sv, i) => {
          const isStacked = stacked && series
          // Only the topmost segment of a stack gets rounded top corners — rounding
          // every segment would leave visible gaps where a lower segment's rounded
          // top corner doesn't reach the segment stacked above it.
          const radius: [number, number, number, number] = !isStacked || i === seriesKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
          return (
            <Bar
              key={sv}
              dataKey={sv}
              name={sv}
              fill={seriesColor(i)}
              activeBar={{ style: { filter: 'brightness(0.85)' } }}
              radius={radius}
              maxBarSize={48}
              stackId={isStacked ? 'stack' : undefined}
            />
          )
        })}
      </BarChart>
    </ResponsiveContainer>
  )
}
