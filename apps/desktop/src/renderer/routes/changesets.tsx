import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ViewHeader } from '../components/layout/ViewHeader'
import { NoTypeForCategory } from '../components/system/NoTypeForCategory'
import { useProjectSchema, getAllObjectTypes } from '../hooks/useProjectSchema'
import { useSetTabTitle } from '../contexts/TabsContext'

/** GH198 — accueil de la vue Changements. URL : /changes?projectId=<encoded> */
export const Route = createFileRoute('/changesets')({
  component: ChangesHomePage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
  }),
})

function ChangesHomePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId } = Route.useSearch()
  useSetTabTitle(t('changes.title'))
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(workspaceDir),
    enabled: !!projectId,
  })
  const repoPath = project?.localPath ?? ''
  const { data: schema } = useProjectSchema(repoPath)
  const hasType = getAllObjectTypes(schema, 'changeset').length > 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader title={t('changes.title')} currentProjectId={projectId} />
      {!repoPath || !schema ? (
        <p className="p-8 text-sm text-ink-3">{repoPath ? t('common.loading') : t('common.projectNotLoaded')}</p>
      ) : !hasType ? (
        <NoTypeForCategory category="changeset" repoPath={repoPath} projectId={projectId} />
      ) : (
        <div className="p-8 space-y-3">
          <p className="text-sm text-ink-3">{t('changes.home')}</p>
          <button type="button" className="btn-primary-sm" onClick={() => navigate({ to: '/changeset/new', search: { projectId, repoPath: undefined, element: undefined, component: undefined } })}>
            {t('changes.new')}
          </button>
        </div>
      )}
    </div>
  )
}
