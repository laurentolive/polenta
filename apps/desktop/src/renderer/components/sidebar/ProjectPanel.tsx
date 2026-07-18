import { useEffect } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { encodeProjectId, decodeProjectId } from '../../lib/projectId'
import { markProjectJustClosed } from '../../lib/projectCloseSignal'

interface Props {
  currentProjectId: string | null
}

// ── Panel sans projet ──────────────────────────────────────────────────────────

function NoProjectPanel() {
  const { data: recents = [] } = useQuery({
    queryKey: ['workspace:list-recents'],
    queryFn: () => api.workspace.listRecents(),
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-edge">
        <p className="section-label">Projet</p>
      </div>

      {recents.length > 0 && (
        <div className="px-3 py-3 border-b border-edge-subtle">
          <p className="section-label mb-2">Récents</p>
          <div className="space-y-0.5">
            {recents.map(r => (
              <Link
                key={r.workspaceDir}
                to="/schema"
                search={{ repoPath: '', projectId: encodeProjectId(r.workspaceDir) }}
                onClick={() => api.workspace.markRecent(r.workspaceDir)}
                className="block rounded px-2 py-1.5 hover:bg-hover transition-colors text-sm"
              >
                <div className="font-medium text-ink truncate">{r.name}</div>
                <div className="text-xs text-ink-3 truncate">{r.workspaceDir}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Panel avec projet ──────────────────────────────────────────────────────────

function WithProjectPanel({ projectId }: { projectId: string }) {
  const navigate = useNavigate()

  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(projectId)),
  })

  const repoPath = project?.localPath ?? ''

  const handleClose = async () => {
    markProjectJustClosed()
    await api.workspace.clearLastOpened()
    api.app.setTitle('Polenta')
    navigate({ to: '/' })
  }

  useEffect(() => {
    if (project?.name && project?.localPath) {
      api.app.setTitle(`Polenta — ${project.name} — ${project.localPath}`)
    }
  }, [project?.name, project?.localPath])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-edge shrink-0">
        <p className="section-label">Projet</p>
        {project && (
          <div className="flex items-center justify-between mt-1">
            <p className="text-sm font-medium text-ink truncate flex-1">{project.name}</p>
            <button
              type="button"
              onClick={handleClose}
              className="text-xs text-ink-3 hover:text-ink ml-2 shrink-0 px-1"
              title="Fermer le projet"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-3">
          <div className="space-y-0.5">
            <Link
              to="/schema"
              search={{ repoPath, projectId }}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-ink-2 hover:text-ink hover:bg-hover rounded transition-colors"
            >
              <span className="inline-flex justify-center w-4 shrink-0">☰</span>
              <span>Modèle de données</span>
            </Link>
            <Link
              to="/preferences"
              search={{ repoPath, projectId }}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-ink-2 hover:text-ink hover:bg-hover rounded transition-colors"
            >
              <span className="inline-flex justify-center w-4 shrink-0">⚙</span>
              <span>Préférences</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Export ────────────────────────────────────────────────────────────────────

export function ProjectPanel({ currentProjectId }: Props) {
  if (!currentProjectId) return <NoProjectPanel />
  return <WithProjectPanel projectId={currentProjectId} />
}
