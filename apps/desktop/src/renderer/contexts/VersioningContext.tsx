import { createContext, useContext, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'

interface VersioningContextValue {
  repoPath: string
  branch: string
  isReadonly: boolean
  /** Count of staged + unstaged files — avoids a second `sync:status` subscription for consumers that only need this. */
  pendingChangesCount: number
  refetch: () => void
}

const VersioningContext = createContext<VersioningContextValue>({
  repoPath: '',
  branch: '',
  isReadonly: false,
  pendingChangesCount: 0,
  refetch: () => {},
})

export function useVersioning(): VersioningContextValue {
  return useContext(VersioningContext)
}

interface Props {
  currentProjectId: string
  children: ReactNode
}

export function VersioningProvider({ currentProjectId, children }: Props) {
  const qc = useQueryClient()

  const { data: project } = useQuery({
    queryKey: ['workspace', currentProjectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId)),
  })
  const repoPath = project?.localPath ?? ''

  const { data: syncStatus } = useQuery({
    queryKey: ['sync:status', repoPath],
    queryFn: () => api.sync.status(repoPath),
    enabled: !!repoPath,
    refetchInterval: 3000,
  })

  const branch = syncStatus?.branch ?? ''
  // T87: editing directly on the integration branch is allowed now — the only remaining
  // read-only state is a detached HEAD (baseline/arbitrary commit checked out, no branch).
  const isReadonly = branch === ''
  const pendingChangesCount = (syncStatus?.staged.length ?? 0) + (syncStatus?.unstaged.length ?? 0)

  function refetch() {
    qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
  }

  return (
    <VersioningContext.Provider value={{ repoPath, branch, isReadonly, pendingChangesCount, refetch }}>
      {children}
    </VersioningContext.Provider>
  )
}
