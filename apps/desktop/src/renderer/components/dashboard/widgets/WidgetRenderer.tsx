/**
 * WidgetRenderer — rendu d'un widget de la vue Suivi (GH74), partagé par la grille du dashboard,
 * l'aperçu de `WidgetConfigModal` et l'impression. Spec Vega-Lite rendue par `VegaView`, sauf les
 * vues natives déclarées par `usermeta.polenta.view` (`kpi`, `table` : lisibles et sélectionnables).
 * Une erreur d'exécution s'affiche dans le widget (message, fichier, ligne) — jamais un graphe vide.
 */
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ScriptRunResult } from '@polenta/types'
import { VegaView } from '../VegaView'
import { ResultTable } from '../ResultTable'
import { WidgetEmptyState } from './WidgetEmptyState'
import { formatNumber, toNumber } from './numeric'
import { scriptErrorText } from '../../../hooks/useScriptRun'

interface NativeView {
  view: 'kpi' | 'table'
  field?: string
  suffix?: string
  columns?: string[]
}

/** Vue native déclarée par la spec, sinon `null` (rendu Vega). */
export function nativeView(spec: string): NativeView | null {
  try {
    const meta = (JSON.parse(spec) as { usermeta?: { polenta?: NativeView } }).usermeta?.polenta
    return meta && (meta.view === 'kpi' || meta.view === 'table') ? meta : null
  } catch {
    return null
  }
}

interface Props {
  spec: string
  run: ScriptRunResult | undefined
  /** Clic sur une marque / tuile / ligne : la ligne (ou le `datum`) cliquée. Absent : rien de cliquable. */
  onSelect?: (row: Record<string, unknown>) => void
  printMode?: boolean
  /** Rendu terminé (impression : attendre tous les widgets avant de générer le PDF). */
  onRendered?: () => void
}

export function WidgetRenderer({ spec, run, onSelect, printMode, onRendered }: Props) {
  const { t } = useTranslation()
  const native = useMemo(() => nativeView(spec), [spec])
  const vega = !!run && run.ok && run.rows.length > 0 && !native
  // Rendu natif, vide ou en erreur : terminé immédiatement (Vega le signale lui-même).
  useEffect(() => {
    if (run && !vega) onRendered?.()
  }, [run, vega, onRendered])

  if (!run) return null
  if (!run.ok) {
    return (
      <div className="flex items-center justify-center h-full px-4 text-center" data-testid="widget-error">
        <p className="text-xs text-status-danger italic break-words">{scriptErrorText(run.error)}</p>
      </div>
    )
  }
  if (run.rows.length === 0) return <WidgetEmptyState message={t('dashboardPage.widget.noData')} />

  if (native?.view === 'kpi') {
    const field = native.field ?? 'value'
    return (
      <div
        className={`flex flex-col items-center justify-center h-full gap-1${onSelect ? ' cursor-pointer rounded hover:bg-hover' : ''}`}
        onClick={onSelect ? () => onSelect(run.rows[0]) : undefined}
        data-drilldown={onSelect ? 'kpi' : undefined}
      >
        <span className="text-4xl font-semibold text-ink tabular-nums">{formatNumber(toNumber(run.rows[0][field]))}{native.suffix ?? ''}</span>
      </div>
    )
  }
  if (native?.view === 'table') {
    const columns = native.columns?.length ? run.columns.filter((c) => native.columns!.includes(c.name)) : run.columns
    return (
      <div className="h-full overflow-hidden">
        <ResultTable result={{ columns, rows: run.rows }} onRowClick={onSelect} compact />
      </div>
    )
  }
  return <VegaView spec={spec} rows={run.rows} onMark={onSelect} printMode={printMode} onRendered={onRendered} />
}
