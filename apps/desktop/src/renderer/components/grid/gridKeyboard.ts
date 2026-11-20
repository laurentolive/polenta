/**
 * GH389 — navigation clavier d'une grille (spec §1.7), sans DOM : à partir des lignes affichées, des
 * colonnes visibles et de la cellule active, la touche donne la cellule suivante et l'action à mener.
 */

export interface GridCellKey {
  rowId: string
  col: string
}

export interface KeyboardRow {
  id: string
  /** Ligne de groupe (dossier de la Vue Excel) : une seule cellule, ←/→ replient / déplient. */
  group?: { col: string; expanded: boolean }
}

export interface KeyInput {
  key: string
  shift?: boolean
}

export type GridKeyAction = 'edit' | 'activate' | 'toggle' | 'collapse' | 'expand'

export interface GridKeyResult {
  cell: GridCellKey
  /** Maj+↑/↓ : étendre la sélection de lignes jusqu'à la ligne de `cell`. */
  extendSelection?: boolean
  /** La ligne de `cell` devient la sélection (↑/↓). */
  selectRow?: boolean
  action?: GridKeyAction
}

export interface KeyboardOptions {
  /** Cellule éditable : Entrée / F2 ouvrent l'éditeur, sinon l'action de la ligne. */
  isEditable?(cell: GridCellKey): boolean
  /** Colonne de dépli (chevron) et état de dépli d'une ligne : → déplie, ← replie. */
  expandCol?: string
  isExpanded?(rowId: string): boolean
}

const colsOf = (row: KeyboardRow, cols: readonly string[]): readonly string[] => (row.group ? [row.group.col] : cols)

/** Cellule atteinte par la touche, ou `null` si la touche n'est pas gérée (ou grille vide). */
export function nextCell(
  rows: readonly KeyboardRow[], cols: readonly string[], current: GridCellKey | null, input: KeyInput, opts: KeyboardOptions = {},
): GridKeyResult | null {
  if (rows.length === 0 || cols.length === 0) return null
  let r = current ? rows.findIndex(row => row.id === current.rowId) : -1
  if (r < 0) {
    // Pas de cellule active (ou ligne disparue) : la première touche de déplacement pose la première cellule.
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(input.key)) return null
    return { cell: { rowId: rows[0].id, col: colsOf(rows[0], cols)[0] }, selectRow: true }
  }
  const row = rows[r]
  const rowCols = colsOf(row, cols)
  let c = Math.max(0, rowCols.indexOf(current!.col))
  const cell = (ri: number, ci: number): GridCellKey => ({ rowId: rows[ri].id, col: colsOf(rows[ri], cols)[ci] })
  // Colonne gardée en changeant de ligne : la même, sinon la première (ligne de groupe).
  const sameCol = (ri: number): number => Math.max(0, colsOf(rows[ri], cols).indexOf(rowCols[c]))

  switch (input.key) {
    case 'ArrowUp':
    case 'ArrowDown': {
      r = input.key === 'ArrowUp' ? Math.max(0, r - 1) : Math.min(rows.length - 1, r + 1)
      return input.shift ? { cell: cell(r, sameCol(r)), extendSelection: true } : { cell: cell(r, sameCol(r)), selectRow: true }
    }
    case 'ArrowLeft':
    case 'ArrowRight': {
      const right = input.key === 'ArrowRight'
      if (row.group) return { cell: cell(r, 0), action: right ? 'expand' : 'collapse' }
      if (opts.expandCol && rowCols[c] === opts.expandCol && opts.isExpanded) {
        const expanded = opts.isExpanded(row.id)
        if (right && !expanded) return { cell: cell(r, c), action: 'expand' }
        if (!right && expanded) return { cell: cell(r, c), action: 'collapse' }
      }
      c = right ? Math.min(rowCols.length - 1, c + 1) : Math.max(0, c - 1)
      return { cell: cell(r, c) }
    }
    case 'Tab': {
      if (input.shift) {
        if (c > 0) return { cell: cell(r, c - 1) }
        if (r > 0) return { cell: cell(r - 1, colsOf(rows[r - 1], cols).length - 1), selectRow: true }
        return { cell: cell(r, c) }
      }
      if (c < rowCols.length - 1) return { cell: cell(r, c + 1) }
      if (r < rows.length - 1) return { cell: cell(r + 1, 0), selectRow: true }
      return { cell: cell(r, c) }
    }
    case 'Enter':
    case 'F2': {
      const here = cell(r, c)
      return { cell: here, action: opts.isEditable?.(here) ? 'edit' : 'activate' }
    }
    case ' ':
      return { cell: cell(r, c), action: 'toggle' }
    default:
      return null
  }
}
