import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { useWorkspaceStructure } from './useWorkspaceStructure'
import type { BaselineComponentRef } from '@polenta/api-client'

/** GH40 — baselines of the workspace root, shared by the Version panel's baseline list and the
 *  `/baseline` creation form: same `baseline:list` query key, so a creation/deletion invalidated
 *  from one side refreshes the other. */
export function useBaselines(projectId: string) {
  const workspaceDir = decodeProjectId(projectId)

  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(workspaceDir),
    enabled: !!projectId,
  })
  const repoPath = project?.localPath ?? ''

  const { flatNodes, error: structureError, conflicts: structureConflicts } = useWorkspaceStructure(workspaceDir, repoPath)
  const componentNodes = flatNodes.filter(n => n.repoPath !== repoPath)
  const componentRefs: BaselineComponentRef[] = componentNodes.map(n => ({ name: n.name, repoPath: n.repoPath }))

  const { data: baselines = [], isLoading: baselinesLoading } = useQuery({
    queryKey: ['baseline:list', repoPath, componentRefs],
    queryFn: () => api.baseline.list(repoPath, componentRefs),
    enabled: !!repoPath,
  })

  return {
    workspaceDir,
    repoPath,
    flatNodes,
    componentNodes,
    componentRefs,
    baselines,
    isLoading: !project || baselinesLoading,
    structureError,
    structureConflicts,
  }
}
