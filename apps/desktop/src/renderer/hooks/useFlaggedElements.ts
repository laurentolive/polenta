import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useSelectedRepo } from '../contexts/SelectedRepoContext'
import { decodeProjectId } from '../lib/projectId'

/**
 * T173 — éléments marqués `needsRevalidation` sur tout le workspace (repo racine + composants),
 * avec leurs éléments liés. Sert l'état ⚠ live des nœuds d'analyse d'impact (même figée) et la
 * liste de repli « Impact à vérifier ». Enracinée sur le repo racine comme l'analyse locale
 * (T175) : le flag est un état workspace. Invalidée par `useLiveFileSync` et après une levée.
 */
export function useFlaggedElements(projectId: string) {
  const { rootRepoPath } = useSelectedRepo()
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  const query = useQuery({
    queryKey: ['revalidation:flagged', rootRepoPath, workspaceDir],
    queryFn: () => api.revalidation.list(rootRepoPath, workspaceDir || undefined),
    enabled: !!rootRepoPath,
    refetchOnWindowFocus: true,
  })
  const flaggedIds = useMemo(() => new Set((query.data ?? []).map((e) => e.elementId)), [query.data])
  return { ...query, flaggedIds }
}
