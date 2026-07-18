/**
 * WidgetRenderer — dispatches to the right widget component by `WidgetType`. Shared
 * between the dashboard grid (`DashboardGrid.tsx`) and the live preview in
 * `WidgetConfigModal.tsx` so both render a widget identically, rather than each
 * duplicating the same switch (T77 sprint 2).
 */
import type { QueryResult, WidgetFieldMapping, WidgetType } from '@polenta/types'
import { BarWidget } from './BarWidget'
import { PieWidget } from './PieWidget'
import { LineWidget } from './LineWidget'
import { KpiWidget } from './KpiWidget'
import { TableWidget } from './TableWidget'

interface Props {
  type: WidgetType
  result: QueryResult | null
  fieldMapping: WidgetFieldMapping
}

export function WidgetRenderer({ type, result, fieldMapping }: Props) {
  switch (type) {
    case 'bar':
      return <BarWidget result={result} fieldMapping={fieldMapping} />
    case 'pie':
      return <PieWidget result={result} fieldMapping={fieldMapping} />
    case 'line':
      return <LineWidget result={result} fieldMapping={fieldMapping} />
    case 'kpi':
      return <KpiWidget result={result} fieldMapping={fieldMapping} />
    case 'table':
      return <TableWidget result={result} fieldMapping={fieldMapping} />
  }
}
