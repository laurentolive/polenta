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
      <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/60 rounded px-3 py-2 text-sm text-red-700 dark:text-red-400 max-w-lg mx-auto mt-8">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <span>
          {!dir
            ? 'Aucun workspace spécifié.'
            : `Ce projet n'est plus résolvable (${error instanceof Error ? error.message : String(error)}). Retournez à l'accueil pour l'ouvrir à nouveau.`}
        </span>
      </div>
    )
  }

  return <div className="text-sm text-ink-3">Redirection vers l'onglet Structure…</div>
}
