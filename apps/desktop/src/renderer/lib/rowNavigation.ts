import type { RowTarget } from '@polenta/types'

/**
 * GH65 / GH74 — onglet à ouvrir pour l'objet désigné par un identifiant de la vue Suivi (`_ids` d'une
 * ligne) : exigence, test, campagne, ou entrée de campagne (`<campagne>/<entrée>` : résultat
 * d'exécution si l'entrée est exécutée, sinon page de campagne filtrée sur son statut).
 */
export function rowTargetRoute(target: RowTarget, projectId: string): { pathname: string; search: Record<string, string> } {
  const base = { repoPath: target.repoPath, projectId }
  switch (target.kind) {
    case 'requirement':
      return { pathname: `/req/${encodeURIComponent(target.id)}`, search: base }
    case 'test':
      return { pathname: `/test/${encodeURIComponent(target.id)}`, search: base }
    case 'campaign':
      return { pathname: `/campaign/${encodeURIComponent(target.id)}`, search: base }
    case 'campaign-entry':
      return target.executed
        ? { pathname: `/campaign/${encodeURIComponent(target.campaignId)}/run/${encodeURIComponent(target.entryId)}`, search: base }
        : { pathname: `/campaign/${encodeURIComponent(target.campaignId)}`, search: { ...base, status: target.status } }
  }
}
