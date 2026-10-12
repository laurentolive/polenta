import { toLabel } from './numeric'

/**
 * GH65 — libellé affiché (`toLabel`) → valeur brute de la première ligne qui le porte. Les widgets
 * pivotent sur des libellés (lossy : `null` → « — », dates localisées) ; le drill-down a besoin de la
 * valeur réelle pour filtrer les lignes sources.
 */
export function rawValueIndex(rows: Record<string, unknown>[], column: string): Map<string, unknown> {
  const index = new Map<string, unknown>()
  for (const row of rows) {
    const label = toLabel(row[column])
    if (!index.has(label)) index.set(label, row[column] ?? null)
  }
  return index
}
