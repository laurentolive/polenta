import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { GitCompare, History, ListTree, Lock, Tag } from 'lucide-react'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'
import { useVersioning } from '../../contexts/VersioningContext'
import { useSelectedRepo } from '../../contexts/SelectedRepoContext'
import { useWorkspaceStructure } from '../../hooks/useWorkspaceStructure'
import { VersionRepoFolder } from './version/VersionRepoFolder'
import { VersionCompareSelector } from './version/VersionCompareSelector'
import { VersionImpactSelector } from './version/VersionImpactSelector'

interface Props {
  currentProjectId: string
  projectId: string
}

// ── VersionPanel ───────────────────────────────────────────────────────────────
// Orchestrates the multi-repo tree (T78): the header stays scoped to the root repo
// (readonly lock, baselines/graph/diff navigation — unaffected by which folder is
// expanded), each repo's own stage/modifications/checkout lives in VersionRepoFolder.

export function VersionPanel({ currentProjectId, projectId }: Props) {
  const navigate = useNavigate()
  const { isReadonly } = useVersioning()
  const { selectedRepoPath } = useSelectedRepo()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const isCompareView = pathname === '/version-diff'
  const isImpactView = pathname === '/impact-analysis'
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
      <div className="px-4 py-3 border-b border-edge shrink-0 flex items-center justify-between">
        <p className="section-label">{isCompareView ? 'Comparer' : isImpactView ? "Analyse d'impact" : 'Version'}</p>
        <div className="flex items-center gap-2">
          {isReadonly && (
            <span title="État figé — aucune branche extraite">
              <Lock size={11} className="text-amber-500" />
            </span>
          )}
          <button
            type="button"
            onClick={() => navigate({ to: '/baseline', search: { projectId } })}
            className="p-1 rounded text-prim hover:bg-hover transition-colors"
            title="Baselines"
          >
            <Tag size={14} />
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: '/graph', search: { projectId, sha: undefined } })}
            className="p-1 rounded text-prim hover:bg-hover transition-colors"
            title="Voir l'arbre de versions"
          >
            <History size={14} />
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: '/version-diff', search: { projectId, repoPath: selectedRepoPath, ref1: undefined, sha1: undefined, ref2: undefined, sha2: undefined } })}
            className="p-1 rounded text-prim hover:bg-hover transition-colors"
            title="Comparer deux versions"
          >
            <GitCompare size={14} />
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: '/impact-analysis', search: { projectId } })}
            className="p-1 rounded text-prim hover:bg-hover transition-colors"
            title="Analyse d'impact"
          >
            <ListTree size={14} />
          </button>
        </div>
      </div>

      {isCompareView ? (
        <div className="flex-1 overflow-hidden">
          <VersionCompareSelector projectId={projectId} />
        </div>
      ) : isImpactView ? (
        <div className="flex-1 overflow-hidden">
          <VersionImpactSelector projectId={projectId} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {isLoading && tree.length === 0 && !error && (
            <p className="px-4 py-2 text-xs text-ink-3 italic">Chargement…</p>
          )}
          {error && (
            <p className="px-4 py-2 text-xs text-red-500 leading-snug">{error}</p>
          )}
          {conflicts && conflicts.length > 0 && (
            <p className="px-4 py-2 text-xs text-amber-600 dark:text-amber-400 leading-snug">
              Conflit de dépendances à résoudre avant d'afficher l'arbre — ouvrez l'onglet
              Structure du Modèle de données pour le résoudre.
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
