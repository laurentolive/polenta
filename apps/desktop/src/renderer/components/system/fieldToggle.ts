/**
 * Coche / décoche une colonne du panneau « Champs visibles » sans toucher à l'ordre des autres
 * (GH235 : l'ordre choisi par glisser-déposer survit à un changement de visibilité).
 *
 * Une colonne recochée reprend sa place canonique : juste après la plus proche colonne affichée
 * qui la précède dans `canonicalOrder` (en tête s'il n'y en a pas) ; une colonne hors de l'ordre
 * canonique va en fin de liste.
 */
export function toggleVisibleField(current: string[], field: string, canonicalOrder: string[]): string[] {
  if (current.includes(field)) return current.filter(x => x !== field)
  const idx = canonicalOrder.indexOf(field)
  if (idx === -1) return [...current, field]
  for (let i = idx - 1; i >= 0; i--) {
    const at = current.indexOf(canonicalOrder[i])
    if (at !== -1) return [...current.slice(0, at + 1), field, ...current.slice(at + 1)]
  }
  return [field, ...current]
}
