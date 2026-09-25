import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ViewHeader } from '../components/layout/ViewHeader'
import { ParametersView } from '../components/parameters/ParametersView'
import { useSetTabTitle } from '../contexts/TabsContext'

/** T171 — vue Paramètres. URL : /parameters?projectId=<encoded>&repo=<repoPath?> */
export const Route = createFileRoute('/parameters')({
  component: ParametersPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    repo: s['repo'] as string | undefined,
  }),
})

function ParametersPage() {
  const { t } = useTranslation()
  const { projectId, repo } = Route.useSearch()
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  useSetTabTitle(t('parameters.title'))

  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(workspaceDir),
    enabled: !!projectId,
  })
  const repoPath = project?.localPath ?? ''

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader title={t('parameters.title')} currentProjectId={projectId} />
      {repoPath
        ? <ParametersView repoPath={repoPath} workspaceDir={workspaceDir} projectId={projectId} repoFilter={repo} />
        : <p className="p-8 text-sm text-ink-3">{t('common.projectNotLoaded')}</p>}
    </div>
  )
}
