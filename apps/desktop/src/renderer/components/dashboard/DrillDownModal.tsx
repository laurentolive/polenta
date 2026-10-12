/**
 * DrillDownModal — GH65 : lignes qui composent l'élément cliqué d'un widget (barre, segment, part,
 * point, KPI). Calculées côté main (`queries:drill-down`) : lignes sources de la requête, ou — pour
 * une requête SQL non réécrivable — lignes du résultat, avec une mention. Clic sur une ligne :
 * ouverture de l'objet dans un onglet. Clé `['widget-drilldown', …]` invalidée par
 * `useLiveFileSync` comme les widgets.
 */
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Info, Loader2, X } from 'lucide-react'
import type { DrillDownResult, SavedQuery } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { useOpenRowTarget } from '../../hooks/useOpenRowTarget'
import { toQueryDefinition } from '../../hooks/useQueryResult'
import { ResultTable } from './ResultTable'
import { toLabel } from './widgets/numeric'

interface Props {
  widgetTitle: string
  query: SavedQuery
  values: Record<string, unknown>
  repoPath: string
  workspaceDir: string
  onClose: () => void
}

export function DrillDownModal({ widgetTitle, query, values, repoPath, workspaceDir, onClose }: Props) {
  const { t } = useTranslation()
  useModalHotkeys(onClose)
  const { open, message } = useOpenRowTarget(repoPath, workspaceDir)

  const { data, isLoading, error } = useQuery<DrillDownResult>({
    queryKey: ['widget-drilldown', repoPath, workspaceDir, query.id, query.sqlText, JSON.stringify(query.builderConfig ?? null), JSON.stringify(values)],
    queryFn: () => api.queries.drillDown(repoPath, toQueryDefinition(query), { values }, workspaceDir),
  })

  const selectionLabel = Object.values(values).map(toLabel).join(' / ')

  // Portail : la carte du widget est `draggable` (réordonnancement) — rendue dedans, la popup
  // déclencherait un glisser de la carte à la moindre sélection de texte.
  return createPortal(
    <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('dashboardPage.drillDown.title')}
        className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge shrink-0">
          <h2 className="text-sm font-semibold text-ink truncate">
            {widgetTitle}
            {selectionLabel && <span className="font-normal text-ink-2"> — {selectionLabel}</span>}
          </h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink" title={t('common.close')}>
            <X size={16} />
          </button>
        </div>
        <div className="p-5 overflow-auto space-y-3">
          {data?.mode === 'result' && (
            <p className="flex items-start gap-2 text-xs text-ink-2 bg-canvas border border-edge rounded px-3 py-2" data-testid="drilldown-fallback">
              <Info size={13} className="shrink-0 mt-0.5" />
              {t('dashboardPage.drillDown.fallback')}
            </p>
          )}
          {isLoading ? (
            <div className="flex justify-center py-8 text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
          ) : error ? (
            <p className="text-xs text-status-danger italic">{error instanceof Error ? error.message : String(error)}</p>
          ) : (
            <ResultTable result={data ?? null} onRowClick={(row) => void open(row)} />
          )}
          {message && <p className="text-xs text-status-danger">{message}</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
