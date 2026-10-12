/**
 * TableWidget — reuses `ResultTable.tsx` (T77 sprint 1) rather than reimplementing a
 * table renderer, restricted to `fieldMapping.columns` when set (empty/undefined
 * means "show all columns", so a table widget still works before the user picks any).
 */
import type { QueryResult, WidgetFieldMapping } from '@polenta/types'
import { ResultTable } from '../ResultTable'

interface Props {
  result: QueryResult | null
  fieldMapping: WidgetFieldMapping
  /** GH65 — clic sur une ligne désignant un objet (colonnes complètes, pas seulement affichées). */
  onRowClick?: (row: Record<string, unknown>) => void
}

export function TableWidget({ result, fieldMapping, onRowClick }: Props) {
  if (!result) return <ResultTable result={null} />

  const columns = fieldMapping.columns?.length
    ? result.columns.filter((c) => fieldMapping.columns!.includes(c.name))
    : result.columns

  return <ResultTable result={{ ...result, columns }} onRowClick={onRowClick} />
}
