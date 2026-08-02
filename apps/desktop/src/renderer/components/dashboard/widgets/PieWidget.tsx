/**
 * PieWidget — thin recharts wrapper for `type: 'pie'` (T77 sprint 2).
 * `fieldMapping.category` names each slice, `fieldMapping.measure` sizes it.
 */
import { useTranslation } from 'react-i18next'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { QueryResult, WidgetFieldMapping } from '@polenta/types'
import { WidgetEmptyState } from './WidgetEmptyState'
import { seriesColor } from './chartColors'
import { toLabel, toNumber } from './numeric'

interface Props {
  result: QueryResult | null
  fieldMapping: WidgetFieldMapping
}

export function PieWidget({ result, fieldMapping }: Props) {
  const { t } = useTranslation()
  const { category, measure } = fieldMapping
  if (!category || !measure) return <WidgetEmptyState message={t('dashboardPage.widget.chooseCategoryAndMeasure')} />

  const rows = result?.rows ?? []
  if (rows.length === 0) return <WidgetEmptyState message={t('dashboardPage.widget.noData')} />

  const data = rows.map((r) => ({ name: toLabel(r[category]), value: toNumber(r[measure]) }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="82%" paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={seriesColor(i)} stroke="var(--surface)" strokeWidth={2} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--edge)', borderRadius: 6, fontSize: 12 }}
        />
        {/* Légende toujours présente (≥1 série colorée par identité) — le nom porte
           l'identité, la couleur ne la porte jamais seule (dataviz skill). */}
        <Legend wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }} />
      </PieChart>
    </ResponsiveContainer>
  )
}
