import type { ObjectCategory } from '@polenta/types'

/** Couleur catégorielle (hors sentiment) par catégorie d'objet — icônes/badges dans
 *  l'arbre Structure et les résultats de recherche (T116). `campaign` utilise chart-7
 *  plutôt que chart-5 pour ne pas se confondre avec le marqueur sous-composant/interface
 *  (`GitFork`/`ShieldCheck`, chart-5) qui peut apparaître dans le même arbre.
 *
 *  Classes Tailwind écrites en toutes lettres (pas de concaténation `text-chart-${n}`) :
 *  le scanner JIT de Tailwind détecte les classes par recherche textuelle de motifs
 *  complets dans le code source, pas par évaluation — une classe construite dynamiquement
 *  ne serait pas générée. */
export const CATEGORY_CHART_TEXT: Record<ObjectCategory, string> = {
  requirement: 'text-chart-1',
  test: 'text-chart-2',
  campaign: 'text-chart-7',
}

export const CATEGORY_CHART_BG: Record<ObjectCategory, string> = {
  requirement: 'bg-chart-1',
  test: 'bg-chart-2',
  campaign: 'bg-chart-7',
}
