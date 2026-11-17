import { useCallback, useRef, type KeyboardEvent, type RefObject } from 'react'
import type { ExcelCellStore } from '../system/excelCellStore'
import { nextCell, type GridCellKey, type GridKeyAction, type KeyboardOptions, type KeyboardRow } from './gridKeyboard'

export interface GridKeyboardModel extends KeyboardOptions {
  rows: readonly KeyboardRow[]
  cols: readonly string[]
  /** Largeur des colonnes figées : la cellule active est ramenée à leur droite. */
  frozenWidth: number
}

export interface GridKeyboardHandlers {
  /** La ligne devient la sélection (↑↓, Tab qui change de ligne). */
  selectRow(rowId: string): void
  /** Maj+↑↓. */
  extendSelection(rowId: string): void
  action(action: GridKeyAction, cell: GridCellKey): boolean
  /** Échap sans cellule active : vide la sélection ; `false` si rien à faire (Échap remonte). */
  escape(): boolean
}

/**
 * Frappe venue d'un champ de saisie, d'un éditeur ouvert, ou d'un bouton / lien qui a le focus
 * (Confirmer d'une ligne, lien d'élément, contenu d'une ligne dépliée) : la grille ne la traite pas,
 * l'élément garde son geste.
 */
export function isTypingTarget(el: Element | null, container: Element | null): boolean {
  if (!el || el === container) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
    || el.matches('button, a[href], [role="link"], [tabindex]')
}

/** Ramène la cellule dans la zone visible, sous l'en-tête collé et à droite des colonnes figées. */
export function ensureCellVisible(container: HTMLElement, cell: GridCellKey, frozenWidth: number): void {
  const row = container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(cell.rowId)}"]`)
  const el = row?.querySelector<HTMLElement>(`:scope > [data-col="${CSS.escape(cell.col)}"]`) ?? row
  if (!el) return
  const area = container.getBoundingClientRect()
  const rect = el.getBoundingClientRect()
  const header = container.querySelector('thead')?.getBoundingClientRect().height ?? 0
  const top = area.top + header
  if (rect.top < top) container.scrollTop -= top - rect.top
  else if (rect.bottom > area.bottom) container.scrollTop += Math.min(rect.bottom - area.bottom, rect.top - top)
  // Une cellule figée est toujours visible horizontalement.
  if (el.style.position === 'sticky') return
  const left = area.left + frozenWidth
  if (rect.left < left) container.scrollLeft -= left - rect.left
  else if (rect.right > area.right) container.scrollLeft += Math.min(rect.right - area.right, rect.left - left)
}

/**
 * GH389 — clavier d'une grille (spec §1.7) branché sur la cellule active (`excelCellStore`) : flèches,
 * Tab, Maj+flèches, Entrée / F2, Espace, Échap. Les frappes venues d'un champ éditable sont ignorées.
 * Rend un `onKeyDown` stable pour le conteneur de la grille, et `move` pour un éditeur qui passe la
 * main (Tab dans un éditeur ouvert : valide puis cellule suivante).
 */
export function useGridKeyboard(
  store: ExcelCellStore, containerRef: RefObject<HTMLElement | null>, model: () => GridKeyboardModel, handlers: GridKeyboardHandlers,
) {
  const latest = useRef({ model, handlers })
  latest.current = { model, handlers }

  /** Applique une touche depuis `from` ; vrai si la touche a été traitée. */
  const move = useCallback((from: GridCellKey | null, input: { key: string; shift?: boolean }): boolean => {
    const { model: getModel, handlers: h } = latest.current
    const m = getModel()
    const result = nextCell(m.rows, m.cols, from, input, m)
    if (!result) return false
    if (result.action) return h.action(result.action, result.cell)
    store.select({ nodeId: result.cell.rowId, col: result.cell.col })
    if (result.extendSelection) h.extendSelection(result.cell.rowId)
    else if (result.selectRow) h.selectRow(result.cell.rowId)
    const container = containerRef.current
    if (container) ensureCellVisible(container, result.cell, m.frozenWidth)
    return true
  }, [store, containerRef])

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (isTypingTarget(document.activeElement, containerRef.current)) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') {
      if (store.getSelected()) {
        store.select(null)
        e.stopPropagation()
      } else if (latest.current.handlers.escape()) e.stopPropagation()
      return
    }
    const s = store.getSelected()
    if (move(s ? { rowId: s.nodeId, col: s.col } : null, { key: e.key, shift: e.shiftKey })) e.preventDefault()
  }, [store, containerRef, move])

  return { onKeyDown, move }
}
