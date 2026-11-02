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
    /** GH200 — diff d'un élément entre deux états : `baseSha` absent = création, `toSha` absent = disque.
     *  Clés facultatives : les autres liens vers `/diff` ne les portent pas. */
    ...(s['element'] ? { element: '1' } : {}),
    ...(s['baseSha'] ? { baseSha: s['baseSha'] as string } : {}),
    ...(s['toSha'] ? { toSha: s['toSha'] as string } : {}),
  }),
})

function DiffPage() {
  const { projectId, repoPath: searchRepoPath, filepath, commitSha, element, baseSha, toSha } = Route.useSearch()
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

  // GH200 — élément entre deux états : version de départ → commit (ou disque).
  const { data: elementDiffData, isLoading: isLoadingElement } = useQuery({
    queryKey: ['sync:diff-element', repoPath, filepath, baseSha, toSha],
    queryFn: () => api.sync.diffElement(repoPath, filepath, baseSha ?? null, toSha ?? null),
    enabled: !!repoPath && !!element && !!filepath,
  })

  // Historical commit diff
  const { data: commitDiffData, isLoading: isLoadingCommit } = useQuery({
    queryKey: ['sync:commit-diff', repoPath, commitSha, filepath],
    queryFn: () => api.sync.commitDiff(repoPath, commitSha!, filepath),
    enabled: !!repoPath && !!commitSha && !element && !!filepath,
  })

  // Working tree diff (current, no commit)
  const { data: workingDiffData, isLoading: isLoadingWorking } = useQuery({
    queryKey: ['sync:diff', repoPath, filepath],
    queryFn: () => api.sync.diff(repoPath, filepath),
    enabled: !!repoPath && !commitSha && !element && !!filepath,
  })

  const diffData = element ? elementDiffData : commitSha ? commitDiffData : workingDiffData
  const isLoading = element ? isLoadingElement : commitSha ? isLoadingCommit : isLoadingWorking


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
