import { useCallback, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react'
import { clampFreezeCount, columnWidth, draggedWidth, dropSide, freezeOffsets, reorderColumns } from './columnLayout'

export interface ColumnLayoutInput {
  /** Colonnes affichées, dans l'ordre (hors colonnes de tête techniques). */
  keys: readonly string[]
  /** Largeurs auto (contenu), recalculées par l'appelant. */
  autoWidths: Readonly<Record<string, number>>
  /** Largeurs choisies à la souris (préférence). */
  chosenWidths: Readonly<Record<string, number>>
  onWidthsChange: (widths: Record<string, number>) => void
  freezeCount: number
  /** Largeur des colonnes de tête techniques (toujours figées, à gauche). */
  leadingWidth: number
  onReorder?: (order: string[]) => void
}

/**
 * GH389 — largeurs (GH288), gel (T151) et ordre des colonnes d'une grille : largeur locale pendant le
 * glisser de la poignée, écrite au relâchement ; largeurs auto figées pendant le glisser (le contenu
 * ne fait pas bouger les autres colonnes) ; styles de gel stables d'un rendu à l'autre (props des
 * cellules mémoïsées).
 */
export function useColumnLayout({ keys, autoWidths, chosenWidths, onWidthsChange, freezeCount: storedFreeze, leadingWidth, onReorder }: ColumnLayoutInput) {
  const [dragWidth, setDragWidth] = useState<{ col: string; width: number } | null>(null)
  const frozenAuto = useRef<Record<string, number> | null>(null)
  const latest = useRef({ chosenWidths, onWidthsChange, autoWidths })
  latest.current = { chosenWidths, onWidthsChange, autoWidths }

  const chosen = useMemo(
    () => (dragWidth ? { ...chosenWidths, [dragWidth.col]: dragWidth.width } : chosenWidths),
    [chosenWidths, dragWidth],
  )
  const auto = frozenAuto.current ?? autoWidths
  const widthsKey = keys.map(k => columnWidth(k, chosen, auto)).join(',')
  const widths = useMemo(() => (widthsKey ? widthsKey.split(',').map(Number) : []), [widthsKey])
  const widthByKey = useMemo(() => Object.fromEntries(keys.map((k, i) => [k, widths[i]])) as Record<string, number>, [keys, widths])

  const freezeCount = clampFreezeCount(storedFreeze, keys.length)
  const offsetsKey = freezeOffsets(widths, leadingWidth, freezeCount).join(',')
  const freezeStyles = useMemo<CSSProperties[]>(
    () => (offsetsKey ? offsetsKey.split(',').map(left => ({ position: 'sticky', left: Number(left), zIndex: 2 })) : []),
    [offsetsKey],
  )
  /** Largeur des colonnes figées (tête comprise) : la cellule active est ramenée à sa droite. */
  const frozenWidth = leadingWidth + widths.slice(0, freezeCount).reduce((a, b) => a + b, 0)
  const totalWidth = leadingWidth + widths.reduce((a, b) => a + b, 0)

  const startResize = useCallback((e: MouseEvent, col: string) => {
    e.preventDefault()
    e.stopPropagation()
    const { chosenWidths: stored, autoWidths: autoNow } = latest.current
    frozenAuto.current ??= { ...autoNow }
    const startWidth = columnWidth(col, stored, frozenAuto.current)
    const startX = e.clientX
    let last: number | null = null
    const onMove = (ev: globalThis.MouseEvent) => {
      last = draggedWidth(startWidth, ev.clientX - startX)
      setDragWidth({ col, width: last })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setDragWidth(null)
      frozenAuto.current = null
      // Simple clic sur la poignée : rien à enregistrer.
      if (last !== null && last !== startWidth) latest.current.onWidthsChange({ ...latest.current.chosenWidths, [col]: last })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  // ── Ordre : glisser un en-tête ─────────────────────────────────────────────
  const [draggingCol, setDraggingCol] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ col: string; side: 'before' | 'after' } | null>(null)
  const keysRef = useRef(keys)
  keysRef.current = keys
  const reorderRef = useRef(onReorder)
  reorderRef.current = onReorder

  const endDrag = useCallback(() => { setDraggingCol(null); setDropTarget(null) }, [])
  const headerDrag = useMemo(() => ({
    onDragStart: (e: DragEvent, col: string) => {
      setDraggingCol(col)
      e.dataTransfer.setData('text/plain', col)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e: DragEvent, col: string) => {
      e.preventDefault()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setDropTarget(prev => {
        const side = dropSide(e.clientX, rect)
        return prev?.col === col && prev.side === side ? prev : { col, side }
      })
    },
    onDrop: (e: DragEvent, col: string) => {
      e.preventDefault()
      const dragged = e.dataTransfer.getData('text/plain')
      const next = reorderColumns(keysRef.current, dragged, col, dropSide(e.clientX, (e.currentTarget as HTMLElement).getBoundingClientRect()))
      if (next) reorderRef.current?.(next)
      endDrag()
    },
    onDragEnd: endDrag,
  }), [endDrag])

  return { widths, widthByKey, freezeCount, freezeStyles, frozenWidth, totalWidth, startResize, draggingCol, dropTarget, headerDrag }
}
