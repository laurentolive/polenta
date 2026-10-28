import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useSelectedRepo } from '../contexts/SelectedRepoContext'
import { useCompareRefs } from '../contexts/CompareRefsContext'
import { FileDiffView } from '../components/diff/FileDiffView'

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

// ── VersionDiffPage ─────────────────────────────────────────────────────────────
// The repo/commit pickers and the modified-files list live in the Version sidebar
// (VersionCompareSelector) — this page is just the diff viewer for whichever file is
// selected there, read via CompareRefsContext since sidebar and main content are siblings.

function VersionDiffPage() {
  const { t } = useTranslation()
  const { selectedRepoPath } = useSelectedRepo()
  const { sha1, sha2, selectedFile } = useCompareRefs()
  const repoPath = selectedRepoPath

  const { data: fileDiff, isLoading: isLoadingDiff } = useQuery({
    queryKey: ['sync:diff-file-between', repoPath, sha1, sha2, selectedFile],
    queryFn: () => api.sync.diffFileBetween(repoPath, sha1!, sha2!, selectedFile!),
    enabled: !!repoPath && !!sha1 && !!sha2 && !!selectedFile,
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!selectedFile ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-ink-3 italic">{t('versionDiffPage.selectFileHint')}</p>
        </div>
      ) : (
        <FileDiffView repoPath={repoPath} filepath={selectedFile} contents={fileDiff} isLoading={isLoadingDiff} />
      )}
    </div>
  )
}
