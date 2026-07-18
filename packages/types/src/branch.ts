export interface Branch {
  id: string
  projectId: string
  name: string
  gitRef: string
  parentBranchId: string | null
  forkCommitSha: string | null
  status: 'active' | 'merged' | 'abandoned'
  createdAt: string
  createdBy: string
}
