import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ExecutionHistoryTarget } from '@polenta/types'
import { api } from '../../api'
import { ExecutionHistoryGrid } from './ExecutionHistoryGrid'

// GH197 — section repliable « Exécutions (N) » d'un test ou d'une exigence (specs/GH197.md §4) :
// l'historique n'est chargé qu'à l'ouverture (Q7).

/** ID de la cible, pour le titre de l'export. */
function targetLabel(target: ExecutionHistoryTarget): string {
  if ('runId' in target) return target.runId
  if ('requirementId' in target) return target.requirementId
  if ('objectTypeRef' in target) return target.objectTypeRef
  return target.testId
}

interface Props {
  repoPath: string
  projectId?: string
  workspaceDir?: string
  target: ExecutionHistoryTarget
  /** `<nœud>::<type>` de l'objet : clé de la préférence de colonnes. */
  typeKey: string
}

export function ExecutionsSection({ repoPath, projectId, workspaceDir, target, typeKey }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['execution-history', repoPath, target, workspaceDir ?? null],
    queryFn: () => api.executions.history(repoPath, target, workspaceDir),
    enabled: open && !!repoPath,
    staleTime: 0,   // GH202 — « a évolué » suit les versions, modifiées ailleurs.
  })
  return (
    <details className="mt-2" onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="executions-section">
      <summary className="section-label cursor-pointer select-none">
        {t('executionHistory.title')}{data ? ` (${data.rows.length})` : ''}
      </summary>
      <div className="mt-2">
        {isLoading && <p className="text-xs text-ink-3">{t('common.loading')}</p>}
        {error && <p className="text-xs text-status-danger">{error instanceof Error ? error.message : String(error)}</p>}
        {data && (
          <ExecutionHistoryGrid repoPath={repoPath} projectId={projectId} history={data} typeKey={typeKey}
            withTestColumn={!('testId' in target)}
            title={`${t('executionHistory.title')} ${targetLabel(target)}`} />
        )}
      </div>
    </details>
  )
}
