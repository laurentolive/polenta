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
 * Two safety layers, both required — see specs/T154.md and the T153/T155 discussion:
 * - Skips any repo with staged/unstaged changes (same guard as the manual Rafraîchir button).
 * - Uses `pullFastForwardOnly` rather than `pull` — a real 3-way merge (and the conflict markers
 *   it can write into the working directory) must never happen without the user asking for it.
 *   A repo that can't fast-forward (local has unpushed commits diverging from origin — the rare,
 *   pre-existing case T154 documents) is just skipped, not merged.
 *
 * Silent by design: success is invisible (repo statuses refresh on their own next 3s poll) and a
 * skip/failure (dirty repo, offline, diverged, auth) is logged, not surfaced — a technical git
 * error about a network action the user never asked for would be worse than trying again in
 * `AUTO_PULL_INTERVAL_MS`.
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

    async function pullIfClean(repoPath: string) {
      try {
        const status = await api.sync.status(repoPath)
        if (status.staged.length > 0 || status.unstaged.length > 0) return
        await api.sync.pullFastForwardOnly(repoPath)
        qc.invalidateQueries({ queryKey: ['sync:status', repoPath] })
      } catch (err) {
        console.warn(`[auto-pull] skipped ${repoPath}:`, err instanceof Error ? err.message : err)
      }
    }

    const id = setInterval(() => {
      for (const repoPath of repoPaths) void pullIfClean(repoPath)
    }, AUTO_PULL_INTERVAL_MS)

    return () => clearInterval(id)
  }, [currentProjectId, rootRepoPath, flatNodes, qc])
}
