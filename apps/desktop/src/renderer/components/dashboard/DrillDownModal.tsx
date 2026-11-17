/**
 * DrillDownModal — popup « Détail » d'une marque cliquée (GH65 ; GH74 : specs/GH74.md §4). Les
 * objets viennent des `_ids` de la ligne cliquée ; sans `_ids` (série longue), le script est relancé
 * avec `polenta.drill` = colonnes de la ligne, et les `_ids` des lignes renvoyées sont retenus. Les
 * objets sont décrits côté main (type, titre, statut) ; clic → ouverture dans un onglet.
 */
import { useCallback, useMemo, useRef } from 'react'
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
import { ElementLink } from '../element/ElementLink'
import { useElementNav } from '../../contexts/ElementNavContext'
import { DataGrid } from '../grid/DataGrid'
import type { GridColumn } from '../grid/gridTypes'
import { backdropDismiss } from '../../lib/backdropDismiss'

const DEFAULTS = ['id', 'type', 'title', 'status']
const EMPTY_OBJECTS: DescribedObject[] = []
const objectId = (o: DescribedObject) => o.id
/** Objet qui s'ouvre dans un onglet (une exécution seule ou un ID inconnu ne s'ouvrent pas). */
const isOpenable = (o: DescribedObject) => o.kind !== 'unknown' && o.kind !== 'run'

/** ID d'un objet : lien d'élément quand l'index le connaît ; sinon (entrée de campagne…) bouton
 *  d'ouverture (Entrée sur la cellule le suit) ; texte pour un objet qui ne s'ouvre pas. */
function ObjectIdCell({ object, onOpen }: { object: DescribedObject; onOpen: (id: string) => void }) {
  const nav = useElementNav()
  if (nav?.resolve(object.id)) return <ElementLink id={object.id} className="font-mono text-prim" />
  if (!isOpenable(object)) return <span className="font-mono text-ink">{object.id}</span>
  return (
    <button type="button" data-cell-link data-cell-dblclick-ignore className="font-mono text-prim hover:underline"
      onClick={e => { e.stopPropagation(); onOpen(object.id) }} onDoubleClick={e => e.stopPropagation()}>
      {object.id}
    </button>
  )
}

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

  // GH389 §4 — grille commune : filtre par colonne, largeurs, clavier, liens ; ni 👁, ni export.
  // Double-clic / Entrée : ouvre l'objet dans un onglet (clic sur l'ID : lien d'élément).
  const openRef = useRef(open)
  openRef.current = open
  const columns = useMemo<GridColumn<DescribedObject>[]>(() => {
    const kindText = (o: DescribedObject) => (o.kind === 'unknown' ? t('dashboardPage.drillDown.notFound') : (o.typeLabel ?? t(`dashboardPage.drillDown.kinds.${o.kind}`)))
    return [
      {
        key: 'id', label: t('dashboardPage.drillDown.columns.id'), locked: true,
        getText: o => o.id,
        render: o => <ObjectIdCell object={o} onOpen={id => void openRef.current(id)} />,
      },
      { key: 'type', label: t('dashboardPage.drillDown.columns.type'), getText: kindText },
      { key: 'title', label: t('dashboardPage.drillDown.columns.title'), getText: o => o.title ?? '—' },
      { key: 'status', label: t('dashboardPage.drillDown.columns.status'), getText: o => o.status ?? '—' },
    ]
  }, [t])
  const prefs = useMemo(() => ({ repoPath, prefKey: 'grid::drilldown', view: 'columns', defaults: DEFAULTS }), [repoPath])
  const onActivate = useCallback((o: DescribedObject) => { if (isOpenable(o)) void openRef.current(o.id) }, [])

  // Libellé de la sélection : les valeurs textuelles de la ligne (catégorie, série, date…).
  const selectionLabel = Object.values(drill).filter((v) => typeof v === 'string').slice(0, 3).map(toLabel).join(' / ')
  const loading = (direct === null && rerun.isLoading) || described.isLoading
  const runError = rerun.data && !rerun.data.ok ? scriptErrorText(rerun.data.error) : null

  // Portail : la carte du widget est `draggable` (réordonnancement) — rendue dedans, la popup
  // déclencherait un glisser de la carte à la moindre sélection de texte.
  return createPortal(
    <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-30 p-4" {...backdropDismiss(onClose)}>
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
            <div className="flex flex-col max-h-[60vh] min-h-0" data-testid="drilldown-objects">
              <DataGrid
                gridId="drilldown"
                title={widgetTitle}
                rows={described.data ?? EMPTY_OBJECTS}
                getRowId={objectId}
                columns={columns}
                prefs={prefs}
                onActivate={onActivate}
                noColumnPicker
                noExport
                noReorder
                noFreeze
                layer="modal"
              />
            </div>
          )}
          {message && <p className="text-xs text-status-danger">{message}</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
