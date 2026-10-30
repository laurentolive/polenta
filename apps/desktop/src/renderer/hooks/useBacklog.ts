import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useSelectedRepo } from '../contexts/SelectedRepoContext'
import { decodeProjectId } from '../lib/projectId'

/**
 * GH199 §8bis — backlog de chaque composant local du workspace (éléments à traiter non assignés à
 * un change ouvert), calculé par le main. Invalidé par `useLiveFileSync` et après une assignation.
 */
export function useBacklog(projectId: string) {
  const { rootRepoPath } = useSelectedRepo()
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  return useQuery({
    queryKey: ['changes-backlog', rootRepoPath, workspaceDir],
    queryFn: () => api.changes.backlog(rootRepoPath, workspaceDir || undefined),
    enabled: !!rootRepoPath,
  })
}
