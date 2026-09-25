import { useTranslation } from 'react-i18next'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'

interface Props {
  projectId: string
}

/** T171 — panneau latéral de la vue Paramètres : repos du workspace, filtre de la vue. */
export function ParametersPanel({ projectId }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const workspaceDir = decodeProjectId(projectId)
  const activeRepo = useRouterState({ select: s => new URLSearchParams(s.location.searchStr).get('repo') ?? undefined })

  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(workspaceDir),
    enabled: !!projectId,
  })
  const repoPath = project?.localPath ?? ''
  const { data: repos = [] } = useQuery({
    queryKey: ['parameters', workspaceDir, repoPath],
    queryFn: () => api.parameters.list(repoPath, workspaceDir || undefined),
    enabled: !!repoPath,
  })

  const select = (repo?: string) => navigate({ to: '/parameters', search: { projectId, repo } })
  const itemClass = (active: boolean) =>
    `w-full text-left px-4 py-1.5 text-xs flex items-center gap-2 transition-colors ${active ? 'bg-hover text-prim' : 'text-ink-2 hover:bg-hover'}`

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-edge shrink-0">
        <p className="section-label">{t('parameters.title')}</p>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        <button type="button" className={itemClass(!activeRepo)} onClick={() => select(undefined)}>
          {t('parameters.allRepos')}
        </button>
        {repos.map(r => (
          <button key={r.repoPath} type="button" className={itemClass(activeRepo === r.repoPath)} onClick={() => select(r.repoPath)}>
            <span className="truncate flex-1">{r.label ?? r.repoName}</span>
            {r.readonly && <Lock size={11} className="text-ink-3 shrink-0" />}
            <span className="text-ink-3 shrink-0">{r.parameters.length}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
