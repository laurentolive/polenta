/**
 * ReorderableSidebarSection — generic reorderable/filterable list used by both
 * "Dashboards" and "Requêtes" sections of `DashboardPanel.tsx` (T77 sprint 2).
 *
 * Extracted because sprint 1 already wrote this exact drag & drop / filter / delete
 * logic once for the "Requêtes" section — duplicating another ~150 lines for
 * "Dashboards" would just be the same code with different field names. Works
 * against the minimal shape both `SavedQuery` and `Dashboard` share (`id`, `title`,
 * `scope`), so it doesn't need to know which one it's rendering.
 *
 * GH14: collapsible — the parent owns the collapsed state (it persists it and forces
 * a section open when it holds the active item). Expanded sections are `flex-1`, so
 * two open sections split the height 50/50 and a single open one takes it all.
 */
import { useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Lock, Plus, Trash2, Users2, Search as SearchIcon } from 'lucide-react'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import type { QueryScope } from '@polenta/types'

export interface SidebarItem {
  id: string
  title: string
  scope: QueryScope
}

interface Props<T extends SidebarItem> {
  label: string
  items: T[]
  order: string[]
  activeId: string | undefined
  filterText: (item: T) => string
  onReorder: (order: string[]) => void
  onSelect: (item: T) => void
  onDelete: (item: T) => void
  onAdd: () => void
  emptyMessage: string
  addTitle: string
  /** Empty-state CTA wording, e.g. "Créer la première requête" — shown as a clickable
   *  shortcut (same action as the header "+") when the list has zero items. */
  addFirstLabel: string
  /** True while the initial list fetch is in flight — without this the empty state
   *  flashes "aucun·e" for a moment before the real data arrives. */
  isLoading?: boolean
  /** Surfaced when a delete is rejected (e.g. requête utilisée par un widget —
   *  T77-tests.md cas limite "Suppression d'une requête utilisée par un widget"). */
  deleteError?: string | null
  /** GH14 — collapsed: only the header (chevron, label, "+") is rendered. */
  collapsed: boolean
  onToggleCollapsed: () => void
}

/** Exported for `DashboardGrid.tsx`'s widget grid, which needs the exact same
 *  "apply a persisted id order, unknown ids appended last" logic. */
export function orderItems<T extends { id: string }>(items: T[], order: string[]): T[] {
  const byId = new Map(items.map((it) => [it.id, it]))
  const ordered: T[] = []
  for (const id of order) {
    const it = byId.get(id)
    if (it) {
      ordered.push(it)
      byId.delete(id)
    }
  }
  ordered.push(...Array.from(byId.values()))
  return ordered
}

export function ReorderableSidebarSection<T extends SidebarItem>({
  label,
  items,
  order,
  activeId,
  filterText,
  onReorder,
  onSelect,
  onDelete,
  onAdd,
  emptyMessage,
  addTitle,
  addFirstLabel,
  isLoading,
  deleteError,
  collapsed,
  onToggleCollapsed,
}: Props<T>) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const dragImageRef = useRef<HTMLDivElement | null>(null)

  // Filtering re-serializes each item's content on every keystroke (e.g. the
  // "Requêtes" section's filterText JSON.stringifies builderConfig) — memoized so
  // it only reruns when the underlying list/order/filter actually change, not on
  // every unrelated re-render of the parent panel.
  const ordered = useMemo(() => orderItems(items, order), [items, order])
  const visible = useMemo(
    () => (filter.trim() ? ordered.filter((it) => filterText(it).includes(filter.trim().toLowerCase())) : ordered),
    [ordered, filter, filterText],
  )

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
    const position = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
    // `dragover` fires continuously (many times per drag gesture) — skip the state
    // update (and the re-render it triggers for the whole list) when the computed
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
    const ids = ordered.map((it) => it.id).filter((id) => id !== draggingId)
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

  const pendingItem = items.find((it) => it.id === pendingDeleteId)

  useModalHotkeys(
    () => setPendingDeleteId(null),
    () => { if (pendingItem) { onDelete(pendingItem); setPendingDeleteId(null) } },
    !pendingDeleteId,
  )

  return (
    <div className={`flex flex-col border-b border-edge ${collapsed ? 'shrink-0' : 'flex-1 min-h-0'}`}>
      <div ref={dragImageRef} className="fixed -top-96 left-0 w-1 h-1 opacity-0" />

      <div className="flex items-center justify-between gap-2 px-3 py-2 shrink-0">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className="flex-1 flex items-center gap-1 min-w-0 text-left text-ink-3 hover:text-ink"
        >
          {collapsed ? <ChevronRight size={12} className="shrink-0" /> : <ChevronDown size={12} className="shrink-0" />}
          <span className="section-label truncate">{label}</span>
        </button>
        <button type="button" onClick={onAdd} className="btn-icon text-prim" title={addTitle}>
          <Plus size={14} />
        </button>
      </div>

      {!collapsed && (
        <>
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-edge-subtle shrink-0">
          <SearchIcon size={12} className="text-ink-3 shrink-0" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFilter('')
            }}
            placeholder={t('common.filterPlaceholder')}
            className="flex-1 text-xs bg-transparent text-ink border-0 outline-none placeholder:text-ink-3"
          />
          {filter && (
            <button type="button" onClick={() => setFilter('')} className="text-ink-3 hover:text-ink text-xs">
              ✕
            </button>
          )}
        </div>

        {deleteError && (
          <p className="text-[11px] text-status-danger bg-status-danger-bg border-b border-status-danger-border px-3 py-1.5">
            {deleteError}
          </p>
        )}

        <div className="flex-1 overflow-y-auto min-h-[64px]">
          {isLoading ? (
            <div className="p-3 text-xs text-ink-3">{t('common.loading')}</div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 text-center py-6">
              <p className="text-xs text-ink-3">{emptyMessage}</p>
              <button type="button" onClick={onAdd} className="text-xs text-prim hover:underline">
                {addFirstLabel}
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <p className="text-xs text-ink-3">{t('common.noResults')}</p>
            </div>
          ) : (
            <div className="py-1">
              {visible.map((item) => (
                <div key={item.id} className="relative">
                  {dropTarget?.id === item.id && dropTarget.position === 'before' && (
                    <div className="absolute left-0 right-0 top-0 h-0.5 bg-status-info-solid z-10 pointer-events-none" />
                  )}
                  <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, item.id)}
                    onDragOver={(e) => handleDragOver(e, item.id)}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    className={[
                      'group flex items-center gap-2 px-3 py-1.5 hover:bg-hover transition-colors cursor-pointer',
                      activeId === item.id ? 'bg-hover' : '',
                      draggingId === item.id ? 'opacity-40' : '',
                    ].join(' ')}
                    onClick={() => onSelect(item)}
                  >
                    <span title={item.scope === 'shared' ? t('sidebar.reorderable.shared') : t('sidebar.reorderable.private')} className="shrink-0 text-ink-3">
                      {item.scope === 'shared' ? <Users2 size={11} /> : <Lock size={11} />}
                    </span>
                    <span className="text-xs text-ink truncate flex-1">{item.title}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPendingDeleteId(item.id)
                      }}
                      title={t('common.delete')}
                      className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-status-danger transition-opacity shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {dropTarget?.id === item.id && dropTarget.position === 'after' && (
                    <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-status-info-solid z-10 pointer-events-none" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        </>
      )}

      {pendingDeleteId && pendingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40">
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h2 className="text-sm font-semibold text-ink mb-2">{t('sidebar.reorderable.deleteTitle')}</h2>
            <p className="text-xs text-ink-2 mb-5">
              <Trans i18nKey="sidebar.reorderable.deleteBody" values={{ title: pendingItem.title }} components={{ b: <strong /> }} />
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setPendingDeleteId(null)} className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete(pendingItem)
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
    </div>
  )
}
