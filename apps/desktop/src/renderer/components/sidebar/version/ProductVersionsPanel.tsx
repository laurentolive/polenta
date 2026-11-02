import { useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Inbox, Lock, Package, Plus } from 'lucide-react'
import type { VersionComponentNode } from '@polenta/types'
import { decodeProjectId } from '../../../lib/projectId'
import { NewVersionDialog } from '../../versions/NewVersionDialog'
import { STATE_BADGE, useVersionTree } from '../../versions/useVersions'

/**
 * GH201 §6 — sous-panneau « Produit » du panneau Version : arbre des composants (repos), versions
 * de chacun, backlog, « Nouvelle version ».
 */
export function ProductVersionsPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const { data: tree, isLoading, error } = useVersionTree(projectId)
  const [showAbandoned, setShowAbandoned] = useState(false)

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="product-versions-panel">
      <label className="flex items-center gap-2 px-4 py-1.5 text-xs text-ink-3 border-b border-edge-subtle shrink-0">
        <input type="checkbox" checked={showAbandoned} onChange={e => setShowAbandoned(e.target.checked)} />
        {t('versions.showAbandoned')}
      </label>
      <div className="flex-1 overflow-y-auto py-0.5">
        {isLoading && <p className="px-4 py-2 text-xs text-ink-3 italic">{t('common.loading')}</p>}
        {error && <p className="px-4 py-2 text-xs text-status-danger">{String(error)}</p>}
        {tree?.map(node => <ComponentRow key={node.repoPath} node={node} depth={0} projectId={projectId} showAbandoned={showAbandoned} />)}
      </div>
    </div>
  )
}

function ComponentRow({ node, depth, projectId, showAbandoned }: {
  node: VersionComponentNode
  depth: number
  projectId: string
  showAbandoned: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = useRouterState({ select: s => s.location.search as Record<string, unknown> })
  const pathname = useRouterState({ select: s => s.location.pathname })
  const [open, setOpen] = useState(true)
  const [creating, setCreating] = useState(false)
  const pad = { paddingLeft: `${12 + depth * 12}px` }
  const versions = node.versions.filter(v => showAbandoned || v.state !== 'abandoned')
  const inProgress = node.versions.find(v => v.state === 'in_progress')
  const rowClass = (active: boolean) =>
    `w-full flex items-center gap-2 pr-3 py-1 text-xs text-left ${active ? 'bg-hover text-prim font-medium' : 'text-ink-2 hover:bg-hover'}`
  const sameRepo = search['repoPath'] === node.repoPath

  return (
    <div>
      <div className="flex items-center gap-1 pr-2 py-1 group" style={pad}>
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 flex-1 min-w-0 text-xs font-medium text-ink">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Package size={12} className="shrink-0 text-chart-4" />
          <span className="truncate">{node.label}</span>
          {node.readonly && <Lock size={10} className="text-status-warning shrink-0" />}
        </button>
        {node.versionType && !node.readonly && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!!inProgress}
            title={inProgress ? t('versions.new.inProgressExists', { id: inProgress.id }) : t('versions.new.title')}
            className="btn-icon text-prim disabled:opacity-40"
            data-testid={`new-version-${node.name}`}
          >
            <Plus size={13} />
          </button>
        )}
      </div>
      {open && (
        <div>
          {!node.versionType ? (
            <p className="text-xs text-ink-3 italic py-1" style={{ paddingLeft: `${30 + depth * 12}px` }}>{t('versions.noType')}</p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => navigate({ to: '/versions/backlog', search: { projectId, repoPath: node.repoPath } })}
                className={rowClass(pathname === '/versions/backlog' && sameRepo)}
                style={{ paddingLeft: `${30 + depth * 12}px` }}
                data-testid={`version-backlog-${node.name}`}
              >
                <Inbox size={12} className="shrink-0" />
                <span className="flex-1 truncate">{t('versions.backlog.title')}</span>
                <span className="text-ink-3">{node.backlogCount}</span>
              </button>
              {versions.map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => navigate({ to: '/version/$versionId', params: { versionId: v.id }, search: { projectId, repoPath: node.repoPath } })}
                  className={rowClass(pathname === `/version/${v.id}` && sameRepo)}
                  style={{ paddingLeft: `${30 + depth * 12}px` }}
                  data-testid={`version-row-${v.id}`}
                >
                  <span className="flex-1 truncate">{v.title}</span>
                  <span className={`px-1.5 rounded text-[10px] ${STATE_BADGE[v.state]}`}>{t(`versions.state.${v.state}`)}</span>
                </button>
              ))}
            </>
          )}
          {node.children.map(c => <ComponentRow key={c.repoPath} node={c} depth={depth + 1} projectId={projectId} showAbandoned={showAbandoned} />)}
        </div>
      )}
      {creating && (
        <NewVersionDialog
          node={node}
          workspaceDir={decodeProjectId(projectId)}
          onClose={() => setCreating(false)}
          onCreated={v => {
            setCreating(false)
            void navigate({ to: '/version/$versionId', params: { versionId: v.id }, search: { projectId, repoPath: node.repoPath } })
          }}
        />
      )}
    </div>
  )
}
