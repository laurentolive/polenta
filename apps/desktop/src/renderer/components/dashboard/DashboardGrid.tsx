/**
 * DashboardGrid — grid of widget cards for the Dashboard view (T77 sprint 2).
 *
 * Predefined sizes only (sm/md/lg map to a fixed column span on a 4-column grid) —
 * no free pixel resize (explicitly hors scope, T77.md). Reorderable by native HTML5
 * drag & drop, same technique as `DashboardPanel.tsx`/`ElementTree` (no new DnD lib),
 * adapted for a wrapping grid: drop position is decided from the cursor's horizontal
 * half of the target card rather than vertical, since cards flow left-to-right.
 *
 * Each card runs its widget (query + transformation, GH74 — `useWidgetRun`) — a widget whose query
 * has since been deleted shows an explicit "requête introuvable" state instead of crashing
 * (T77-tests.md cas limite), and an SQL query from before GH74 an explicit "not supported" one.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { AlertTriangle, Loader2, Pencil, Trash2 } from 'lucide-react'
import type { Dashboard, SavedQuery, Widget, WidgetSize } from '@polenta/types'
import { useWidgetRun } from '../../hooks/useScriptRun'
import { DrillDownModal } from './DrillDownModal'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { WidgetRenderer } from './widgets/WidgetRenderer'
import { orderItems } from '../sidebar/ReorderableSidebarSection'

interface Props {
  dashboard: Dashboard
  savedQueries: SavedQuery[]
  repoPath: string
  workspaceDir: string
  username: string
  onReorder: (order: string[]) => void
  onDeleteWidget: (widgetId: string) => void
  onEditWidget: (widget: Widget) => void
  /** T43 sprint 3 — route `/print/dashboard` : masque drag & drop / édition / suppression, garde
   *  uniquement le rendu des widgets (réutilisé tel quel pour l'export PDF). */
  printMode?: boolean
  /** Impression : rendu d'un widget terminé (PDF généré quand tous le sont). */
  onWidgetRendered?: (widgetId: string) => void
}

const SIZE_SPAN: Record<WidgetSize, string> = {
  sm: 'col-span-1',
  md: 'col-span-2',
  lg: 'col-span-4',
}

function WidgetCard({
  widget,
  dashboardId,
  savedQueries,
  repoPath,
  workspaceDir,
  username,
  onRequestEdit,
  onRequestDelete,
  printMode = false,
  onRendered,
}: {
  widget: Widget
  dashboardId: string
  savedQueries: SavedQuery[]
  repoPath: string
  workspaceDir: string
  username: string
  onRequestEdit: () => void
  onRequestDelete: () => void
  printMode?: boolean
  onRendered?: () => void
}) {
  const { t } = useTranslation()
  const query = savedQueries.find((q) => q.id === widget.queryId)
  const { data: run, isLoading, error } = useWidgetRun(repoPath, workspaceDir, username, dashboardId, widget, query?.script)
  // Impression : un widget sans requête ou dont l'exécution a échoué (IPC) est « rendu » tout de suite.
  useEffect(() => {
    if (!query || error) onRendered?.()
  }, [query, error, onRendered])
  // GH65 / GH74 — drill-down (popup de détail) ; jamais en impression.
  const [drillRow, setDrillRow] = useState<Record<string, unknown> | null>(null)
  const interactive = !printMode && !!query

  return (
    <div className="bg-surface border border-edge rounded-lg flex flex-col overflow-hidden h-64" data-testid="widget-card">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-edge-subtle shrink-0">
        <p className="text-xs font-medium text-ink truncate">{widget.title}</p>
        {!printMode && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRequestEdit}
              title={t('dashboard.widgetModal.editTitle')}
              className="text-ink-3 hover:text-ink transition-colors"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={onRequestDelete}
              title={t('dashboardPage.deleteWidgetTitle')}
              className="text-ink-3 hover:text-status-danger transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 p-2">
        {!query ? (
          <div className="flex items-center justify-center h-full gap-2 text-xs text-ink-3 italic px-4 text-center">
            <AlertTriangle size={13} className="shrink-0" />
            {t('dashboardPage.queryNotFound')}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-full text-ink-3">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-xs text-status-danger italic px-4 text-center" data-testid="widget-error">
            {error instanceof Error ? error.message : t('dashboard.widgetModal.queryExecutionError')}
          </div>
        ) : (
          <WidgetRenderer
            spec={widget.spec}
            run={run}
            onSelect={interactive ? setDrillRow : undefined}
            printMode={printMode}
            onRendered={onRendered}
          />
        )}
      </div>
      {drillRow && query && (
        <DrillDownModal
          widgetTitle={widget.title}
          row={drillRow}
          request={{ dashboardId, widgetId: widget.id }}
          repoPath={repoPath}
          workspaceDir={workspaceDir}
          username={username}
          onClose={() => setDrillRow(null)}
        />
      )}
    </div>
  )
}

export function DashboardGrid({ dashboard, savedQueries, repoPath, workspaceDir, username, onReorder, onDeleteWidget, onEditWidget, printMode = false, onWidgetRendered }: Props) {
  const { t } = useTranslation()
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const dragImageRef = useRef<HTMLDivElement | null>(null)

  const ordered = useMemo(() => orderItems(dashboard.widgets, dashboard.widgetOrder), [dashboard.widgets, dashboard.widgetOrder])

  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id)
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    if (dragImageRef.current) e.dataTransfer.setDragImage(dragImageRef.current, 0, 0)
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault()
    if (id === draggingId) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const position = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after'
    // `dragover` fires continuously during a drag — skip the re-render (which would
    // otherwise re-render every WidgetCard, including its Vega view) when the
    // drop position hasn't actually changed since the last event.
    setDropTarget((prev) => (prev?.id === id && prev.position === position ? prev : { id, position }))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!draggingId || !dropTarget || draggingId === dropTarget.id) {
      setDraggingId(null)
      setDropTarget(null)
      return
    }
    const ids = ordered.map((w) => w.id).filter((id) => id !== draggingId)
    const targetIdx = ids.indexOf(dropTarget.id)
    const insertAt = dropTarget.position === 'before' ? targetIdx : targetIdx + 1
    ids.splice(insertAt, 0, draggingId)
    setDraggingId(null)
    setDropTarget(null)
    onReorder(ids)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDropTarget(null)
  }

  const pendingWidget = dashboard.widgets.find((w) => w.id === pendingDeleteId)

  useModalHotkeys(
    () => setPendingDeleteId(null),
    () => { if (pendingDeleteId) { onDeleteWidget(pendingDeleteId); setPendingDeleteId(null) } },
    !pendingDeleteId,
  )

  if (ordered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-1 text-center">
        <p className="text-sm text-ink-3">{t('dashboardPage.noWidget')}</p>
        <p className="text-xs text-ink-3">{t('dashboardPage.useAddWidgetHint')}</p>
      </div>
    )
  }

  return (
    <>
      <div ref={dragImageRef} className="fixed -top-96 left-0 w-1 h-1 opacity-0" />
      <div className="grid grid-cols-4 gap-4">
        {ordered.map((widget) => (
          <div key={widget.id} className={`relative ${SIZE_SPAN[widget.size]}`}>
            {dropTarget?.id === widget.id && dropTarget.position === 'before' && (
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-status-info-solid z-10 pointer-events-none" />
            )}
            <div
              draggable={!printMode}
              onDragStart={printMode ? undefined : (e) => handleDragStart(e, widget.id)}
              onDragOver={printMode ? undefined : (e) => handleDragOver(e, widget.id)}
              onDrop={printMode ? undefined : handleDrop}
              onDragEnd={printMode ? undefined : handleDragEnd}
              className={draggingId === widget.id ? 'opacity-40' : ''}
            >
              <WidgetCard
                widget={widget}
                dashboardId={dashboard.id}
                savedQueries={savedQueries}
                repoPath={repoPath}
                workspaceDir={workspaceDir}
                username={username}
                onRendered={onWidgetRendered ? () => onWidgetRendered(widget.id) : undefined}
                onRequestEdit={() => onEditWidget(widget)}
                onRequestDelete={() => setPendingDeleteId(widget.id)}
                printMode={printMode}
              />
            </div>
            {dropTarget?.id === widget.id && dropTarget.position === 'after' && (
              <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-status-info-solid z-10 pointer-events-none" />
            )}
          </div>
        ))}
      </div>

      {pendingDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40">
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h2 className="text-sm font-semibold text-ink mb-2">{t('dashboardPage.deleteWidgetConfirmTitle')}</h2>
            <p className="text-xs text-ink-2 mb-5">
              <Trans i18nKey="dashboardPage.deleteWidgetConfirmBody" values={{ title: pendingWidget?.title ?? pendingDeleteId }} components={{ b: <strong /> }} />
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setPendingDeleteId(null)} className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteWidget(pendingDeleteId)
                  setPendingDeleteId(null)
                }}
                className="btn-danger"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
