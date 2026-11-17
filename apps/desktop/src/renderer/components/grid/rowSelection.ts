/**
 * GH389 — sélection de lignes d'une grille (spec §1.9), sans DOM. Deux modes :
 *
 * - **lignes** (Vue Excel, Validation) : clic = la ligne seule, Maj+clic / Maj+↑↓ = plage depuis
 *   l'ancre, Ctrl+clic = bascule ; un clic simple sur une ligne déjà dans une sélection multiple ne la
 *   réduit pas (T149 : l'édition d'une cellule s'applique alors à toute la sélection) ;
 * - **cases** (sélecteur de tests, backlog…) : `lib/gridSelection.ts` (GH33), réexporté ici — un clic
 *   ajoute ou retire, case de groupe à trois états.
 *
 * `displayed` : identifiants des lignes affichées, dans l'ordre (filtres appliqués). Une ancre absente
 * de `displayed` (masquée par un filtre) fait ignorer Maj.
 */
export { rowClick as checkboxRowClick, checkboxClick, groupState, toggleGroup, type GroupState } from '../../lib/gridSelection'

export interface RowSelectInput {
  selected: ReadonlySet<string>
  displayed: readonly string[]
  anchor: string | null
  target: string
  shift?: boolean
  ctrl?: boolean
}

export interface RowSelectResult {
  /** `null` : sélection inchangée (évite un re-rendu). */
  selected: Set<string> | null
  anchor: string | null
}

function rangeOf(displayed: readonly string[], anchor: string | null, target: string): string[] | null {
  if (anchor === null) return null
  const a = displayed.indexOf(anchor)
  const b = displayed.indexOf(target)
  if (a < 0 || b < 0) return null
  return displayed.slice(Math.min(a, b), Math.max(a, b) + 1)
}

/** Clic (ou Maj+flèche, `shift`) sur une ligne en mode lignes. */
export function selectRow({ selected, displayed, anchor, target, shift = false, ctrl = false }: RowSelectInput): RowSelectResult {
  const range = shift ? rangeOf(displayed, anchor, target) : null
  if (range) return { selected: new Set(range), anchor }
  if (ctrl) {
    const next = new Set(selected)
    if (!next.delete(target)) next.add(target)
    return { selected: next, anchor: target }
  }
  if (selected.size > 1 && selected.has(target)) return { selected: null, anchor: target }
  if (selected.size === 1 && selected.has(target)) return { selected: null, anchor: target }
  return { selected: new Set([target]), anchor: target }
}
