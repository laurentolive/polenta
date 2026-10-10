import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'

/**
 * GH45 S4 — diagnostic des droits à l'ouverture d'un projet (spec §8) : si le compte n'a que la
 * lecture sur le repo racine, bandeau non bloquant. Les actions d'édition restent possibles en V1 :
 * le refus arrive à la publication (message §5.3). Hors ligne ou forge non Forgejo : rien.
 * Les dépendances inaccessibles sont signalées au chargement de l'arbre (message GH30, §5.4).
 */
export function RepoAccessBanner({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState<string | null>(null)

  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(projectId)),
  })
  const rootRepoPath = project?.localPath
  const { data: access } = useQuery({
    queryKey: ['forge-repo-access', rootRepoPath],
    queryFn: () => api.forge.repoAccess(rootRepoPath!),
    enabled: !!rootRepoPath,
    staleTime: 5 * 60_000,
    retry: false,
  })

  if (!access || access.push || dismissed === rootRepoPath) return null

  return (
    <div role="status" className="shrink-0 flex items-center gap-3 px-4 py-2 text-sm border-b border-status-info-border bg-status-info-bg text-ink">
      <span className="flex-1">{t('forgeAccess.readOnlyProject', { repo: access.repo })}</span>
      <button type="button" onClick={() => setDismissed(rootRepoPath ?? null)} aria-label={t('common.close')}
        className="text-ink-3 hover:text-ink">
        <X size={14} />
      </button>
    </div>
  )
}
