import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExecutionHistory, ExecutionHistoryRow } from '@polenta/types'
import { RichTextViewer } from '../RichTextViewer'
import { activeColumnFilters, matchesColumnFilters, type ColumnFilters } from '../grid/columnFilters'
import type { GridColumn } from '../grid/gridTypes'
import { ExecutionSteps } from './ExecutionHistoryGrid'
import { STEPS_KEY, unionRunFields } from './executionColumns'

type Column = GridColumn<ExecutionHistoryRow>

/**
 * GH400 — fiches du Document : runs (pas les entrées en attente) qui passent les filtres du Tableau.
 * `filterKeys` : colonnes visibles du Tableau — un filtre sur une colonne masquée est sans effet,
 * comme dans la grille.
 */
export function documentRows(history: ExecutionHistory, columns: readonly Column[], filters: ColumnFilters, filterKeys: readonly string[]): ExecutionHistoryRow[] {
  const byKey = new Map(columns.map(c => [c.key, c]))
  const active = activeColumnFilters(filters, filterKeys.filter(k => byKey.has(k)))
  const getText = (row: ExecutionHistoryRow, key: string) => byKey.get(key)?.getText(row) ?? ''
  return history.rows.filter(r => r.kind === 'run' && matchesColumnFilters(r, active, getText))
}

/** Valeur d'une colonne dans une fiche : rendu de la colonne, sinon son texte. */
function cell(col: Column, row: ExecutionHistoryRow) {
  return col.render ? col.render(row) : col.getText(row)
}

/** Fiche d'une exécution : en-tête fixe, champs choisis, notes, étapes. */
function ExecutionCard({ row, byKey, fields, showSteps, history, repoPath }: {
  row: ExecutionHistoryRow
  byKey: Map<string, Column>
  fields: Column[]
  showSteps: boolean
  history: ExecutionHistory
  repoPath: string
}) {
  const { t } = useTranslation()
  const stepFields = useMemo(() => unionRunFields(history.runFieldDefs, 'stepFields'), [history.runFieldDefs])
  const head = (key: string) => {
    const col = byKey.get(key)
    return col ? cell(col, row) : null
  }
  return (
    <section className="break-inside-avoid border border-edge rounded-lg p-4 bg-surface print:border-print-border print:rounded-none print:border-0 print:border-b print:p-0 print:pb-4"
      data-testid={`execution-card-${row.key}`}>
      <h2 className="text-sm font-semibold text-ink">{head('test')}</h2>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
        {head('verdict')}
        <span>{head('date')}</span>
        {row.run?.executedBy && <span>{head('tester')}</span>}
        <span>{head('campaign')}</span>
        {row.entry && <span>{head('entry')}</span>}
      </div>
      {fields.map(col => {
        const text = col.getText(row)
        if (!text.trim()) return null
        return (
          <div key={col.key} className="mt-2" data-testid={`execution-card-field-${col.key}`}>
            <p className="text-xs font-medium text-ink-3">{col.label}</p>
            <div className="text-sm whitespace-pre-wrap">{cell(col, row)}</div>
          </div>
        )
      })}
      {row.run?.notes && (
        <div className="mt-2">
          <p className="text-xs font-medium text-ink-3">{t('executionHistory.col.notes')}</p>
          <RichTextViewer value={row.run.notes} repoPath={repoPath} />
        </div>
      )}
      {showSteps && (row.run?.stepResults ?? []).length > 0 && (
        <div className="mt-2 text-xs" data-testid="execution-card-steps">
          <p className="font-medium text-ink-3 mb-1">{t('executionsView.steps')}</p>
          <ExecutionSteps row={row} stepFields={stepFields} repoPath={repoPath} />
        </div>
      )}
    </section>
  )
}

/** GH400 — mode Document de la vue Exécutions (specs/GH400-design.md §9) ; `print` : page imprimable. */
export function ExecutionDocument({ history, columns, repoPath, fields, filters, filterKeys, print }: {
  history: ExecutionHistory
  columns: readonly Column[]
  repoPath: string
  /** Préférence `runWord` (clés de colonnes, `steps`). */
  fields: readonly string[]
  filters: ColumnFilters
  filterKeys: readonly string[]
  print?: boolean
}) {
  const { t } = useTranslation()
  const byKey = useMemo(() => new Map(columns.map(c => [c.key, c])), [columns])
  const rows = useMemo(() => documentRows(history, columns, filters, filterKeys), [history, columns, filters, filterKeys])
  const shownFields = useMemo(() => fields.map(k => byKey.get(k)).filter((c): c is Column => !!c), [fields, byKey])
  const showSteps = fields.includes(STEPS_KEY)

  if (rows.length === 0) {
    return <p className="p-4 text-xs text-ink-3 italic" data-testid="executions-document-empty">{t('executionsView.documentEmpty')}</p>
  }
  return (
    <div className={print ? 'space-y-6' : 'flex-1 min-h-0 overflow-y-auto p-4 space-y-3'} data-testid="executions-document" data-view-scroll={print ? undefined : true}>
      {rows.map(row => (
        <ExecutionCard key={row.key} row={row} byKey={byKey} fields={shownFields} showSteps={showSteps} history={history} repoPath={repoPath} />
      ))}
    </div>
  )
}
