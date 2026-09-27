import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * T176 — cellule sélectionnée (contour bleu) et ouverture d'éditeur de la Vue Excel, hors de l'état
 * React d'`ExcelView` : sélectionner une cellule ne re-rend que la cellule quittée et la cellule
 * sélectionnée (chacune s'abonne à un booléen), plus tout le tableau.
 */

/** Où placer le curseur à l'ouverture : au point double-cliqué (coordonnées client), ou en fin (F2). */
export type CaretRequest = { kind: 'point'; clientX: number; clientY: number } | { kind: 'end' }

export interface CellKey {
  nodeId: string
  col: string
}

export interface ExcelCellStore {
  getSelected(): CellKey | null
  select(cell: CellKey | null): void
  subscribe(listener: () => void): () => void
  /** Une cellule éditable montée s'inscrit ; `ExcelView` l'appelle pour F2. */
  registerEditor(nodeId: string, col: string, open: (caret: CaretRequest) => void): () => void
  /** `false` si la cellule n'est pas (ou plus) éditable. */
  requestEdit(nodeId: string, col: string, caret: CaretRequest): boolean
}

const cellKey = (nodeId: string, col: string) => `${nodeId}\u0000${col}`

export function createExcelCellStore(): ExcelCellStore {
  let selected: CellKey | null = null
  const listeners = new Set<() => void>()
  const editors = new Map<string, (caret: CaretRequest) => void>()
  return {
    getSelected: () => selected,
    select(cell) {
      if (selected?.nodeId === cell?.nodeId && selected?.col === cell?.col) return
      selected = cell
      for (const l of listeners) l()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    registerEditor(nodeId, col, open) {
      const key = cellKey(nodeId, col)
      editors.set(key, open)
      return () => { if (editors.get(key) === open) editors.delete(key) }
    },
    requestEdit(nodeId, col, caret) {
      const open = editors.get(cellKey(nodeId, col))
      if (!open) return false
      open(caret)
      return true
    },
  }
}

export const ExcelCellStoreContext = createContext<ExcelCellStore | null>(null)

function useStore(): ExcelCellStore {
  const store = useContext(ExcelCellStoreContext)
  if (!store) throw new Error('ExcelCellStoreContext manquant')
  return store
}

export function useIsCellSelected(nodeId: string, col: string): boolean {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, () => {
    const s = store.getSelected()
    return s?.nodeId === nodeId && s.col === col
  })
}

/**
 * Gestes communs d'une cellule : clic = sélection (la remontée à la ligne est conservée), double-clic
 * = ouverture (`open`), F2 via le registre. Sans `open`, la cellule n'est que sélectionnable.
 * Un double-clic sur une référence de paramètre ou un lien garde son propre geste.
 */
export function useCellGestures(nodeId: string, col: string, open?: (caret: CaretRequest) => void) {
  const store = useStore()
  const isSelected = useIsCellSelected(nodeId, col)
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open })
  const editable = !!open

  useEffect(() => {
    if (!editable) return
    return store.registerEditor(nodeId, col, caret => openRef.current?.(caret))
  }, [store, nodeId, col, editable])

  const onClick = useCallback(() => store.select({ nodeId, col }), [store, nodeId, col])
  // Pas de sélection de mot native au double-clic (surlignage parasite avant l'entrée en édition).
  const onMouseDown = useCallback((e: React.MouseEvent) => { if (e.detail > 1) e.preventDefault() }, [])
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    // `data-cell-dblclick-ignore` : élément avec son propre geste dans la cellule (ex. chevron
    // d'un dossier — le double-clic continue vers la ligne, qui se replie).
    if ((e.target as HTMLElement).closest('[data-param-ref], a, [data-cell-dblclick-ignore]')) return
    store.select({ nodeId, col })
    if (!openRef.current) return
    e.stopPropagation()
    openRef.current({ kind: 'point', clientX: e.clientX, clientY: e.clientY })
  }, [store, nodeId, col])

  return { isSelected, onClick, onMouseDown, onDoubleClick }
}

/**
 * Après une validation / annulation au clavier, rend le focus au conteneur du tableau (celui qui
 * porte le `onKeyDown` : F2, Échap, copier…) — sinon il tombe sur `body` au démontage de l'éditeur.
 * À appeler AVANT le démontage (l'élément doit encore être dans le DOM).
 */
export function refocusGrid(from: Element | null): void {
  const grid = from?.closest<HTMLElement>('[data-excel-grid]')
  if (grid) requestAnimationFrame(() => grid.focus({ preventScroll: true }))
}
