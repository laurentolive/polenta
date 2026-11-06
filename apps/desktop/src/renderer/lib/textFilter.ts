import { stripRichTextColorTags } from '@polenta/types'

export interface FilterOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

/** Options « neutres » — filtre en sous-chaîne littérale, insensible à la casse. À passer quand
 *  aucune `FilterOptions` n'est fournie (mode par défaut de la barre de recherche). */
export const NO_FILTER_OPTIONS: FilterOptions = Object.freeze({ caseSensitive: false, wholeWord: false, regex: false })

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * GH299 — le filtre porte sur le texte **visible** : `test()` ignore les balises de couleur d'un
 * richtext (`<span class="pl-c-…">`, `<mark class="pl-hl-…">`) — un filtre `mark` ne retient pas un
 * objet du seul fait de son surlignage, et un mot coupé par une balise reste trouvé. Sous-classe
 * plutôt que retrait à chaque appelant : les ~12 sites qui filtrent (arbre, vues, sélecteurs) restent
 * inchangés. `exec`/`source` (surbrillance) gardent le comportement standard, sur du texte rendu.
 */
export class VisibleTextRegExp extends RegExp {
  override test(text: string): boolean {
    return super.test(stripRichTextColorTags(String(text)))
  }
}

/** null = pas de contrainte (filtre vide OU expression invalide — on n'exclut rien
 *  plutôt que de casser l'affichage). */
export function buildFilterRegex(filter: string, options: FilterOptions): RegExp | null {
  if (!filter.trim()) return null
  try {
    const pattern = options.regex ? filter : escapeRegex(filter)
    // Groupe non-capturant : sans lui, \b${pattern}\b casse sur une alternation de tête
    // (ex. "abc|def" devient (\babc)|(def\b) au lieu de \b(?:abc|def)\b).
    const final = options.wholeWord ? `\\b(?:${pattern})\\b` : pattern
    return new VisibleTextRegExp(final, options.caseSensitive ? '' : 'i')
  } catch {
    return null
  }
}
