import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useSelectedRepo } from '../contexts/SelectedRepoContext'
import { useCompareRefs } from '../contexts/CompareRefsContext'

export const Route = createFileRoute('/version-diff')({
  component: VersionDiffPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    repoPath: (s['repoPath'] as string) || undefined,
    ref1: (s['ref1'] as string) || undefined,
    sha1: (s['sha1'] as string) || undefined,
    ref2: (s['ref2'] as string) || undefined,
    sha2: (s['sha2'] as string) || undefined,
  }),
})

// ── Diff computation ────────────────────────────────────────────────────────────

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

// ── VersionDiffPage ─────────────────────────────────────────────────────────────
// The repo/commit pickers and the modified-files list live in the Version sidebar
// (VersionCompareSelector) — this page is just the diff viewer for whichever file is
// selected there, read via CompareRefsContext since sidebar and main content are siblings.

function VersionDiffPage() {
  const { selectedRepoPath } = useSelectedRepo()
  const { sha1, sha2, selectedFile } = useCompareRefs()
  const repoPath = selectedRepoPath

  const { data: fileDiff, isLoading: isLoadingDiff } = useQuery({
    queryKey: ['sync:diff-file-between', repoPath, sha1, sha2, selectedFile],
    queryFn: () => api.sync.diffFileBetween(repoPath, sha1!, sha2!, selectedFile!),
    enabled: !!repoPath && !!sha1 && !!sha2 && !!selectedFile,
  })

  const lines = fileDiff ? computeLineDiff(fileDiff.oldContent, fileDiff.newContent) : []
  const addCount = lines.filter(l => l.type === 'add').length
  const removeCount = lines.filter(l => l.type === 'remove').length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!selectedFile ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-ink-3 italic">Sélectionnez un fichier dans le panel Version</p>
        </div>
      ) : (
        <>
          {/* Sous-en-tête du diff */}
          <div className="px-4 py-2 border-b border-edge shrink-0 flex items-center gap-3">
            <p className="font-mono text-sm text-ink font-medium truncate flex-1">{selectedFile}</p>
            {!isLoadingDiff && fileDiff && (
              <p className="text-xs text-ink-3 shrink-0">
                <span className="text-green-600">+{addCount}</span>
                {' / '}
                <span className="text-red-500">−{removeCount}</span>
              </p>
            )}
          </div>

          {/* Contenu du diff */}
          <div className="flex-1 overflow-auto font-mono text-xs">
            {isLoadingDiff ? (
              <p className="text-ink-3 italic p-6">Chargement…</p>
            ) : lines.length === 0 ? (
              <p className="text-ink-3 italic p-6">Aucune différence</p>
            ) : (
              <table className="w-full border-collapse">
                <tbody>
                  {lines.map((line, idx) => (
                    <tr
                      key={idx}
                      className={
                        line.type === 'add'
                          ? 'bg-green-50 dark:bg-green-900/15'
                          : line.type === 'remove'
                          ? 'bg-red-50 dark:bg-red-900/15'
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
                        line.type === 'add' ? 'text-green-600' : line.type === 'remove' ? 'text-red-500' : 'text-ink-3'
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
        </>
      )}
    </div>
  )
}
