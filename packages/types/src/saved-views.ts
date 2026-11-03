/**
 * GH203 — vues enregistrées nommées du panneau ⚙️. `settings` est opaque pour le stockage : l'écran
 * qui enregistre la vue en définit les clés (`SystemView` : colonnes et mise en page ; #204 : zones
 * de la vue Validation).
 */
export type SavedViewScope = 'personal' | 'team'

export interface SavedView {
  name: string
  settings: Record<string, unknown>
}

export interface SavedViewRef {
  scope: SavedViewScope
  name: string
}

export interface SavedViewsList {
  personal: SavedView[]
  team: SavedView[]
  /** Fichier d'équipe inexploitable : `team` est vide et les écritures d'équipe sont refusées. */
  teamError?: 'unreadable' | 'newer-format'
  /** Composant en lecture seule : les vues d'équipe se lisent et s'appliquent, sans écriture. */
  teamReadonly: boolean
}

export const SAVED_VIEWS_FORMAT_VERSION = 1
export const SAVED_VIEW_NAME_MAX = 80

/** Nom sans espaces de bord, ou `null` s'il est vide ou trop long. */
export function normalizeViewName(raw: string): string | null {
  const name = typeof raw === 'string' ? raw.trim() : ''
  return name.length > 0 && name.length <= SAVED_VIEW_NAME_MAX ? name : null
}

/** L'unicité d'un nom ne tient pas compte de la casse. */
export function sameViewName(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase()
}
