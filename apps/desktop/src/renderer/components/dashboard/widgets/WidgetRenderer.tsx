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
  /** GH65 — drill-down (barre, part, point, KPI) ; absent (aperçu, impression) : rien de cliquable. */
  onSelect?: (values: Record<string, unknown>) => void
  /** GH65 — ouverture de l'objet d'une ligne (widget table). */
  onRowClick?: (row: Record<string, unknown>) => void
}

export function WidgetRenderer({ type, result, fieldMapping, onSelect, onRowClick }: Props) {
  switch (type) {
    case 'bar':
      return <BarWidget result={result} fieldMapping={fieldMapping} onSelect={onSelect} />
    case 'pie':
      return <PieWidget result={result} fieldMapping={fieldMapping} onSelect={onSelect} />
    case 'line':
      return <LineWidget result={result} fieldMapping={fieldMapping} onSelect={onSelect} />
    case 'kpi':
      return <KpiWidget result={result} fieldMapping={fieldMapping} onSelect={onSelect} />
    case 'table':
      return <TableWidget result={result} fieldMapping={fieldMapping} onRowClick={onRowClick} />
  }
}
