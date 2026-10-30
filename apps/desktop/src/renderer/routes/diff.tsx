import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ViewHeader } from '../components/layout/ViewHeader'
import { FileDiffView } from '../components/diff/FileDiffView'

export const Route = createFileRoute('/diff')({
  component: DiffPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    repoPath: (s['repoPath'] as string) || undefined,
    filepath: (s['filepath'] as string) ?? '',
    commitSha: (s['commitSha'] as string) || undefined,
  }),
})

function DiffPage() {
  const { projectId, repoPath: searchRepoPath, filepath, commitSha } = Route.useSearch()
  const navigate = useNavigate()

  // `repoPath` identifies which repo the file lives in (root or a submodule component) — passed
  // by the caller (sidebar/graph) since that's the only place that knows it. Falls back to the
  // root workspace path for older links that don't carry it (e.g. a stale bookmark/history entry).
  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(projectId)),
    enabled: !!projectId && !searchRepoPath,
  })
  const repoPath = searchRepoPath ?? project?.localPath ?? ''

  // Historical commit diff
  const { data: commitDiffData, isLoading: isLoadingCommit } = useQuery({
    queryKey: ['sync:commit-diff', repoPath, commitSha, filepath],
    queryFn: () => api.sync.commitDiff(repoPath, commitSha!, filepath),
    enabled: !!repoPath && !!commitSha && !!filepath,
  })

  // Working tree diff (current, no commit)
  const { data: workingDiffData, isLoading: isLoadingWorking } = useQuery({
    queryKey: ['sync:diff', repoPath, filepath],
    queryFn: () => api.sync.diff(repoPath, filepath),
    enabled: !!repoPath && !commitSha && !!filepath,
  })

  const diffData = commitSha ? commitDiffData : workingDiffData
  const isLoading = commitSha ? isLoadingCommit : isLoadingWorking


  // GH228 — diff d'un commit : retour au graphe positionné sur ce commit (page parente). Diff du
  // répertoire de travail : plus de bouton, Précédent de l'onglet fait la même chose.
  function backToGraph() {
    navigate({ to: '/graph', search: { projectId, sha: commitSha } })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        back={commitSha ? { onClick: backToGraph } : undefined}
        title={
          <span className="flex items-center gap-2 font-mono">
            {commitSha && (
              <span className="text-xs text-ink-3 shrink-0 bg-surface border border-edge rounded px-1.5 py-0.5">
                {commitSha.slice(0, 7)}
              </span>
            )}
            {filepath}
          </span>
        }
      />

      <div className="flex-1 min-h-0">
        <FileDiffView repoPath={repoPath} filepath={filepath} contents={diffData} isLoading={isLoading} showPath={false} />
      </div>
    </div>
  )
}
