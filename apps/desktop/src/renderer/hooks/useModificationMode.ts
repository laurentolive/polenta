/**
 * useModificationMode — derives the "Publier" button state (T83, simplified T87).
 *
 * Deliberately independent from SystemViewContext: that provider is only mounted when the
 * active panel is 'system' (AppLayout.tsx), but this state must be available everywhere in the
 * app chrome. Duplicates the small "repo concerné" resolution already used by
 * SystemViewContext (root by default, `?repo=` search param overrides it) instead of depending
 * on a provider that isn't always present.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { useVersioning } from '../contexts/VersioningContext'
import { useIntegrationBranch } from './useIntegrationBranch'
import { useWorkspaceStructure } from './useWorkspaceStructure'
import type { WorkspaceTreeNode } from '@polenta/types'

export type ModificationMode = 'active' | 'blocked' | 'other'

export interface ModificationModeState {
  repoPath: string
  /** Current checked-out branch of the repo concerné. */
  branch: string
  /** Configured integration branch of the repo concerné (`config/project.yaml`, `'main'` fallback). */
  integrationBranch: string
  mode: ModificationMode
  /** Staged + unstaged file count for the repo concerné — reused from VersioningContext for root. */
  pendingChangesCount: number
  isLoading: boolean
  refetch: () => void
  /** Workspace root directory — needed to propagate a pin update after "Publier" (T82). */
  workspaceDir: string
  /** All repos in the current workspace — needed to find who declares the repo concerné as a dependency (T82). */
  flatNodes: WorkspaceTreeNode[]
}

export function useModificationMode(currentProjectId: string | null): ModificationModeState {
  const qc = useQueryClient()

  const { searchStr } = useRouterState({
    select: s => ({ searchStr: s.location.searchStr }),
  })
  const urlRepo = new URLSearchParams(searchStr ?? '').get('repo')

  const { repoPath: rootRepoPath, branch: rootBranch, pendingChangesCount: rootPendingChanges } = useVersioning()

  const { data: project } = useQuery({
    queryKey: ['workspace', currentProjectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId as string)),
    enabled: !!currentProjectId,
  })

  const { flatNodes } = useWorkspaceStructure(project?.workspaceDir ?? '', project?.localPath ?? '')

  // A specific `?repo=` was requested but the workspace tree hasn't resolved it yet: stay empty
  // rather than transiently falling back to root (which would briefly point the button at the
  // wrong repo — e.g. offering to create a `dev-*` branch on root while deep-linking into a
  // component repo).
  const selectedNode = urlRepo ? flatNodes.find(n => n.name === urlRepo) : undefined
  const repoPath = urlRepo ? (selectedNode?.repoPath ?? '') : rootRepoPath
  const isNonRoot = !!repoPath && repoPath !== rootRepoPath

  const { data: repoSyncStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['sync:status', repoPath],
    queryFn: () => api.sync.status(repoPath),
    enabled: isNonRoot,
    refetchInterval: 3000,
  })

  const branch = isNonRoot ? (repoSyncStatus?.branch ?? '') : rootBranch
  const pendingChangesCount = isNonRoot
    ? (repoSyncStatus?.staged.length ?? 0) + (repoSyncStatus?.unstaged.length ?? 0)
    : rootPendingChanges

  const { integrationBranch, isLoading: intLoading, invalidate: invalidateIntegrationBranch } =
    useIntegrationBranch(repoPath)

  // 'other': repo/branch not resolved yet, or detached HEAD (branch === '') — editing itself is
  //   blocked in that last case (VersioningContext.isReadonly), ModificationControl stays hidden.
  // 'blocked': on an `int-*` branch that isn't this repo's configured integration branch — editing
  //   is allowed (it's a real branch), but merging it into the configured integration branch
  //   would conflate two integration branches, so "Publier" itself is refused.
  // 'active': the configured integration branch (nominal case) or any non-`int-*` branch
  //   (`dev-*` or a freely-named branch — advanced/git-savvy usage). ModificationControl decides
  //   which of the two at publish time by comparing `branch` to `integrationBranch` again — no
  //   extra state needed here for that distinction.
  let mode: ModificationMode = 'other'
  if (repoPath && branch && integrationBranch !== undefined) {
    mode = branch.startsWith('int-') && branch !== integrationBranch ? 'blocked' : 'active'
  }

  function refetch() {
    qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
    qc.invalidateQueries({ queryKey: ['sync:branches', repoPath] })
    invalidateIntegrationBranch()
  }

  return {
    repoPath,
    branch,
    integrationBranch: integrationBranch ?? 'main',
    mode,
    pendingChangesCount,
    isLoading: statusLoading || intLoading,
    refetch,
    workspaceDir: project?.workspaceDir ?? '',
    flatNodes,
  }
}
