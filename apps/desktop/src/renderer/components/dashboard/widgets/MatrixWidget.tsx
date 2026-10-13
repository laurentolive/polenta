/**
 * MatrixWidget — tableau croisé `type: 'matrix'` (GH69) : lignes = `fieldMapping.category`,
 * colonnes = `fieldMapping.series`, cellules = agrégation de `fieldMapping.measure` (`buildMatrix`).
 * Cas d'usage principal : résultat de chaque test (lignes) dans chaque campagne (colonnes), statuts
 * colorés au pire statut. En-têtes et première colonne figés, défilement dans les deux sens.
 *
 * Clic sur une cellule non vide → drill-down (`onSelect`, valeurs brutes ligne + colonne, GH65) ;
 * clic sur un en-tête en forme d'ID d'objet → ouverture de cet objet (`onRowClick` avec `{ id }`,
 * résolu côté main — introuvable : mention affichée par la carte).
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { QueryResult, TestRunStatus, WidgetFieldMapping } from '@polenta/types'
import { RUN_STATUS_CLASS, RUN_STATUS_LABEL_KEY, RUN_STATUS_SEVERITY } from '../../../lib/runStatus'
import { WidgetEmptyState } from './WidgetEmptyState'
import { buildMatrix, type MatrixAxisItem, type MatrixCell } from './matrix'
import { formatNumber } from './numeric'

interface Props {
  result: QueryResult | null
  fieldMapping: WidgetFieldMapping
  onSelect?: (values: Record<string, unknown>) => void
  onRowClick?: (row: Record<string, unknown>) => void
}

// En-tête cliquable seulement s'il a la forme d'un ID d'objet (`SYS-0001`, `REQ-MC-SW-001`, `CAMP-0003`) :
// une date, un statut, un titre ou une colonne concaténée n'ouvriraient jamais rien.
const OBJECT_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+$/
const isOpenable = (raw: unknown) => typeof raw === 'string' && OBJECT_ID.test(raw)

export function MatrixWidget({ result, fieldMapping, onSelect, onRowClick }: Props) {
  const { t } = useTranslation()
  const { category, series, measure, label } = fieldMapping
  const rows = result?.rows
  const matrix = useMemo(
    () => (category && series && measure && rows ? buildMatrix(rows, { category, series, measure, label }) : null),
    [rows, category, series, measure, label],
  )

  if (!category || !series || !measure) return <WidgetEmptyState message={t('dashboardPage.widget.chooseMatrixFields')} />
  if (!matrix || matrix.rows.length === 0) return <WidgetEmptyState message={t('dashboardPage.widget.noData')} />

  const header = (item: MatrixAxisItem, className: string) => {
    const clickable = !!onRowClick && isOpenable(item.raw)
    return clickable ? (
      <button type="button" title={item.key} onClick={() => onRowClick!({ id: item.raw })} className={`${className} hover:underline cursor-pointer`}>
        {item.key}
      </button>
    ) : (
      <span title={item.key} className={className}>{item.key}</span>
    )
  }

  const breakdown = (cell: Extract<MatrixCell, { kind: 'status' }>) =>
    (Object.entries(cell.breakdown) as [TestRunStatus, number][])
      .sort(([a], [b]) => RUN_STATUS_SEVERITY[b] - RUN_STATUS_SEVERITY[a])
      .map(([s, n]) => `${n} ${t(RUN_STATUS_LABEL_KEY[s])}`)
      .join(', ')

  const renderCell = (cell: MatrixCell) => {
    switch (cell.kind) {
      case 'empty':
        return <span className="text-ink-3">·</span>
      case 'status':
        return (
          <span
            title={breakdown(cell)}
            data-status={cell.status}
            className={`inline-block px-1.5 py-0.5 rounded-full whitespace-nowrap ${RUN_STATUS_CLASS[cell.status]}`}
          >
            {t(RUN_STATUS_LABEL_KEY[cell.status])}
            {cell.count > 1 && <span className="ml-1 opacity-75">×{cell.count}</span>}
          </span>
        )
      case 'number':
        return <span className="tabular-nums">{formatNumber(cell.value)}</span>
      case 'text':
        return <span title={cell.value} className="block max-w-[12rem] truncate">{cell.value}</span>
    }
  }

  return (
    <div className="h-full overflow-auto border border-edge-subtle rounded" data-testid="matrix-widget">
      <table className="text-xs border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 bg-canvas border-b border-r border-edge px-2 py-1.5" />
            {matrix.columns.map((col) => (
              <th key={col.key} className="sticky top-0 z-10 bg-canvas border-b border-edge px-2 py-1.5 font-medium text-ink-2 text-left whitespace-nowrap">
                {header(col, 'block max-w-[10rem] truncate text-left')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.key} className="hover:bg-hover">
              <th scope="row" className="sticky left-0 z-10 bg-surface border-b border-r border-edge-subtle px-2 py-1 font-normal text-left whitespace-nowrap">
                <div className="flex items-baseline gap-2 max-w-[18rem]">
                  {header(row, 'shrink-0 font-medium text-ink')}
                  {row.label !== undefined && <span title={row.label} className="truncate text-ink-3">{row.label}</span>}
                </div>
              </th>
              {matrix.columns.map((col) => {
                const cell = matrix.cell(row.key, col.key)
                const clickable = !!onSelect && cell.kind !== 'empty'
                return (
                  <td
                    key={col.key}
                    className={`border-b border-edge-subtle px-2 py-1 text-center${clickable ? ' cursor-pointer hover:brightness-95' : ''}`}
                    onClick={clickable ? () => onSelect!({ [category]: row.raw, [series]: col.raw }) : undefined}
                    data-cell={`${row.key}|${col.key}`}
                  >
                    {renderCell(cell)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
