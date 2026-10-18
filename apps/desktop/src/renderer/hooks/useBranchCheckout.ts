import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useVersioning } from '../contexts/VersioningContext'
import { propagatePinToDependents, type PinPropagationOutcome } from '../lib/workspaceActions'
import { useTranslation } from 'react-i18next'
import { designateNotices, invalidateIntegration } from './useDesignateIntegration'
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
 *  change, never a silent commit). Not wired on `createBranch` for a plain branch — a fresh branch
 *  isn't a ref anything should pin to yet — but wired for a new `int-*`, which is designated
 *  (GH106). */
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
  const [branchNotices, setBranchNotices] = useState<string[]>([])
  const { t } = useTranslation()

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

  // GH106 — a checkout never writes nor commits anything: checking out an `int-*` whose
  // `config/project.yaml` names another branch leaves it undesignated, and "Publier" then offers
  // "Désigner" (the old uncommitted `setIntegrationBranch` write here could be lost or never land).
  // One mutation for both branch/tag and commit checkout — a single isPending/isError/error to
  // track (two separate mutations left a stale error from one visible after the other succeeded,
  // since TanStack Query only resets a mutation's error on its own next call — T82).
  const checkoutMutation = useMutation({
    mutationFn: (target: { value: string; isCommit: boolean }) =>
      target.isCommit ? api.sync.checkoutCommit(repoPath, target.value) : api.sync.checkoutBranch(repoPath, target.value),
    onSuccess: async (_data, target) => {
      invalidate()
      invalidateIntegration(qc, repoPath)
      // Awaited so `isPending` stays true for the whole cascade, not just the checkout itself.
      const outcome = await propagatePinToDependents(workspaceDir, flatNodes, { name: node.name, url: node.url }, target.value)
      setPinWarning(outcome)
    },
  })

  // GH106 — creating an `int-*` designates it: commit of `config/project.yaml` alone, push, forge
  // default branch, then pin propagation like a checkout (it is now the ref parents should pin).
  // Any other name: plain branch at HEAD, no pin propagation — nothing should pin to it yet.
  const createBranchMutation = useMutation({
    mutationFn: async (name: string) => {
      setBranchNotices([])
      if (name.startsWith('int-')) return api.integration.create(repoPath, name.slice('int-'.length))
      await api.sync.createBranch(repoPath, name)
      return null
    },
    onSuccess: async (designated, name) => {
      invalidate()
      if (!designated) return
      invalidateIntegration(qc, repoPath)
      // Push failed, default branch not aligned…: said here, the creation itself succeeded.
      setBranchNotices(designateNotices(designated, t))
      const outcome = await propagatePinToDependents(workspaceDir, flatNodes, { name: node.name, url: node.url }, name)
      setPinWarning(outcome)
    },
    onError: err => setBranchNotices([errorText(err)]),
  })

  const deleteBranchMutation = useMutation({
    mutationFn: (name: string) => {
      setBranchNotices([])
      return api.sync.deleteBranch(repoPath, name)
    },
    onSuccess: invalidate,
    // GH106 — e.g. the integration-branch guard refusing the deletion: never silent.
    onError: err => setBranchNotices([errorText(err)]),
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
    /** GH106 — failed create/delete (integration-branch guard included) and designation notices. */
    branchNotices,
    dismissBranchNotices: () => setBranchNotices([]),
    pinWarning,
    dismissPinWarning: () => setPinWarning(null),
  }
}

/** Message of a failed IPC call, without Electron's "Error invoking remote method '…': X: " prefix. */
function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')
}
