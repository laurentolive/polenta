import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { GitCompare, History, Lock, Tag } from 'lucide-react'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'
import { useVersioning } from '../../contexts/VersioningContext'
import { useSelectedRepo } from '../../contexts/SelectedRepoContext'
import { useWorkspaceStructure } from '../../hooks/useWorkspaceStructure'
import { VersionRepoFolder } from './version/VersionRepoFolder'
import { VersionCompareSelector } from './version/VersionCompareSelector'
import { BaselineListPanel } from './version/BaselineListPanel'

interface Props {
  currentProjectId: string
  projectId: string
}

// ── VersionPanel ───────────────────────────────────────────────────────────────
// Orchestrates the multi-repo tree (T78): the header stays scoped to the root repo
// (readonly lock, baselines/graph/diff navigation — unaffected by which folder is
// expanded), each repo's own stage/modifications/checkout/graph lives in VersionRepoFolder.
// The body follows the route: compare selector on /version-diff, baseline list on /baseline
// (GH40), repo tree otherwise.

export function VersionPanel({ currentProjectId, projectId }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isReadonly } = useVersioning()
  const { selectedRepoPath } = useSelectedRepo()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const isCompareView = pathname === '/version-diff'
  // GH40: while /baseline is open the panel lists the baselines (the view holds the creation form).
  const isBaselineView = pathname === '/baseline'
  const workspaceDir = decodeProjectId(projectId)

  const { data: project } = useQuery({
    queryKey: ['workspace', currentProjectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId)),
  })
  const repoPath = project?.localPath ?? ''

  const { isLoading, error, conflicts, tree, flatNodes } = useWorkspaceStructure(workspaceDir, repoPath)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-edge shrink-0 flex items-center justify-between">
        <p className="section-label">
          {isCompareView ? t('sidebar.version.compareTitle') : isBaselineView ? t('sidebar.version.baselinesTitle') : t('sidebar.version.title')}
        </p>
        <div className="flex items-center gap-2">
          {isReadonly && (
            <span title={t('sidebar.version.readonlyTooltip')}>
              <Lock size={11} className="text-status-warning" />
            </span>
          )}
          <button
            type="button"
            onClick={() => navigate({ to: '/baseline', search: { projectId } })}
            className="btn-icon text-prim"
            title={t('sidebar.version.baselines')}
          >
            <Tag size={14} />
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: '/graph', search: { projectId, sha: undefined } })}
            className="btn-icon text-prim"
            title={t('sidebar.version.viewGraph')}
          >
            <History size={14} />
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: '/version-diff', search: { projectId, repoPath: selectedRepoPath, ref1: undefined, sha1: undefined, ref2: undefined, sha2: undefined } })}
            className="btn-icon text-prim"
            title={t('sidebar.version.compareVersions')}
          >
            <GitCompare size={14} />
          </button>
        </div>
      </div>

      {isCompareView ? (
        <div className="flex-1 overflow-hidden">
          <VersionCompareSelector projectId={projectId} />
        </div>
      ) : isBaselineView ? (
        <div className="flex-1 overflow-hidden">
          <BaselineListPanel projectId={projectId} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-0.5">
          {isLoading && tree.length === 0 && !error && (
            <p className="px-4 py-2 text-xs text-ink-3 italic">{t('common.loading')}</p>
          )}
          {error && (
            <p className="px-4 py-2 text-xs text-status-danger leading-snug">{error}</p>
          )}
          {conflicts && conflicts.length > 0 && (
            <p className="px-4 py-2 text-xs text-status-warning leading-snug">
              {t('sidebar.version.dependencyConflict')}
            </p>
          )}
          {/* `tree` never has more than one top-level entry (the workspace root, or a single
              synthetic node for a bare repo) — that entry is always the root, no need to compare
              repoPath (which can still be '' while the `project` query is in flight). */}
          {tree.map(node => (
            <VersionRepoFolder
              key={node.name}
              node={node}
              depth={0}
              projectId={projectId}
              workspaceDir={workspaceDir}
              flatNodes={flatNodes}
            />
          ))}
        </div>
      )}
    </div>
  )
}
