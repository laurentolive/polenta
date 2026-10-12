import type { RowTarget } from '@polenta/types'

/**
 * GH65 — une ligne de résultat (widget table, popup de détail) peut-elle ouvrir un objet ? Colonne
 * `campaignId` ou `id` non vide — sauf une ligne de lien (`sourceId` + `targetId` : son `id` est celui
 * du lien, qui n'a pas de page). La résolution finale (objet existant, repo où il vit) reste côté
 * main (`queries:resolve-row-target`) — une ligne « navigable » peut donc s'avérer introuvable.
 */
export function isRowNavigable(row: Record<string, unknown>): boolean {
  const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0
  if (filled(row.campaignId)) return true
  return filled(row.id) && !('sourceId' in row && 'targetId' in row)
}

/** GH65 — onglet à ouvrir pour une cible : chemin de route + paramètres de recherche. */
export function rowTargetRoute(target: RowTarget, projectId: string): { pathname: string; search: Record<string, string> } {
  const base = { repoPath: target.repoPath, projectId }
  switch (target.kind) {
    case 'requirement':
      return { pathname: `/req/${encodeURIComponent(target.id)}`, search: base }
    case 'test':
      return { pathname: `/test/${encodeURIComponent(target.id)}`, search: base }
    case 'campaign':
      return { pathname: `/campaign/${encodeURIComponent(target.id)}`, search: target.status ? { ...base, status: target.status } : base }
    case 'campaign-run':
      return {
        pathname: `/campaign/${encodeURIComponent(target.campaignId)}/run/${encodeURIComponent(target.entryId)}`,
        search: base,
      }
  }
}
