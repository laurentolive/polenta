import { NETWORK_TIMEOUT_DEFAULT, normalizeNetworkTimeout } from '../../shared/network-timeout'

/**
 * GH15 — délais réseau effectifs. Chaque délai de base est calibré pour le réglage par défaut
 * (10 s) et mis à l'échelle par `réglage / 10`. L'état est global au process : seul l'hôte desktop
 * le pilote (`HostContext.applyNetworkTimeout`) — le serveur web sert plusieurs utilisateurs dans
 * un même process et garde les délais par défaut. Lu à chaque requête : un changement vaut pour
 * la requête suivante, sans redémarrage.
 */
export const CONNECT_TIMEOUT_BASE_MS = 10_000   // établissement de connexion (TCP + TLS), défaut undici
export const FORGE_TIMEOUT_BASE_MS = 20_000     // API de la forge, en-têtes / corps
export const GIT_IO_TIMEOUT_BASE_MS = 300_000   // git HTTPS, en-têtes / corps (défaut undici)

let seconds = NETWORK_TIMEOUT_DEFAULT
// Vrai dès que l'hôte pilote le réglage (desktop) : les messages d'erreur peuvent alors le citer.
let adjustable = false
// Tests uniquement : réduit les délais de base pour simuler un lien lent en quelques secondes.
let baseScale = 1

export function setNetworkTimeoutSeconds(value: number): void {
  seconds = normalizeNetworkTimeout(value)
  adjustable = true
}

/** Le réglage est-il proposé à l'utilisateur (desktop) ? Faux sur le serveur web. */
export function isNetworkTimeoutAdjustable(): boolean {
  return adjustable
}

export function getNetworkTimeoutSeconds(): number {
  return seconds
}

/** Délai de base (calibré pour 10 s) × (réglage / 10). */
export function scaledTimeout(baseMs: number): number {
  return Math.round(baseMs * baseScale * seconds / NETWORK_TIMEOUT_DEFAULT)
}

/** Tests uniquement — multiplie tous les délais de base (1 = valeurs réelles). */
export function setTimeoutBaseScaleForTests(scale: number): void {
  baseScale = scale
}
