/**
 * GH150 — fusion partielle de `fields` pour une modification : les clés de `patch` remplacent
 * celles de `existing`, une clé à `null` retire le champ. Utilisée par `update_requirements` /
 * `update_tests` (MCP) ; l'appli garde la fusion simple (une valeur `null` y est écrite telle quelle).
 */
export function mergeFields(
  existing: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(existing ?? {}) }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete out[key]
    else out[key] = value
  }
  return out
}
