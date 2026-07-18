import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

/** The repo's configured integration branch (`config/project.yaml`, `'main'` fallback) — shared by `project.$id.tsx` and `useModificationMode`. */
export function useIntegrationBranch(repoPath: string) {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['baseline:integration-branch', repoPath],
    queryFn: () => api.baseline.getIntegrationBranch(repoPath),
    enabled: !!repoPath,
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['baseline:integration-branch', repoPath] })
  }

  return { integrationBranch: query.data, isLoading: query.isLoading, invalidate }
}
