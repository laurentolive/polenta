import { useQuery } from '@tanstack/react-query'
import type { ParamResolutionPreview } from '@polenta/types'
import { api } from '../api'

/**
 * T171 — résolution prévisionnelle des paramètres de tests à l'ajout en campagne (IPC
 * `campaigns:preview-params`, sans écriture) : références lues dans la base, à saisir, non
 * résolues. `source` : campagne existante (son `baselineRef`) ou `baselineRef` d'une campagne en
 * cours de création. Renvoie une map par `testCaseId` (vide tant que la requête n'a pas répondu).
 */
export function useParamPreview(
  repoPath: string,
  source: { campaignId?: string; baselineRef?: string },
  testCaseIds: string[],
  workspaceDir: string,
  enabled = true,
): { previews: Map<string, ParamResolutionPreview>; isLoading: boolean } {
  const ids = [...new Set(testCaseIds)].sort()
  const { data, isFetching } = useQuery({
    queryKey: ['campaign-param-preview', repoPath, source.campaignId ?? null, source.baselineRef ?? null, ids.join(','), workspaceDir],
    queryFn: () => api.campaigns.previewParams(repoPath, source, ids, workspaceDir || undefined),
    enabled: enabled && !!repoPath && ids.length > 0,
    // Base et tests peuvent changer ailleurs (autre onglet, vue Paramètres) : toujours relire à
    // l'ouverture d'un panneau d'ajout plutôt que servir une prévisualisation en cache.
    refetchOnMount: 'always',
    staleTime: 0,
  })
  return { previews: new Map((data ?? []).map(p => [p.testCaseId, p])), isLoading: isFetching }
}
