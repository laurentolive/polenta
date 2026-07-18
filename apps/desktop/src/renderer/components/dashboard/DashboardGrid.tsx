/**
 * DashboardGrid — grid of widget cards for the Dashboard view (T77 sprint 2).
 *
 * Predefined sizes only (sm/md/lg map to a fixed column span on a 4-column grid) —
 * no free pixel resize (explicitly hors scope, T77.md). Reorderable by native HTML5
 * drag & drop, same technique as `DashboardPanel.tsx`/`ElementTree` (no new DnD lib),
 * adapted for a wrapping grid: drop position is decided from the cursor's horizontal
 * half of the target card rather than vertical, since cards flow left-to-right.
 *
 * Each card resolves its own SavedQuery (by `widget.queryId`) and runs it via
 * `useQueryResult` — a widget whose query has since been deleted shows an explicit
 * "requête introuvable" state instead of crashing (T77-tests.md cas limite).
 */
import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Pencil, Trash2 } from 'lucide-react'
import type { Dashboard, SavedQuery, Widget, WidgetSize } from '@polenta/types'
import { useQueryResult } from '../../hooks/useQueryResult'
import { WidgetRenderer } from './widgets/WidgetRenderer'
import { orderItems } from '../sidebar/ReorderableSidebarSection'

interface Props {
  dashboard: Dashboard
  savedQueries: SavedQuery[]
  repoPath: string
  workspaceDir: string
  onReorder: (order: string[]) => void
  onDeleteWidget: (widgetId: string) => void
  onEditWidget: (widget: Widget) => void
  /** T43 sprint 3 — route `/print/dashboard` : masque drag & drop / édition / suppression, garde
   *  uniquement le rendu des widgets (réutilisé tel quel pour l'export PDF). */
  printMode?: boolean
}

const SIZE_SPAN: Record<WidgetSize, string> = {
  sm: 'col-span-1',
  md: 'col-span-2',
  lg: 'col-span-4',
}

function WidgetCard({
  widget,
  savedQueries,
  repoPath,
  workspaceDir,
  onRequestEdit,
  onRequestDelete,
  printMode = false,
}: {
  widget: Widget
  savedQueries: SavedQuery[]
  repoPath: string
  workspaceDir: string
  onRequestEdit: () => void
  onRequestDelete: () => void
  printMode?: boolean
}) {
  const query = savedQueries.find((q) => q.id === widget.queryId)
  const { data: result, isLoading, error } = useQueryResult(repoPath, workspaceDir, query)

  return (
    <div className="bg-surface border border-edge rounded-lg flex flex-col overflow-hidden h-64">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-edge-subtle shrink-0">
        <p className="text-xs font-medium text-ink truncate">{widget.title}</p>
        {!printMode && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRequestEdit}
              title="Modifier le widget"
              className="text-ink-3 hover:text-ink transition-colors"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={onRequestDelete}
              title="Supprimer le widget"
              className="text-ink-3 hover:text-red-500 transition-colors"
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
            Requête introuvable — elle a peut-être été supprimée.
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-full text-ink-3">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-xs text-red-500 italic px-4 text-center">
            {error instanceof Error ? error.message : "Erreur lors de l'exécution de la requête."}
          </div>
        ) : (
          <WidgetRenderer type={widget.type} result={result ?? null} fieldMapping={widget.fieldMapping} />
        )}
      </div>
    </div>
  )
}

export function DashboardGrid({ dashboard, savedQueries, repoPath, workspaceDir, onReorder, onDeleteWidget, onEditWidget, printMode = false }: Props) {
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
    // otherwise re-render every WidgetCard, including its recharts SVG) when the
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

  if (ordered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-1 text-center">
        <p className="text-sm text-ink-3">Aucun widget dans ce dashboard.</p>
        <p className="text-xs text-ink-3">Utilisez "Ajouter un widget" pour commencer.</p>
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
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500 z-10 pointer-events-none" />
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
                savedQueries={savedQueries}
                repoPath={repoPath}
                workspaceDir={workspaceDir}
                onRequestEdit={() => onEditWidget(widget)}
                onRequestDelete={() => setPendingDeleteId(widget.id)}
                printMode={printMode}
              />
            </div>
            {dropTarget?.id === widget.id && dropTarget.position === 'after' && (
              <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-blue-500 z-10 pointer-events-none" />
            )}
          </div>
        ))}
      </div>

      {pendingDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h2 className="text-sm font-semibold text-ink mb-2">Supprimer le widget ?</h2>
            <p className="text-xs text-ink-2 mb-5">
              <strong>{pendingWidget?.title ?? pendingDeleteId}</strong> sera supprimé du dashboard.
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setPendingDeleteId(null)} className="btn-secondary text-sm">
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteWidget(pendingDeleteId)
                  setPendingDeleteId(null)
                }}
                className="bg-red-600 hover:bg-red-700 text-white rounded px-4 py-2 text-sm"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
