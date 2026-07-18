/**
 * Types partagés entre les tools MCP (T122 sprint 1) — résultats structurés,
 * plafonnement des listes.
 */

/** Seuil de troncature des résultats de liste (cf. specs/T122-design.md §2.4) —
 *  au-delà, l'agent appelant doit affiner ses filtres plutôt que de saturer son
 *  contexte avec des milliers d'objets. */
export const LIST_RESULT_LIMIT = 200

export interface ListToolResult<T> {
  items: T[]
  total: number
  truncated: boolean
}

/** Tronque `all` à `limit` éléments, en signalant explicitement la troncature —
 *  jamais une réponse silencieusement incomplète (cf. T122-tests.md scénario 11). */
export function paginate<T>(all: T[], limit: number = LIST_RESULT_LIMIT): ListToolResult<T> {
  return {
    items: all.slice(0, limit),
    total: all.length,
    truncated: all.length > limit,
  }
}

/** Sérialise `data` en un `CallToolResult` MCP standard (contenu texte JSON). */
export function jsonToolResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

/**
 * Réponse de tool MCP pour une erreur de validation métier ATTENDUE (prefix pris,
 * nœud readonly, nom déjà pris, etc.) — cf. specs/T122-design.md §5 : le tool
 * RETOURNE `isError: true`, il ne laisse jamais remonter une exception JS non
 * catchée pour ce genre d'erreur (réservé aux erreurs inattendues — FS, YAML
 * corrompu — qui doivent, elles, remonter au SDK MCP comme erreur de protocole).
 */
export function errorToolResult(message: string): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  return { isError: true, content: [{ type: 'text', text: message }] }
}
