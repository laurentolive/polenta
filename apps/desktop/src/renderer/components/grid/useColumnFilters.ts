import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activeColumnFilters, purgeColumnFilters, type ColumnFilter, type ColumnFilters } from './columnFilters'

export interface ColumnFilterPopoverState {
  column: string
  top: number
  left: number
}

/** GH400 — filtres tenus par l'écran (partagés entre deux modes, préremplis par l'URL). */
export interface ControlledColumnFilters {
  value: ColumnFilters
  onChange(next: ColumnFilters): void
}

const NO_FILTERS: ColumnFilters = {}

/**
 * GH389 — état des filtres par colonne d'une grille (T51) : non persisté, oublié quand la colonne
 * disparaît, entièrement remis à zéro quand `resetKey` change (autre type, autre repo).
 * GH400 — `controlled` : l'état appartient à l'écran, qui le remet lui-même à zéro (`resetKey`
 * ignoré) ; l'oubli d'une colonne disparue reste appliqué.
 */
export function useColumnFilters(visibleKeys: readonly string[], resetKey?: string, controlled?: ControlledColumnFilters) {
  const [localFilters, setLocalFilters] = useState<ColumnFilters>(NO_FILTERS)
  const filters = controlled?.value ?? localFilters
  const [popover, setPopover] = useState<ColumnFilterPopoverState | null>(null)
  const visibleKey = visibleKeys.join('\n')

  // Mise à jour fonctionnelle commune aux deux modes. Mode contrôlé : la ref porte la dernière valeur
  // émise (pas seulement celle du dernier rendu) — deux mises à jour du même tick s'enchaînent.
  const controlledRef = useRef(controlled)
  controlledRef.current = controlled
  const emitted = useRef(filters)
  emitted.current = filters
  const update = useCallback((fn: (prev: ColumnFilters) => ColumnFilters) => {
    const c = controlledRef.current
    if (!c) { setLocalFilters(fn); return }
    const current = emitted.current
    const next = fn(current)
    if (next === current) return
    emitted.current = next
    c.onChange(next)
  }, [])

  useEffect(() => {
    const visible = visibleKey ? visibleKey.split('\n') : []
    update(prev => purgeColumnFilters(prev, visible))
    // Popover d'une colonne disparue : il resterait affiché, détaché de son en-tête.
    setPopover(prev => (prev && !visible.includes(prev.column) ? null : prev))
  }, [visibleKey, update])

  // Pas de nouvel objet si rien n'est filtré : au montage, aucun rendu supplémentaire de la grille.
  const isControlled = !!controlled
  useEffect(() => {
    if (!isControlled) setLocalFilters(prev => (Object.keys(prev).length === 0 ? prev : NO_FILTERS))
    setPopover(null)
  }, [resetKey, isControlled])

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

  const setFilter = useCallback((key: string, next: ColumnFilter) => update(prev => ({ ...prev, [key]: next })), [update])
  /** Clic sur l'icône : ouvre le popover sous l'icône, ou le referme. */
  const togglePopover = useCallback((column: string, anchor: DOMRect) => {
    setPopover(prev => (prev?.column === column ? null : { column, top: anchor.bottom + 4, left: anchor.left }))
  }, [])
  const closePopover = useCallback(() => setPopover(null), [])

  return { filters, active, activeKeys, setFilter, popover, togglePopover, closePopover }
}
