/**
 * GH15 — délai de connexion réseau réglable (s), préférence app-level. Le défaut reproduit le
 * comportement d'origine d'undici (10 s) ; abaisser sous ce défaut n'est pas proposé.
 * Partagé main / renderer (bornes du champ du panneau compte).
 */
export const NETWORK_TIMEOUT_DEFAULT = 10
export const NETWORK_TIMEOUT_MIN = 10
export const NETWORK_TIMEOUT_MAX = 120

/** Entier dans [MIN, MAX], sinon le défaut (valeur absente, texte, décimale, hors bornes). */
export function normalizeNetworkTimeout(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= NETWORK_TIMEOUT_MIN && value <= NETWORK_TIMEOUT_MAX
    ? value
    : NETWORK_TIMEOUT_DEFAULT
}
