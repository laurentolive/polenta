import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle } from 'lucide-react'
import { useMergeSession } from '../merge/useMergeSession'

/**
 * GH233 — panneau latéral « Fichiers en conflit », affiché pendant une résolution
 * (`/merge-resolve`) à la place du panneau « Projet » : fichiers de la session, état, conflits
 * restants. Le fichier ouvert est dans l'URL (`file`), partagé avec l'éditeur de résolution.
 */
export function MergeFilesPanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = useRouterState({ select: s => s.location.search as { id?: string; projectId?: string; file?: string } })
  const id = search.id ?? ''
  const { session: sessionQuery } = useMergeSession(id)
  const session = sessionQuery.data ?? null
  const select = (file: string) => navigate({ to: '/merge-resolve', search: { id, projectId: search.projectId ?? '', file }, replace: true })

  if (sessionQuery.isLoading) return <p className="p-3 text-xs text-ink-3 italic">{t('common.loading')}</p>
  // GH234 — a session that no longer exists is said so, not « Chargement… » forever.
  if (!session) return <p className="p-3 text-xs text-ink-3">{t('mergeResolve.noSession')}</p>
  const mergedCount = session.files.filter(f => f.state === 'merged').length
  return (
    <div className="flex flex-col min-h-0 h-full" data-testid="merge-files-panel">
      <div className="px-3 pt-3 pb-1 flex items-center gap-2">
        <p className="section-label flex-1">{t('mergeResolve.files')}</p>
        <span className="text-[11px] text-ink-3">{t('mergeResolve.progress', { merged: mergedCount, total: session.files.length })}</span>
      </div>
      <ul className="overflow-auto flex-1">
        {session.files.map(f => (
          <li key={f.path}>
            <button
              type="button"
              onClick={() => select(f.path)}
              className={`w-full text-left px-3 py-1.5 flex items-start gap-2 hover:bg-hover ${search.file === f.path ? 'bg-hover' : ''}`}
              aria-current={search.file === f.path || undefined}
            >
              {f.state === 'merged'
                ? <CheckCircle2 size={14} className="text-status-success shrink-0 mt-0.5" />
                : <Circle size={14} className="text-status-warning shrink-0 mt-0.5" />}
              <span className="min-w-0">
                <span className="block text-xs text-ink truncate">
                  {f.objectId ? `${f.objectId}${f.title ? ` — ${f.title}` : ''}` : f.path.split('/').pop()}
                </span>
                <span className="block text-[11px] text-ink-3 font-mono truncate">{f.path}</span>
                <span className="block text-[11px] text-ink-3">
                  {t(`mergeResolve.conflict.${f.conflict}`)}
                  {f.state === 'todo' && f.counts && f.counts.conflicts > 0 && (
                    <span className="ml-1.5 px-1 rounded bg-diff-conflict-bg text-status-warning font-medium" data-testid="file-conflict-count">
                      {t('mergeResolve.conflictCount', { count: f.counts.conflicts })}
                    </span>
                  )}
                  {f.counts && f.counts.auto > 0 && (
                    <span className="ml-1.5 text-ink-3">{t('mergeResolve.autoCount', { count: f.counts.auto })}</span>
                  )}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
