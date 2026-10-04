/**
 * GH39 — where each repo's configured integration branch stands against `origin`, and the
 * "Resynchroniser" action. Shared by the header sync indicator (`SyncIndicator`) and the Version
 * panel (`VersionRepoFolder`) — see specs/GH39.md §3.1–3.2.
 *
 * Three per-repo query keys:
 * - `['sync:integration-state', repoPath]` — local refs only (as of the last fetch, done by the
 *   auto-pull, "Publier" or "Resynchroniser"), no network, but a history walk in the main process:
 *   polled every 30s only, and invalidated right after every action that can change it.
 * - `['sync:last-error', repoPath]` — last push/sync error, written with `setQueryData` by the
 *   auto-pull, "Publier"'s push and "Resynchroniser". Never fetched.
 * - `['sync:pushing', repoPath]` — true while "Publier"'s push runs: the integration is
 *   legitimately ahead for those few seconds, not worth an alert.
 */

import { useMutation, useMutationState, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type { IntegrationRemoteState, ResyncOutcome } from '@polenta/api-client'
import type { WorkspaceTreeNode } from '@polenta/types'

export interface IntegrationSyncInfo extends IntegrationRemoteState {
  integrationBranch: string
}

export function integrationStateQuery(repoPath: string) {
  return {
    queryKey: ['sync:integration-state', repoPath],
    queryFn: async (): Promise<IntegrationSyncInfo> => {
      const integrationBranch = await api.baseline.getIntegrationBranch(repoPath)
      return { integrationBranch, ...(await api.sync.integrationState(repoPath, integrationBranch)) }
    },
    enabled: !!repoPath,
    refetchInterval: 30_000,
  }
}

const RESYNC_MUTATION_KEY = ['sync:resync-integration']

/** A value only ever written through `setQueryData` — the query just exposes it reactively. */
function cachedValueQuery<T>(key: string, repoPath: string, initial: T) {
  return {
    queryKey: [key, repoPath],
    queryFn: () => initial,
    enabled: !!repoPath,
    staleTime: Infinity,
    gcTime: Infinity,
  }
}

export const lastErrorQuery = (repoPath: string) => cachedValueQuery<string | null>('sync:last-error', repoPath, null)
export const pushingQuery = (repoPath: string) => cachedValueQuery<boolean>('sync:pushing', repoPath, false)

/** Worth an alert: diverged, or ahead (unpushed) while no push is in flight. */
export function isSyncAlert(info: IntegrationRemoteState | undefined, pushing: boolean): boolean {
  if (!info) return false
  return info.state === 'diverged' || (info.state === 'ahead' && !pushing)
}

export interface RepoSyncView {
  info: IntegrationSyncInfo | undefined
  lastError: string | null
  alert: boolean
}

export function useRepoIntegrationSync(repoPath: string): RepoSyncView {
  const { data: info } = useQuery(integrationStateQuery(repoPath))
  const { data: lastError } = useQuery(lastErrorQuery(repoPath))
  const { data: pushing } = useQuery(pushingQuery(repoPath))
  return { info, lastError: lastError ?? null, alert: isSyncAlert(info, !!pushing) }
}

export interface RepoSyncAlert extends RepoSyncView {
  node: WorkspaceTreeNode
  info: IntegrationSyncInfo
}

/** Every repo of `nodes` currently in alert, in `nodes` order. */
export function useWorkspaceSyncAlerts(nodes: WorkspaceTreeNode[]): RepoSyncAlert[] {
  const states = useQueries({ queries: nodes.map(n => integrationStateQuery(n.repoPath)) })
  const errors = useQueries({ queries: nodes.map(n => lastErrorQuery(n.repoPath)) })
  const pushing = useQueries({ queries: nodes.map(n => pushingQuery(n.repoPath)) })
  const alerts: RepoSyncAlert[] = []
  nodes.forEach((node, i) => {
    const info = states[i]?.data
    if (info && isSyncAlert(info, !!pushing[i]?.data)) {
      alerts.push({ node, info, lastError: errors[i]?.data ?? null, alert: true })
    }
  })
  return alerts
}

/**
 * "Resynchroniser" for one repo. Errors are kept as the repo's last sync error (so they show
 * wherever the repo's sync state does) and returned translated; a `set-aside` outcome is returned
 * so the caller can explain where the local commits went.
 *
 * Every instance (header popover, each Version panel row) shares one mutation key, and
 * `anyPending` reflects all of them: two resyncs at once — on one repo from two places, or on two
 * repos — are never offered.
 */
export function useResyncIntegration() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationKey: RESYNC_MUTATION_KEY,
    mutationFn: async ({ repoPath }: { repoPath: string; repoName: string }): Promise<ResyncOutcome> => {
      const integrationBranch = await api.baseline.getIntegrationBranch(repoPath)
      return api.sync.resyncIntegration(repoPath, integrationBranch)
    },
    onSuccess: (_outcome, { repoPath }) => qc.setQueryData(['sync:last-error', repoPath], null),
    onError: (err, { repoPath, repoName }) => qc.setQueryData(['sync:last-error', repoPath], resyncErrorMessage(err, repoName)),
    onSettled: (_data, _err, { repoPath }) => {
      qc.invalidateQueries({ queryKey: ['sync:integration-state', repoPath] })
      qc.invalidateQueries({ queryKey: ['sync:status'] })
      qc.invalidateQueries({ queryKey: ['sync:branches', repoPath] })
      qc.invalidateQueries({ queryKey: ['sync:graph', repoPath] })
    },
  })

  function resyncErrorMessage(err: unknown, repoName: string): string {
    const message = err instanceof Error ? err.message : String(err)
    return message.includes('integration-dirty') ? t('layout.syncIndicator.resyncDirty', { repo: repoName }) : message
  }

  const anyPending = useMutationState({ filters: { mutationKey: RESYNC_MUTATION_KEY, status: 'pending' } }).length > 0

  return {
    resync: (repoPath: string, repoName: string) => { if (!anyPending) mutation.mutate({ repoPath, repoName }) },
    /** A resync is running somewhere in the app — every Resynchroniser button is disabled. */
    anyPending,
    /** Repo currently being resynchronized, if any. */
    pendingRepoPath: mutation.isPending ? mutation.variables?.repoPath ?? null : null,
    /** Branch the local commits were set aside on by the last resync, with its repo. */
    setAside: mutation.data?.outcome === 'set-aside' && mutation.variables
      ? { repoPath: mutation.variables.repoPath, branch: mutation.data.branch }
      : null,
    reset: mutation.reset,
  }
}
