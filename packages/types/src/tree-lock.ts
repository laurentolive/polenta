/**
 * GH361 — délais du verrou d'un rangement (`.polenta/trees/`), partagés par le main (baux, fichiers
 * de verrou), le serveur MCP et le renderer (renouvellement) : un bail non renouvelé pendant
 * `TREE_LOCK_TTL_MS` est caduc ; le renderer le renouvelle toutes les `TREE_LOCK_RENEW_MS`.
 */
export const TREE_LOCK_TTL_MS = 30_000
export const TREE_LOCK_RENEW_MS = 10_000
