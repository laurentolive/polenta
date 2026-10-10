import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import type { TeamProjectEntry } from '@polenta/types'
import { api } from '../../api'
import { useTeamConfig } from '../../hooks/useTeamConfig'

/**
 * GH45 S2b — « Projets de votre équipe » (spec §3bis-6) : projets proposés par la configuration du
 * serveur, limités à ceux auxquels l'utilisateur a accès. Rien à afficher → rien n'est rendu.
 */
export function TeamProjects({ disabled, onOpen }: { disabled: boolean; onOpen: (p: TeamProjectEntry) => void }) {
  const { t } = useTranslation()
  const status = useTeamConfig()
  const configured = status?.config?.projects ?? []
  const { data: projects = [] } = useQuery({
    queryKey: ['team-projects', status?.server, status?.fetchedAt],
    queryFn: () => api.app.teamProjects(),
    enabled: configured.length > 0,
    staleTime: 5 * 60 * 1000,
  })
  if (projects.length === 0) return null

  return (
    <section className="space-y-2" aria-label={t('home.team.title')}>
      <p className="section-label flex items-center gap-1.5">
        <Users size={13} className="text-ink-3" />
        {t('home.team.title')}
      </p>
      <ul className="space-y-1.5">
        {projects.map(project => (
          <li key={project.repo}>
            <button type="button" disabled={disabled} onClick={() => onOpen(project)}
              className="w-full flex items-center justify-between gap-3 text-left rounded-lg border border-edge bg-surface px-4 py-2.5 hover:bg-surface-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink truncate">{project.label ?? project.repo.split('/')[1]}</span>
                <span className="block text-xs text-ink-3 font-mono truncate">{project.repo}</span>
              </span>
              <span className="text-xs text-ink-2 shrink-0">{t('home.team.open')}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
