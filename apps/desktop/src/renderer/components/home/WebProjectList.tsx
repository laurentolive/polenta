import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Trash2 } from 'lucide-react'
import type { WebWorkspaceEntry } from '@polenta/api-client'
import { api } from '../../api'

interface Props {
  disabled: boolean
  onOpen: (workspaceDir: string) => void
}

/**
 * GH44 — « Mes projets » (version web) : les projets clonés dans l'espace serveur de l'utilisateur,
 * à la place du choix d'un dossier local. La suppression retire le clone serveur ; elle est
 * refusée tant qu'un repo a des modifications ou des commits non publiés, sauf confirmation.
 */
export function WebProjectList({ disabled, onOpen }: Props) {
  const { t } = useTranslation()
  const [projects, setProjects] = useState<WebWorkspaceEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    try {
      setProjects(await api.web.listWorkspaces())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => { void reload() }, [])

  async function handleDelete(project: WebWorkspaceEntry) {
    if (!window.confirm(t('home.web.deleteConfirm', { name: project.name }))) return
    setError(null)
    try {
      let result = await api.web.deleteWorkspace(project.workspaceDir)
      if (result.status === 'unpublished') {
        const ok = window.confirm(t('home.web.deleteUnpublished', { name: project.name, repos: result.repos.join(', ') }))
        if (!ok) return
        result = await api.web.deleteWorkspace(project.workspaceDir, true)
      }
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="rounded-xl border border-edge bg-surface p-4 space-y-2">
      <div className="flex items-center gap-2 text-ink font-medium">
        <FolderOpen size={18} />
        <span>{t('home.web.myProjects')}</span>
      </div>
      {projects === null ? (
        <p className="text-xs text-ink-3">{t('common.loading')}</p>
      ) : projects.length === 0 ? (
        <p className="text-xs text-ink-3">{t('home.web.noProjects')}</p>
      ) : (
        <ul className="divide-y divide-edge-subtle">
          {projects.map(project => (
            <li key={project.workspaceDir} className="flex items-center gap-2 py-1.5">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onOpen(project.workspaceDir)}
                className="flex-1 text-left text-sm text-ink hover:underline disabled:opacity-60"
              >
                {project.name}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void handleDelete(project)}
                title={t('home.web.delete')}
                className="btn-icon text-ink-3 hover:text-status-danger disabled:opacity-60"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="text-sm text-status-danger bg-status-danger-bg border border-status-danger-border rounded px-3 py-2">
          {error}
        </p>
      )}
    </div>
  )
}
