/**
 * Legacy route — retired T70 Sprint 3.
 *
 * The dedicated workspace view (repo tree, diamond-conflict resolution, rebuild)
 * has been folded into the Structure tab of the Modèle de données page. This
 * route now only exists so old links/bookmarks to /workspace?dir=... redirect
 * there instead of 404ing (T70 CA-6).
 *
 * URL: /workspace?dir=<workspace dir>
 */

import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { api } from '../api'
import { encodeProjectId } from '../lib/projectId'

export const Route = createFileRoute('/workspace')({
  component: WorkspaceRedirectPage,
  validateSearch: (s: Record<string, unknown>) => ({
    dir: (s['dir'] as string) ?? '',
  }),
})

function WorkspaceRedirectPage() {
  const { t } = useTranslation()
  const { dir } = Route.useSearch()
  const navigate = useNavigate()

  const { data: project, error } = useQuery({
    queryKey: ['workspace', dir],
    queryFn: () => api.workspace.resolve(dir),
    enabled: !!dir,
    retry: false,
  })

  useEffect(() => {
    if (project) {
      navigate({
        to: '/schema',
        search: { repoPath: project.localPath, projectId: encodeProjectId(dir) },
        replace: true,
      })
    }
  }, [project, dir, navigate])

  if (!dir || error) {
    return (
      <div className="flex items-start gap-2 bg-status-danger-bg border border-status-danger-border rounded px-3 py-2 text-sm text-status-danger max-w-lg mx-auto mt-8">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <span>
          {!dir
            ? t('workspace.noWorkspace')
            : t('workspace.notResolvable', { error: error instanceof Error ? error.message : String(error) })}
        </span>
      </div>
    )
  }

  return <div className="text-sm text-ink-3">{t('workspace.redirecting')}</div>
}
