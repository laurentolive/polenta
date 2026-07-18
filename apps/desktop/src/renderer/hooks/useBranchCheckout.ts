import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useVersioning } from '../contexts/VersioningContext'
import { propagatePinToDependents, type PinPropagationOutcome } from '../lib/workspaceActions'
import type { BranchInfo } from '@polenta/api-client'
import type { WorkspaceTreeNode } from '@polenta/types'

/** Branches/tags + checkout(branch or commit)/create/delete mutations for one repo. Extracted
 *  from `VersionRepoFolder` (T78, checkout-a-commit + pin propagation added by T82) so the
 *  Structure tab's per-repo branch selector (T86) can reuse the exact same mechanics — including
 *  pin propagation — instead of duplicating them or leaving the Structure tab with a shallower
 *  cache-only fix.
 *
 *  `workspaceDir`/`flatNodes` drive two things on a successful checkout: invalidating
 *  `['workspace-open', workspaceDir]` (the Structure tab's tree reads a component's displayed pin
 *  from that query) and `propagatePinToDependents` (T82 — proposes the checked-out ref as the pin
 *  in every repo of the workspace that declares this node as a dependency, as a pending/uncommitted
 *  change, never a silent commit). Deliberately **not** wired on `createBranch` — a fresh branch
 *  isn't a ref anything should pin to yet. */
export function useBranchCheckout(
  node: { repoPath: string; name: string; url: string },
  workspaceDir: string,
  flatNodes: WorkspaceTreeNode[],
  branchesEnabled = true,
) {
  const { repoPath } = node
  const qc = useQueryClient()
  const { repoPath: rootRepoPath, refetch: refetchVersioning } = useVersioning()
  const isRoot = repoPath === rootRepoPath

  const [pinWarning, setPinWarning] = useState<PinPropagationOutcome | null>(null)

  const { data: syncStatus } = useQuery({
    queryKey: ['sync:status', repoPath],
    queryFn: () => api.sync.status(repoPath),
    enabled: !!repoPath,
    refetchInterval: 3000,
  })

  const { data: allBranches = [] } = useQuery({
    queryKey: ['sync:branches', repoPath],
    queryFn: () => api.sync.branches(repoPath),
    enabled: !!repoPath && branchesEnabled,
    refetchInterval: 5000,
  })

  const { data: allTags = [] } = useQuery({
    queryKey: ['sync:tags', repoPath],
    queryFn: () => api.sync.tags(repoPath),
    enabled: !!repoPath && branchesEnabled,
    refetchInterval: 10000,
  })

  const currentBranch = syncStatus?.branch ?? ''
  const staged = syncStatus?.staged ?? []
  const unstaged = syncStatus?.unstaged ?? []
  const isDirty = staged.length + unstaged.length > 0

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
    qc.invalidateQueries({ queryKey: ['sync:branches', repoPath] })
    qc.invalidateQueries({ queryKey: ['sync:tags', repoPath] })
    qc.invalidateQueries({ queryKey: ['workspace-open', workspaceDir] })
    // VersioningContext tracks the root repo independently (its own 3s poll) — nudge it to
    // refresh immediately so the header's readonly lock icon doesn't lag a checkout by up to 3s.
    if (isRoot) refetchVersioning()
  }

  // Checking out (or creating) an `int-*` branch now *is* designating it the configured
  // integration branch for that repo — there's no separate "Définir comme branche d'intégration"
  // UI anymore (T85 follow-up). Was root-only ("components/interfaces don't have a 'Publier'
  // workflow to gate") until T87 made "Publier" work per-repo (ModificationControl resolves the
  // repo concerné via `?repo=`, not just root) — restricting this to root left every non-root
  // repo with no way, automatic or manual, to ever get `config/project.yaml`'s `integrationBranch`
  // written, so `mode` stayed stuck on `'blocked'` no matter which `int-*` branch was checked out.
  async function maybeSetIntegrationBranch(name: string) {
    if (!name.startsWith('int-')) return
    await api.baseline.setIntegrationBranch(repoPath, name)
    qc.invalidateQueries({ queryKey: ['baseline:integration-branch', repoPath] })
  }

  // One mutation for both branch/tag and commit checkout — a single isPending/isError/error to
  // track (two separate mutations left a stale error from one visible after the other succeeded,
  // since TanStack Query only resets a mutation's error on its own next call — T82).
  const checkoutMutation = useMutation({
    mutationFn: (target: { value: string; isCommit: boolean }) =>
      target.isCommit ? api.sync.checkoutCommit(repoPath, target.value) : api.sync.checkoutBranch(repoPath, target.value),
    onSuccess: async (_data, target) => {
      invalidate()
      if (!target.isCommit) await maybeSetIntegrationBranch(target.value)
      // Awaited so `isPending` stays true for the whole cascade, not just the checkout itself.
      const outcome = await propagatePinToDependents(workspaceDir, flatNodes, { name: node.name, url: node.url }, target.value)
      setPinWarning(outcome)
    },
  })

  const createBranchMutation = useMutation({
    mutationFn: (name: string) => api.sync.createBranch(repoPath, name),
    onSuccess: async (_data, name) => {
      invalidate()
      await maybeSetIntegrationBranch(name)
    },
  })

  const deleteBranchMutation = useMutation({
    mutationFn: (name: string) => api.sync.deleteBranch(repoPath, name),
    onSuccess: invalidate,
  })

  return {
    currentBranch,
    allBranches: allBranches as BranchInfo[],
    allTags,
    isDirty,
    checkout: (name: string) => checkoutMutation.mutate({ value: name, isCommit: false }),
    checkoutCommit: (sha: string) => checkoutMutation.mutate({ value: sha, isCommit: true }),
    createBranch: (name: string) => createBranchMutation.mutate(name),
    deleteBranch: (name: string) => deleteBranchMutation.mutate(name),
    isPending: checkoutMutation.isPending || createBranchMutation.isPending || deleteBranchMutation.isPending,
    checkoutError: checkoutMutation.error,
    isCheckoutError: checkoutMutation.isError,
    createError: createBranchMutation.error,
    isCreateError: createBranchMutation.isError,
    pinWarning,
    dismissPinWarning: () => setPinWarning(null),
  }
}
