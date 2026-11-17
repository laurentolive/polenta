import { useCallback, useEffect, useMemo, useState } from 'react'
import { activeColumnFilters, purgeColumnFilters, type ColumnFilter, type ColumnFilters } from './columnFilters'

export interface ColumnFilterPopoverState {
  column: string
  top: number
  left: number
}

/**
 * GH389 — état des filtres par colonne d'une grille (T51) : non persisté, oublié quand la colonne
 * disparaît, entièrement remis à zéro quand `resetKey` change (autre type, autre repo).
 */
export function useColumnFilters(visibleKeys: readonly string[], resetKey?: string) {
  const [filters, setFilters] = useState<ColumnFilters>({})
  const [popover, setPopover] = useState<ColumnFilterPopoverState | null>(null)
  const visibleKey = visibleKeys.join('\n')

  useEffect(() => {
    const visible = visibleKey ? visibleKey.split('\n') : []
    setFilters(prev => purgeColumnFilters(prev, visible))
    // Popover d'une colonne disparue : il resterait affiché, détaché de son en-tête.
    setPopover(prev => (prev && !visible.includes(prev.column) ? null : prev))
  }, [visibleKey])

  useEffect(() => {
    setFilters({})
    setPopover(null)
  }, [resetKey])

  // Clic hors du popover et de l'icône : fermeture.
  useEffect(() => {
    if (!popover) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-column-filter-popover]') && !target.closest('[data-column-filter-icon]')) setPopover(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [popover])

  const active = useMemo(() => activeColumnFilters(filters, visibleKey ? visibleKey.split('\n') : []), [filters, visibleKey])
  const activeKeys = useMemo(() => new Set(active.map(f => f.key)), [active])

  const setFilter = useCallback((key: string, next: ColumnFilter) => setFilters(prev => ({ ...prev, [key]: next })), [])
  /** Clic sur l'icône : ouvre le popover sous l'icône, ou le referme. */
  const togglePopover = useCallback((column: string, anchor: DOMRect) => {
    setPopover(prev => (prev?.column === column ? null : { column, top: anchor.bottom + 4, left: anchor.left }))
  }, [])
  const closePopover = useCallback(() => setPopover(null), [])

  return { filters, active, activeKeys, setFilter, popover, togglePopover, closePopover }
}
