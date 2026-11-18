import { useTranslation } from 'react-i18next'
import { fieldValueToText, type ExecutionHistory, type ExecutionHistoryRow, type ExecutionsExportPayload } from '@polenta/types'
import { ExportButton } from '../export/ExportButton'
import { htmlToCellText } from '../grid/cellText'
import type { ColumnFilters } from '../grid/columnFilters'
import type { GridColumn } from '../grid/gridTypes'
import { documentRows } from './ExecutionDocument'
import { STEP_KEY } from './executionColumnDefs'
import { STEPS_KEY, unionRunFields } from './executionColumns'

/** Nom de fichier : titre de la vue, sans caractères interdits par les systèmes de fichiers. */
const fileBaseName = (title: string) => title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * GH400 — export du Document (specs/GH400-design.md §10) : docx à partir des fiches affichées
 * (textes résolus ici), PDF par la route imprimable `/print/executions`, qui relit l'historique et
 * applique les mêmes filtres (`filters` en JSON).
 */
export function ExecutionsExportButton({ repoPath, title, history, columns, fields, filters, filterKeys, printParams }: {
  repoPath: string
  title: string
  history: ExecutionHistory
  columns: readonly GridColumn<ExecutionHistoryRow>[]
  fields: readonly string[]
  filters: ColumnFilters
  filterKeys: readonly string[]
  printParams: { repoPath: string; username: string; objectTypeRef: string; workspaceDir: string; title: string }
}) {
  const { t } = useTranslation()

  const buildPayload = (): ExecutionsExportPayload => {
    const byKey = new Map(columns.map(c => [c.key, c]))
    const text = (key: string, row: ExecutionHistoryRow) => byKey.get(key)?.getText(row) ?? ''
    const fieldCols = fields.map(k => byKey.get(k)).filter((c): c is GridColumn<ExecutionHistoryRow> => !!c)
    const stepFields = unionRunFields(history.runFieldDefs, 'stepFields')
    const withSteps = fields.includes(STEPS_KEY)
    return {
      title,
      labels: { notes: t('executionHistory.col.notes'), stepVerdict: t('executionHistory.col.verdict'), stepComment: t('executionsView.stepComment') },
      runs: documentRows(history, columns, filters, filterKeys).map(row => ({
        heading: text('test', row),
        meta: ['verdict', 'date', 'tester', 'campaign', 'entry'].map(k => text(k, row)).filter(Boolean).join(' · '),
        fields: fieldCols.map(c => ({ label: c.label, value: c.getText(row) })),
        notes: row.run?.notes ? htmlToCellText(row.run.notes) : '',
        ...(withSteps && {
          steps: (row.run?.stepResults ?? []).map(sr => ({
            order: sr.order,
            result: t(STEP_KEY[sr.result]),
            comment: sr.comment ? htmlToCellText(sr.comment) : '',
            fields: stepFields
              .filter(f => sr.fields?.[f.name] !== undefined)
              .map(f => ({ label: f.label ?? f.name, value: htmlToCellText(fieldValueToText(sr.fields![f.name])) })),
          })),
        }),
      })),
    }
  }

  return (
    <ExportButton
      kind="executions"
      formats={['docx', 'pdf']}
      repoPath={repoPath}
      getSuggestedBaseName={() => fileBaseName(title)}
      getPayload={() => buildPayload()}
      getPrintParams={() => ({ ...printParams, filters: JSON.stringify(filters), filterKeys: JSON.stringify(filterKeys) })}
    />
  )
}
