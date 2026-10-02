import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { useWorkspaceStructure } from './useWorkspaceStructure'

const AUTO_PULL_INTERVAL_MS = 5 * 60 * 1000

/**
 * T155: periodically fast-forwards every repo in the workspace (root + components/interfaces)
 * while a project is open, regardless of which panel/tab is active — the whole point is that a
 * non-git-initiated user should never have to know a manual "Rafraîchir" (T153) exists at all.
 *
 * Deliberately does NOT run on mount/project-open: opening a project already does its own (slow)
 * repo resolution — see `WorkspaceTreeService` — piling more network calls onto that moment would
 * make it worse (explicit product decision). `setInterval` naturally defers its first tick, so
 * "no pull at startup" falls out of the implementation for free — no special-casing needed.
 *
 * Each tick is one `SyncService.autoSync` per repo (GH39), with the T153/T155 safety layers:
 * - A repo with staged/unstaged changes is never fast-forwarded (same guard as the manual
 *   Rafraîchir button) — but it is still fetched, so its integration state reflects the server.
 * - Fast-forward only — a real 3-way merge (and the conflict markers it can write into the working
 *   directory) must never happen without the user asking for it. A diverged integration is left
 *   alone; the sync indicator surfaces it and "Resynchroniser" is the way out (GH39).
 * - An integration branch only *ahead* of origin (a push after "Publier" failed) gets its push
 *   retried — that push never touches the working tree.
 *
 * No popup: success is invisible (repo statuses refresh on their own next 3s poll) and a failure
 * (offline, auth, rejected push) is logged and kept as the repo's last sync error
 * (`['sync:last-error', repoPath]`, shown by the sync indicator), then retried next tick.
 */
export function useAutoPull(currentProjectId: string | null): void {
  const qc = useQueryClient()

  const { data: project } = useQuery({
    queryKey: ['workspace', currentProjectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId as string)),
    enabled: !!currentProjectId,
  })

  const rootRepoPath = project?.localPath ?? ''
  const { flatNodes } = useWorkspaceStructure(project?.workspaceDir ?? '', rootRepoPath)

  useEffect(() => {
    if (!currentProjectId || !rootRepoPath) return

    const repoPaths = Array.from(new Set([rootRepoPath, ...flatNodes.map(n => n.repoPath)].filter(Boolean)))

    async function autoSync(repoPath: string) {
      try {
        const integrationBranch = await api.baseline.getIntegrationBranch(repoPath)
        const { state } = await api.sync.autoSync(repoPath, integrationBranch)
        // A tick that didn't fail doesn't explain away an earlier one: while the integration is
        // still ahead/diverged, keep the error (e.g. the push "Publier" saw rejected) that led there.
        if (state !== 'ahead' && state !== 'diverged') qc.setQueryData(['sync:last-error', repoPath], null)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[auto-pull] ${repoPath}:`, message)
        qc.setQueryData(['sync:last-error', repoPath], message)
      } finally {
        qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
        qc.invalidateQueries({ queryKey: ['sync:integration-state', repoPath] })
      }
    }

    const id = setInterval(() => {
      for (const repoPath of repoPaths) void autoSync(repoPath)
    }, AUTO_PULL_INTERVAL_MS)

    return () => clearInterval(id)
  }, [currentProjectId, rootRepoPath, flatNodes, qc])
}
