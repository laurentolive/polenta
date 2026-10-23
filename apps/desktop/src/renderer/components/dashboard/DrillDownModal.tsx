/**
 * DrillDownModal — popup « Détail » d'une marque cliquée (GH65 ; GH74 : specs/GH74.md §4). Les
 * objets viennent des `_ids` de la ligne cliquée ; sans `_ids` (série longue), le script est relancé
 * avec `polenta.drill` = colonnes de la ligne, et les `_ids` des lignes renvoyées sont retenus. Les
 * objets sont décrits côté main (type, titre, statut) ; clic → ouverture dans un onglet.
 */
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Info, Loader2, X } from 'lucide-react'
import type { DescribedObject, GraphDrillValue, ScriptRunRequest } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { useOpenRowTarget } from '../../hooks/useOpenRowTarget'
import { runOptions, scriptErrorText } from '../../hooks/useScriptRun'
import { toLabel } from './widgets/numeric'

interface Props {
  widgetTitle: string
  /** Ligne (ou `datum` Vega) cliquée. */
  row: Record<string, unknown>
  /** Exécution d'origine (requête / widget), relancée avec `drill` si la ligne n'a pas d'`_ids`. */
  request: ScriptRunRequest
  repoPath: string
  workspaceDir: string
  username: string
  onClose: () => void
}

/** Colonnes scalaires d'une ligne, sans `_ids` ni les bornes de pile ajoutées par Vega (`x_start` /
 *  `x_end` d'une colonne `x` présente). */
export function drillColumns(row: Record<string, unknown>): Record<string, GraphDrillValue> {
  const out: Record<string, GraphDrillValue> = {}
  const stackBound = (k: string) => {
    const m = /^(.+)_(start|end)$/.exec(k)
    return !!m && m[1] in row
  }
  for (const [k, v] of Object.entries(row)) {
    if (k === '_ids' || stackBound(k)) continue
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (v instanceof Date) out[k] = v.toISOString().slice(0, 10)
  }
  return out
}

export function DrillDownModal({ widgetTitle, row, request, repoPath, workspaceDir, username, onClose }: Props) {
  const { t, i18n } = useTranslation()
  useModalHotkeys(onClose)
  const { open, message } = useOpenRowTarget(repoPath, workspaceDir)
  const direct = Array.isArray(row._ids) ? (row._ids as unknown[]).map(String) : null
  const drill = drillColumns(row)

  const rerun = useQuery({
    ...runOptions(repoPath, workspaceDir, username, { ...request, drill }, direct === null),
    queryKey: ['widget-drilldown', repoPath, workspaceDir, username, JSON.stringify(request), JSON.stringify(drill)],
  })
  const ids = direct ?? (rerun.data?.ok ? [...new Set(rerun.data.rows.flatMap((r) => (Array.isArray(r._ids) ? r._ids : [])))] : null)

  const described = useQuery<DescribedObject[]>({
    queryKey: ['widget-drilldown', repoPath, workspaceDir, 'describe', JSON.stringify(ids)],
    queryFn: () => api.suivi.describeIds(repoPath, workspaceDir, ids ?? [], i18n.resolvedLanguage),
    enabled: !!ids && ids.length > 0,
  })

  // Libellé de la sélection : les valeurs textuelles de la ligne (catégorie, série, date…).
  const selectionLabel = Object.values(drill).filter((v) => typeof v === 'string').slice(0, 3).map(toLabel).join(' / ')
  const loading = (direct === null && rerun.isLoading) || described.isLoading
  const runError = rerun.data && !rerun.data.ok ? scriptErrorText(rerun.data.error) : null

  // Portail : la carte du widget est `draggable` (réordonnancement) — rendue dedans, la popup
  // déclencherait un glisser de la carte à la moindre sélection de texte.
  return createPortal(
    <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('dashboardPage.drillDown.title')}
        className="bg-surface border border-edge rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
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
          {loading ? (
            <div className="flex justify-center py-8 text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
          ) : runError ? (
            <p className="text-xs text-status-danger italic">{runError}</p>
          ) : !ids || ids.length === 0 ? (
            <p className="flex items-start gap-2 text-xs text-ink-2 bg-canvas border border-edge rounded px-3 py-2" data-testid="drilldown-no-ids">
              <Info size={13} className="shrink-0 mt-0.5" />
              {t('dashboardPage.drillDown.noIds')}
            </p>
          ) : (
            <table className="min-w-full text-xs border border-edge rounded-lg" data-testid="drilldown-objects">
              <thead className="bg-canvas">
                <tr>
                  {(['id', 'type', 'title', 'status'] as const).map((c) => (
                    <th key={c} className="text-left font-medium text-ink-2 px-3 py-2 border-b border-edge">{t(`dashboardPage.drillDown.columns.${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(described.data ?? []).map((o) => (
                  <tr
                    key={o.id}
                    className={`border-b border-edge-subtle last:border-0 ${o.kind === 'unknown' || o.kind === 'run' ? '' : 'cursor-pointer hover:bg-hover'}`}
                    onClick={o.kind === 'unknown' || o.kind === 'run' ? undefined : () => void open(o.id)}
                    data-navigable={o.kind === 'unknown' || o.kind === 'run' ? undefined : 'true'}
                  >
                    <td className="px-3 py-1.5 font-mono text-ink whitespace-nowrap">{o.id}</td>
                    <td className="px-3 py-1.5 text-ink-2">{o.kind === 'unknown' ? t('dashboardPage.drillDown.notFound') : (o.typeLabel ?? t(`dashboardPage.drillDown.kinds.${o.kind}`))}</td>
                    <td className="px-3 py-1.5 text-ink">{o.title ?? '—'}</td>
                    <td className="px-3 py-1.5 text-ink-2">{o.status ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {message && <p className="text-xs text-status-danger">{message}</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
