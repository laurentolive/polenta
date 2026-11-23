import { useQuery } from '@tanstack/react-query'
import type { ExecutionHistoryRow } from '@polenta/types'
import { api } from '../api'

/**
 * GH428 — lignes d'exécutions des types de test d'une campagne : sert à afficher le dernier run de chaque
 * entrée dans sa grille. Même source que la Vue Exécutions, un appel par type (pas par test).
 */
export function useCampaignRunHistory(repoPath: string, workspaceDir: string | undefined, objectTypeRefs: string[]) {
  const refs = [...new Set(objectTypeRefs)].sort()
  return useQuery<ExecutionHistoryRow[]>({
    queryKey: ['execution-history', 'campaign-run-fields', repoPath, workspaceDir ?? null, refs],
    queryFn: async () => {
      const histories = await Promise.all(refs.map(ref => api.executions.history(repoPath, { objectTypeRef: ref }, workspaceDir)))
      return histories.flatMap(h => h.rows)
    },
    enabled: !!repoPath && refs.length > 0,
  })
}
