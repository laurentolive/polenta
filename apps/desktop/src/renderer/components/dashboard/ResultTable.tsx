/**
 * ResultTable — lignes produites par un script de la vue Suivi (vue Requêtes, widget table). État
 * vide explicite. `_ids` (identifiants des objets d'origine) n'est pas une colonne affichée : une
 * ligne qui en porte devient cliquable quand `onRowClick` est fourni (GH74).
 */

import { useTranslation } from 'react-i18next'
import type { QueryResult } from '@polenta/types'

function formatCell(v: unknown, booleanLabels: { true: string; false: string }): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? booleanLabels.true : booleanLabels.false
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Ligne qui désigne des objets (drill-down) : `_ids` non vide. */
export function rowHasIds(row: Record<string, unknown>): boolean {
  return Array.isArray(row._ids) && row._ids.length > 0
}

export function ResultTable({ result, onRowClick, compact = false }: {
  result: QueryResult | null
  onRowClick?: (row: Record<string, unknown>) => void
  /** Widget table : la table occupe la carte (pas de hauteur maximale propre ni de compteur). */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const booleanLabels = { true: t('dashboardPage.resultTable.booleanTrue'), false: t('dashboardPage.resultTable.booleanFalse') }

  if (!result) {
    return <p className="text-xs text-ink-3 py-6 text-center">{t('dashboardPage.resultTable.executeQueryHint')}</p>
  }
  if (result.rows.length === 0) {
    return <p className="text-xs text-ink-3 py-6 text-center">{t('dashboardPage.resultTable.noRowForQuery')}</p>
  }
  const columns = result.columns.filter((c) => c.name !== '_ids')

  return (
    <div className={`overflow-auto border border-edge rounded-lg ${compact ? 'h-full' : 'max-h-[420px]'}`}>
      <table className="min-w-full text-xs">
        <thead className="bg-canvas sticky top-0">
          <tr>
            {columns.map((col) => (
              <th key={col.name} className="text-left font-medium text-ink-2 px-3 py-2 border-b border-edge whitespace-nowrap">
                {col.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => {
            const clickable = !!onRowClick && rowHasIds(row)
            return (
              <tr
                key={i}
                className={`border-b border-edge-subtle last:border-0 hover:bg-hover${clickable ? ' cursor-pointer' : ''}`}
                onClick={clickable ? () => onRowClick!(row) : undefined}
                data-navigable={clickable ? 'true' : undefined}
              >
                {columns.map((col) => (
                  <td key={col.name} className="px-3 py-1.5 text-ink whitespace-nowrap">
                    {formatCell(row[col.name], booleanLabels)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {!compact && (
        <p className="px-3 py-1.5 text-[11px] text-ink-3 border-t border-edge bg-canvas">
          {t('dashboardPage.resultTable.rowCount', { count: result.rows.length })}
        </p>
      )}
    </div>
  )
}
