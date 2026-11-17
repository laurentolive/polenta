import { memo, type CSSProperties, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Filter as FilterIcon } from 'lucide-react'

export interface HeaderDragHandlers {
  onDragStart(e: DragEvent, col: string): void
  onDragOver(e: DragEvent, col: string): void
  onDrop(e: DragEvent, col: string): void
  onDragEnd(): void
}

/**
 * GH389 — en-tête d'une colonne (Vue Excel, grilles) : libellé, icône de filtre (`data-column-filter-icon`,
 * active quand la colonne est filtrée), poignée de largeur au bord droit, glisser pour réordonner,
 * clic droit pour figer. Toutes les fonctions reçues sont stables (en-tête mémoïsé).
 */
export const GridHeaderCell = memo(function GridHeaderCell({
  col, colIdx, label, adornment, width, frozenLeft, filterable, filtered, reorderable, dragging, dropSide, testId,
  onFilterClick, onResizeStart, drag, onFreezeMenu,
}: {
  col: string
  colIdx: number
  label: string
  /** Après le libellé (ex. « (sys) » de la Vue Excel). */
  adornment?: ReactNode
  /** Absent : dernière colonne, qui remplit la largeur restante. */
  width?: number
  frozenLeft?: number
  filterable: boolean
  filtered: boolean
  reorderable: boolean
  dragging: boolean
  dropSide?: 'before' | 'after'
  testId?: string
  onFilterClick(col: string, anchor: DOMRect): void
  onResizeStart(e: MouseEvent, col: string): void
  drag?: HeaderDragHandlers
  onFreezeMenu(colIdx: number, x: number, y: number): void
}) {
  const { t } = useTranslation()
  const frozen = frozenLeft !== undefined
  const style: CSSProperties = {
    width,
    position: frozen ? 'sticky' : 'relative',
    left: frozenLeft,
    zIndex: frozen ? 3 : undefined,
    userSelect: 'none',
    opacity: dragging ? 0.5 : 1,
    ...(dropSide === 'before' ? { boxShadow: 'inset 2px 0 0 0 #3b82f6' } : dropSide === 'after' ? { boxShadow: 'inset -2px 0 0 0 #3b82f6' } : {}),
  }
  const canDrag = reorderable && !!drag
  return (
    <th
      style={style}
      className="border border-edge px-2 py-1.5 text-left font-medium text-ink-2 bg-hover text-xs whitespace-nowrap overflow-hidden"
      data-col={col}
      data-testid={testId}
      draggable={canDrag}
      onDragStart={canDrag ? e => drag.onDragStart(e, col) : undefined}
      onDragOver={canDrag ? e => drag.onDragOver(e, col) : undefined}
      onDrop={canDrag ? e => drag.onDrop(e, col) : undefined}
      onDragEnd={canDrag ? drag.onDragEnd : undefined}
      onContextMenu={e => {
        e.preventDefault()
        e.stopPropagation()
        onFreezeMenu(colIdx, e.clientX, e.clientY)
      }}
    >
      {label}
      {adornment}
      {filterable && (
        <button
          type="button"
          draggable={false}
          data-column-filter-icon
          data-active={filtered || undefined}
          title={t('system.excelView.filterColumn')}
          aria-label={t('system.excelView.filterColumn')}
          onClick={e => {
            e.stopPropagation()
            onFilterClick(col, (e.currentTarget as HTMLElement).getBoundingClientRect())
          }}
          className={['ml-1 align-middle', filtered ? 'text-status-info' : 'text-ink-3 hover:text-ink-2'].join(' ')}
        >
          <FilterIcon size={10} />
        </button>
      )}
      <div
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize' }}
        className="hover:bg-status-info-solid"
        data-col-resize
        onMouseDown={e => onResizeStart(e, col)}
        onClick={e => e.stopPropagation()}
      />
    </th>
  )
})
