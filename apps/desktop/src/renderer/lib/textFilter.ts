export interface FilterOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** null = pas de contrainte (filtre vide OU expression invalide — on n'exclut rien
 *  plutôt que de casser l'affichage). */
export function buildFilterRegex(filter: string, options: FilterOptions): RegExp | null {
  if (!filter.trim()) return null
  try {
    const pattern = options.regex ? filter : escapeRegex(filter)
    // Groupe non-capturant : sans lui, \b${pattern}\b casse sur une alternation de tête
    // (ex. "abc|def" devient (\babc)|(def\b) au lieu de \b(?:abc|def)\b).
    const final = options.wholeWord ? `\\b(?:${pattern})\\b` : pattern
    return new RegExp(final, options.caseSensitive ? '' : 'i')
  } catch {
    return null
  }
}
