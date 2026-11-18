import { buildFilterRegex, NO_FILTER_OPTIONS, type FilterOptions } from '../../lib/textFilter'

/**
 * GH389 — filtre par colonne (T51), commun à la Vue Excel et aux grilles : texte + options casse /
 * mot entier / regex, recherche « contient » sur le texte affiché, regex invalide sans effet,
 * combinaison en ET. Non persisté ; oublié quand la colonne disparaît.
 */
export interface ColumnFilter {
  text: string
  options: FilterOptions
}

export type ColumnFilters = Readonly<Record<string, ColumnFilter>>

export const EMPTY_COLUMN_FILTER: ColumnFilter = { text: '', options: NO_FILTER_OPTIONS }

export interface ActiveColumnFilter {
  key: string
  re: RegExp
}

/** Filtres qui contraignent : texte non vide, regex valide, colonne affichée. */
export function activeColumnFilters(filters: ColumnFilters, visibleKeys: readonly string[]): ActiveColumnFilter[] {
  const out: ActiveColumnFilter[] = []
  for (const [key, f] of Object.entries(filters)) {
    if (!visibleKeys.includes(key)) continue
    const re = buildFilterRegex(f.text, f.options)
    if (re) out.push({ key, re })
  }
  return out
}

/** Vrai si la ligne passe tous les filtres (ET). `getText` : texte affiché de la cellule. */
export function matchesColumnFilters<R>(row: R, active: readonly ActiveColumnFilter[], getText: (row: R, key: string) => string): boolean {
  return active.every(({ key, re }) => re.test(getText(row, key)))
}

/** Retire les filtres des colonnes qui ne sont plus affichées ; même objet si rien ne change. */
export function purgeColumnFilters(filters: ColumnFilters, visibleKeys: readonly string[]): ColumnFilters {
  const stale = Object.keys(filters).filter(key => !visibleKeys.includes(key))
  if (stale.length === 0) return filters
  const next = { ...filters }
  for (const key of stale) delete next[key]
  return next
}
