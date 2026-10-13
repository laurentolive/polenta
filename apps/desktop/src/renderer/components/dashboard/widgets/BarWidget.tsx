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
 *
 * `fieldMapping.preset: 'campaignProgress'` (GH71, alongside `series`) presents series values that
 * are campaign progress steps (`prep:<status>`, `ready`, results) in canonical order, with schema /
 * i18n labels and semantic colours (`progressPresentation.ts`); other values keep the standard
 * rendering, after the steps. Raw keys stay the `dataKey` and the drill-down value.
 */
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { QueryResult, WidgetFieldMapping } from '@polenta/types'
import { WidgetEmptyState } from './WidgetEmptyState'
import { seriesColor } from './chartColors'
import { toLabel, toNumber } from './numeric'
import { rawValueIndex } from './drilldown'
import { progressPresenter } from './progressPresentation'
import { useProjectSchema } from '../../../hooks/useProjectSchema'

interface Props {
  result: QueryResult | null
  fieldMapping: WidgetFieldMapping
  /** GH65 — clic sur une barre / un segment : valeurs brutes de la catégorie (et de la série). */
  onSelect?: (values: Record<string, unknown>) => void
  /** GH71 — schéma (libellés des statuts) pour le préréglage `campaignProgress`. */
  repoPath?: string
}

const CATEGORY_KEY = '__category'

export function BarWidget({ result, fieldMapping, onSelect, repoPath }: Props) {
  const { t } = useTranslation()
  const { category, measure, series, stacked, preset } = fieldMapping
  const progressPreset = preset === 'campaignProgress' && !!series
  const { data: schema } = useProjectSchema(progressPreset ? repoPath ?? '' : '')
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

  // GH71 — préréglage : étapes d'avancement d'abord (ordre canonique), autres valeurs ensuite.
  const steps = progressPreset ? progressPresenter(schema, t).present(seriesKeys) : []
  const stepByKey = new Map(steps.map((st) => [st.key, st]))
  if (progressPreset) seriesKeys = [...steps.map((st) => st.key), ...seriesKeys.filter((k) => !stepByKey.has(k))]
  const others = seriesKeys.filter((k) => !stepByKey.has(k))

  // Les libellés (`toLabel`) perdent l'information (`null` → « — », dates localisées) : le clic
  // remonte la valeur brute de la première ligne portant ce libellé.
  const rawCategory = rawValueIndex(rows, category)
  const rawSeries = series ? rawValueIndex(rows, series) : null
  const select = (cat: unknown, sv: string) => {
    if (!onSelect) return
    const values: Record<string, unknown> = { [category]: rawCategory.get(String(cat)) }
    if (series && rawSeries) values[series] = rawSeries.get(sv)
    onSelect(values)
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
              name={stepByKey.get(sv)?.label ?? sv}
              fill={stepByKey.get(sv)?.color ?? seriesColor(progressPreset ? others.indexOf(sv) : i)}
              activeBar={{ style: { filter: 'brightness(0.85)' } }}
              radius={radius}
              maxBarSize={48}
              stackId={isStacked ? 'stack' : undefined}
              onClick={onSelect ? (entry: { payload?: Record<string, unknown> }) => select(entry.payload?.[CATEGORY_KEY], sv) : undefined}
              style={onSelect ? { cursor: 'pointer' } : undefined}
            />
          )
        })}
      </BarChart>
    </ResponsiveContainer>
  )
}
