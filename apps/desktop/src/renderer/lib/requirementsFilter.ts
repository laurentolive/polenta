import type { Requirement } from '@polenta/types'

/** Filtre texte + type appliqué à la liste d'exigences d'un nœud/type dans `SystemView` —
 *  extrait pour être réutilisé tel quel par `print.requirements.tsx` (l'export "cahier
 *  d'exigences" porte sur la vue/filtre actif, cf. specs/T43.md §3, pas la collection complète du
 *  composant). `objectTypeRef` est déjà au format `<node>::<type>` (cf. `SystemView.tsx`,
 *  `rawObjects` query) — approximation du filtre texte d'`ExcelView` (id/titre uniquement, pas
 *  toutes les colonnes visibles) : suffisant pour cette évolution, un filtre par colonne complet
 *  relève de T51 (non implémenté à ce jour). */
export function filterRequirements(
  requirements: Requirement[],
  { filter, objectTypeRef }: { filter: string; objectTypeRef?: string },
): Requirement[] {
  let filtered = requirements
  if (objectTypeRef) filtered = filtered.filter(r => r.objectTypeRef === objectTypeRef)
  if (filter.trim()) {
    const needle = filter.toLowerCase()
    filtered = filtered.filter(r =>
      r.id.toLowerCase().includes(needle) || (r.title ?? '').toLowerCase().includes(needle)
    )
  }
  return filtered
}
