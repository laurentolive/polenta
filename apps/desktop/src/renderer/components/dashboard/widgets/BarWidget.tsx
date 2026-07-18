/**
 * BarWidget — thin recharts wrapper for `type: 'bar'` (T77 sprint 2). Renders
 * `fieldMapping.category` on the X axis and `fieldMapping.measure` as bar height.
 * The widget's type is never constrained by the query's result shape (T77.md), so
 * this must degrade gracefully rather than crash on an incomplete mapping or an
 * empty/1-row/1-column result (T77-tests.md cas limites).
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { QueryResult, WidgetFieldMapping } from '@polenta/types'
import { WidgetEmptyState } from './WidgetEmptyState'
import { seriesColor } from './chartColors'
import { toLabel, toNumber } from './numeric'

interface Props {
  result: QueryResult | null
  fieldMapping: WidgetFieldMapping
}

export function BarWidget({ result, fieldMapping }: Props) {
  const { category, measure } = fieldMapping
  if (!category || !measure) return <WidgetEmptyState message="Choisissez une catégorie et une mesure." />

  const rows = result?.rows ?? []
  if (rows.length === 0) return <WidgetEmptyState message="Aucune donnée pour cette requête." />

  // Build an explicit {category, measure} pair per row (not a spread of the raw row)
  // so a) `measure` is always coerced to a real number for bar height — a string/
  // boolean/null cell would otherwise render a broken/zero bar — and b) picking the
  // same field for both roles (unusual but not prevented by WidgetConfigModal) can't
  // have the category's string label silently clobber the numeric measure value.
  const data = rows.map((r) => ({ [category]: toLabel(r[category]), [measure]: toNumber(r[measure]) }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--edge-subtle)" vertical={false} />
        <XAxis
          dataKey={category}
          tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
          axisLine={{ stroke: 'var(--edge)' }}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} width={36} />
        <Tooltip
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--edge)', borderRadius: 6, fontSize: 12 }}
          labelStyle={{ color: 'var(--ink)' }}
        />
        <Bar dataKey={measure} fill={seriesColor(0)} radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  )
}
