import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye } from 'lucide-react'
import type { TableExportPayload } from '@polenta/types'
import { RowMaxHeightButton } from '../system/RowMaxHeightButton'
import { ExportButton } from '../export/ExportButton'
import { fileBaseNameOf } from './exportTable'

/**
 * GH389 — barre d'outils d'une grille (spec §1.1), dans cet ordre : filtres de l'écran, 👁 Colonnes,
 * vues enregistrées, ↕▯ hauteur des lignes, Exporter, et à droite « affichées / total ».
 */
export function GridToolbar({ gridId, start, onColumns, savedViews, rowMaxLines, onRowMaxLines, exportTable, shown, total }: {
  gridId: string
  start?: ReactNode
  /** Absent : pas de 👁 (colonnes fixes). */
  onColumns?: () => void
  savedViews?: ReactNode
  rowMaxLines: number
  onRowMaxLines: (value: number) => void
  /** Absent : pas d'export. */
  exportTable?: { repoPath: string; title: string; getPayload: () => TableExportPayload }
  shown: number
  total: number
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 flex-wrap shrink-0" data-testid={`${gridId}-toolbar`}>
      {start}
      {onColumns && (
        <button type="button" className="btn-icon" title={t('grid.columns')} aria-label={t('grid.columns')} onClick={onColumns} data-testid={`${gridId}-columns`}>
          <Eye size={14} />
        </button>
      )}
      {savedViews}
      <RowMaxHeightButton value={rowMaxLines} onChange={onRowMaxLines} />
      {exportTable && (
        <ExportButton
          kind="table"
          formats={['xlsx']}
          repoPath={exportTable.repoPath}
          getSuggestedBaseName={() => fileBaseNameOf(exportTable.title)}
          getPayload={() => exportTable.getPayload()}
        />
      )}
      <span className="text-xs text-ink-3 ml-auto" data-testid={`${gridId}-count`}>{t('grid.count', { shown, total })}</span>
    </div>
  )
}
