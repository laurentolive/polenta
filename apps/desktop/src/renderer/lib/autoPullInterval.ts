/** GH65 — intervalle par défaut du pull automatique (T155 : 5 min), et bornes du réglage projet. */
export const DEFAULT_AUTO_PULL_MINUTES = 5
export const MIN_AUTO_PULL_MINUTES = 1
export const MAX_AUTO_PULL_MINUTES = 60

/**
 * Valeur effective de `preferences.autoPullIntervalMinutes` (schema.yaml du repo racine) : un entier
 * dans [1, 60], sinon le défaut — le fichier peut être édité à la main.
 */
export function effectivePullIntervalMinutes(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_AUTO_PULL_MINUTES && v <= MAX_AUTO_PULL_MINUTES
    ? v
    : DEFAULT_AUTO_PULL_MINUTES
}
