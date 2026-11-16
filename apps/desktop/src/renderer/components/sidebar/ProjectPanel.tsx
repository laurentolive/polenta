import { useState } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AppWindow } from 'lucide-react'
import { api } from '../../api'
import { encodeProjectId, decodeProjectId } from '../../lib/projectId'
import { markProjectJustClosed } from '../../lib/projectCloseSignal'
import { NodeContextMenu } from '../../tiptap/NodeContextMenu'

interface Props {
  currentProjectId: string | null
}

/** GH343 — page d'un projet récent (même destination que le clic sur le récent). */
function recentHref(workspaceDir: string): string {
  return `/schema?${new URLSearchParams({ repoPath: '', projectId: encodeProjectId(workspaceDir) })}`
}

/** GH343 — nouvelle fenêtre sur l'accueil, sans saut vers le dernier projet (web : nouvel onglet). */
function NewWindowButton() {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => { void api.app.openWindow('/') }}
      title={t('sidebar.project.newWindow')}
      data-testid="project-new-window"
      className="text-ink-3 hover:text-ink ml-2 shrink-0 px-1"
    >
      <AppWindow size={13} />
    </button>
  )
}

// ── Panel sans projet ──────────────────────────────────────────────────────────

function NoProjectPanel() {
  const { t } = useTranslation()
  const { data: recents = [] } = useQuery({
    queryKey: ['workspace:list-recents'],
    queryFn: () => api.workspace.listRecents(),
  })
  // GH343 — clic droit sur un récent : « Ouvrir dans une nouvelle fenêtre ».
  const [menu, setMenu] = useState<{ x: number; y: number; workspaceDir: string } | null>(null)
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-edge flex items-center justify-between">
        <p className="section-label">{t('sidebar.project.title')}</p>
        <NewWindowButton />
      </div>

      {recents.length > 0 && (
        <div className="px-3 py-3 border-b border-edge-subtle">
          <p className="section-label mb-2">{t('sidebar.project.recents')}</p>
          <div className="space-y-0.5">
            {recents.map(r => (
              <Link
                key={r.workspaceDir}
                to="/schema"
                search={{ repoPath: '', projectId: encodeProjectId(r.workspaceDir) }}
                onClick={() => api.workspace.markRecent(r.workspaceDir)}
                onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, workspaceDir: r.workspaceDir }) }}
                data-testid="project-recent"
                className="block rounded px-2 py-1.5 hover:bg-hover transition-colors text-sm"
              >
                <div className="font-medium text-ink truncate">{r.name}</div>
                <div className="text-xs text-ink-3 truncate">{r.workspaceDir}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
      {menu && (
        <NodeContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[{
            id: 'open-window',
            label: t('layout.tabBar.openInNewWindow'),
            onSelect: () => {
              void api.workspace.markRecent(menu.workspaceDir)
              void api.app.openWindow(recentHref(menu.workspaceDir))
            },
          }]}
        />
      )}
    </div>
  )
}

// ── Panel avec projet ──────────────────────────────────────────────────────────

function WithProjectPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(projectId)),
  })

  const repoPath = project?.localPath ?? ''
  const displayName = project?.label || project?.name

  // Le titre de fenêtre (y compris au retour à l'accueil) est tenu par useWindowTitle (GH338).
  // GH343 — le dernier projet ouvert n'est effacé que s'il désigne ce projet et qu'aucune autre
  // fenêtre ne l'affiche : fermer le projet ici ne touche pas aux autres fenêtres.
  const handleClose = async () => {
    markProjectJustClosed()
    try {
      const elsewhere = await api.app.projectShownElsewhere(projectId).catch(() => false)
      if (!elsewhere) await api.workspace.clearLastOpened(decodeProjectId(projectId))
    } catch {
      // projectId illisible ou écriture impossible : le projet se ferme quand même dans la fenêtre.
    }
    navigate({ to: '/' })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-edge shrink-0">
        <p className="section-label">{t('sidebar.project.title')}</p>
        {project && (
          <>
            <div className="flex items-center justify-between mt-1">
              <p className="text-sm font-medium text-ink truncate flex-1">{displayName}</p>
              <NewWindowButton />
              <button
                type="button"
                onClick={handleClose}
                className="text-xs text-ink-3 hover:text-ink ml-2 shrink-0 px-1"
                title={t('sidebar.project.closeProject')}
              >
                ✕
              </button>
            </div>
            {project.remoteUrl && (
              <p className="text-xs text-ink-3 truncate mt-0.5" title={project.remoteUrl}>
                {project.remoteUrl}
              </p>
            )}
          </>
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
              <span>{t('sidebar.project.dataModel')}</span>
            </Link>
            <Link
              to="/preferences"
              search={{ repoPath, projectId }}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-ink-2 hover:text-ink hover:bg-hover rounded transition-colors"
            >
              <span className="inline-flex justify-center w-4 shrink-0">⚙</span>
              <span>{t('sidebar.project.preferences')}</span>
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
