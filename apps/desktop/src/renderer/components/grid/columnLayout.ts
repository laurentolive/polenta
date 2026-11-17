/**
 * GH389 — calculs de colonnes communs à la Vue Excel et aux grilles (GH288, T151) : largeur auto,
 * largeur choisie prioritaire, décalages des colonnes figées, réordonnancement par glisser.
 */

/** Largeur par défaut d'une colonne sans largeur connue. */
export const DEFAULT_COL_WIDTH = 120
export const MIN_AUTO_WIDTH = 60
/** Largeur minimale au redimensionnement à la souris. */
export const MIN_DRAG_WIDTH = 20

/** Largeur auto : texte le plus long (en-tête compris), 7 px par caractère + marges, bornée. */
export function autoWidth(label: string, texts: Iterable<string>, maxWidth: number, extraChars = 0): number {
  let maxLen = label.length + extraChars
  for (const text of texts) if (text.length > maxLen) maxLen = text.length
  return Math.min(Math.max(maxLen * 7 + 24, MIN_AUTO_WIDTH), maxWidth)
}

/** Plafond de la largeur auto : un quart de la fenêtre. */
export function maxAutoWidth(): number {
  return typeof window !== 'undefined' ? Math.floor(window.innerWidth / 4) : 400
}

/** Largeur affichée : choisie à la souris, sinon auto, sinon défaut. */
export function columnWidth(key: string, chosen: Readonly<Record<string, number>>, auto: Readonly<Record<string, number>>): number {
  return chosen[key] ?? auto[key] ?? DEFAULT_COL_WIDTH
}

/** Nombre de colonnes figées, borné au nombre de colonnes affichées (sans réécrire la préférence). */
export function clampFreezeCount(count: number, columnCount: number): number {
  return Math.max(0, Math.min(Number.isFinite(count) ? Math.floor(count) : 0, columnCount))
}

/** Décalage gauche (`position: sticky`) de chacune des `freezeCount` premières colonnes. */
export function freezeOffsets(widths: readonly number[], leadingWidth: number, freezeCount: number): number[] {
  const out: number[] = []
  let acc = leadingWidth
  for (let i = 0; i < Math.min(freezeCount, widths.length); i++) {
    out.push(acc)
    acc += widths[i]
  }
  return out
}

/** Largeur au glisser de la poignée. */
export function draggedWidth(startWidth: number, dx: number): number {
  return Math.max(MIN_DRAG_WIDTH, Math.round(startWidth + dx))
}

/** Côté de dépôt d'un en-tête glissé selon la position du pointeur dans l'en-tête cible. */
export function dropSide(clientX: number, rect: { left: number; width: number }): 'before' | 'after' {
  const rel = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5
  return rel < 0.5 ? 'before' : 'after'
}

/**
 * Nouvel ordre après dépôt de `dragged` avant / après `target`. `null` si rien ne change ou si l'une
 * des deux colonnes est immobile (`fixed` : colonne de tête technique, `section` de la Vue Excel).
 */
export function reorderColumns(
  order: readonly string[], dragged: string, target: string, side: 'before' | 'after', fixed: ReadonlySet<string> = new Set(),
): string[] | null {
  if (dragged === target || fixed.has(dragged) || fixed.has(target)) return null
  const from = order.indexOf(dragged)
  const to = order.indexOf(target)
  if (from < 0 || to < 0) return null
  const next = [...order]
  next.splice(from, 1)
  const insert = side === 'before' ? (from < to ? to - 1 : to) : (from < to ? to : to + 1)
  next.splice(insert, 0, dragged)
  return next.every((k, i) => k === order[i]) ? null : next
}
