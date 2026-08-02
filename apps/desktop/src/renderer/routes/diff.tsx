import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ViewHeader } from '../components/layout/ViewHeader'

export const Route = createFileRoute('/diff')({
  component: DiffPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    repoPath: (s['repoPath'] as string) || undefined,
    filepath: (s['filepath'] as string) ?? '',
    commitSha: (s['commitSha'] as string) || undefined,
  }),
})

type DiffLine = { type: 'context' | 'add' | 'remove'; content: string; lineNum: number }

function computeLineDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent ? oldContent.split('\n') : []
  const newLines = newContent ? newContent.split('\n') : []

  const m = Math.min(oldLines.length, 2000)
  const n = Math.min(newLines.length, 2000)

  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const result: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'context', content: oldLines[i - 1], lineNum: j })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', content: newLines[j - 1], lineNum: j })
      j--
    } else {
      result.unshift({ type: 'remove', content: oldLines[i - 1], lineNum: i })
      i--
    }
  }
  return result
}

function DiffPage() {
  const { t } = useTranslation()
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

  const lines = diffData ? computeLineDiff(diffData.oldContent, diffData.newContent) : []
  const addCount = lines.filter(l => l.type === 'add').length
  const removeCount = lines.filter(l => l.type === 'remove').length

  function handleBack() {
    if (commitSha) {
      navigate({ to: '/graph', search: { projectId, sha: commitSha } })
    } else {
      window.history.back()
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        back={{ onClick: handleBack }}
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
        subtitle={
          <>
            <span className="text-status-success">+{addCount}</span>
            {' / '}
            <span className="text-status-danger">−{removeCount}</span>
          </>
        }
      />

      {/* Diff content */}
      <div className="flex-1 overflow-auto font-mono text-xs">
        {isLoading ? (
          <p className="text-ink-3 italic p-6">{t('common.loading')}</p>
        ) : lines.length === 0 ? (
          <p className="text-ink-3 italic p-6">{t('diffPage.noDifference')}</p>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, idx) => (
                <tr
                  key={idx}
                  className={
                    line.type === 'add'
                      ? 'bg-status-success-bg dark:bg-status-success-bg/15'
                      : line.type === 'remove'
                      ? 'bg-status-danger-bg dark:bg-status-danger-bg/15'
                      : ''
                  }
                >
                  <td className="select-none text-right px-2 py-px text-ink-3 w-10 border-r border-edge-subtle align-top">
                    {line.type !== 'add' ? line.lineNum : ''}
                  </td>
                  <td className="select-none text-right px-2 py-px text-ink-3 w-10 border-r border-edge-subtle align-top">
                    {line.type !== 'remove' ? line.lineNum : ''}
                  </td>
                  <td className={`px-1 py-px w-6 select-none text-center font-bold align-top ${
                    line.type === 'add' ? 'text-status-success' : line.type === 'remove' ? 'text-status-danger' : 'text-ink-3'
                  }`}>
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
                  </td>
                  <td className="px-3 py-px text-ink whitespace-pre-wrap break-all">{line.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
