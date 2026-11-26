import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'

/**
 * GH439 — exigences d'une version et leur statut de vérification. La clé commence par `versions` :
 * `useLiveFileSync` et `useInvalidateVersions` l'invalident avec le reste de la page. `enabled` : la
 * section « Exigences » ne lit rien tant qu'elle est fermée.
 */
export const versionRequirementsKey = (repoPath: string, id: string, workspaceDir: string) =>
  ['versions', 'requirements', repoPath, id, workspaceDir] as const

export function useVersionRequirements(repoPath: string, id: string, projectId: string, enabled: boolean) {
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  return useQuery({
    queryKey: versionRequirementsKey(repoPath, id, workspaceDir),
    queryFn: () => api.versions.requirements(repoPath, id, workspaceDir || undefined),
    enabled: !!repoPath && !!id && enabled,
    // Version en cours : la couverture évolue ailleurs (liens, exécutions) ; une version figée ne change plus.
    staleTime: 0,
  })
}
