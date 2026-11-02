import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, FileDiff } from 'lucide-react'
import type { VersionBacklogItem } from '@polenta/types'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ViewHeader } from '../components/layout/ViewHeader'
import { useSetTabTitle } from '../contexts/TabsContext'
import { useInvalidateVersions, useVersionBacklog, versionErrorText } from '../components/versions/useVersions'

/**
 * GH201 §4 — backlog d'un composant : changements jamais inclus dans une version (jamais livrés,
 * ou modifiés depuis la dernière version released qui les incluait). URL : /versions/backlog?repoPath=…
 */
export const Route = createFileRoute('/versions_/backlog')({
  component: BacklogPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    repoPath: (s['repoPath'] as string) ?? '',
  }),
})

function BacklogPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId, repoPath } = Route.useSearch()
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  useSetTabTitle(t('versions.backlog.title'))
  const { data: items = [], isLoading } = useVersionBacklog(repoPath)
  const { data: versions = [] } = useQuery({
    queryKey: ['versions', 'list', repoPath],
    queryFn: () => api.versions.list(repoPath),
    enabled: !!repoPath,
  })
  const invalidate = useInvalidateVersions()
  const inProgress = versions.find(v => v.state === 'in_progress')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const visibleSelected = useMemo(() => items.filter(i => selected.has(i.id)).map(i => i.id), [items, selected])

  const include = async (ids: string[]) => {
    if (!inProgress || ids.length === 0) return
    setError(null)
    try {
      await api.versions.include(repoPath, inProgress.id, ids, workspaceDir || undefined)
      setSelected(new Set())
      await invalidate()
    } catch (err) {
      setError(versionErrorText(t, err))
    }
  }
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const openDiff = (i: VersionBacklogItem) => void navigate({
    to: '/diff',
    search: { projectId, repoPath, filepath: i.filePath, commitSha: undefined, element: '1', ...(i.base && { baseSha: i.base.sha }) },
  })
  const openElement = (i: VersionBacklogItem) => i.category === 'requirement'
    ? void navigate({ to: '/req/$reqId', params: { reqId: i.id }, search: { repoPath, projectId, component: undefined, level: undefined } })
    : void navigate({ to: '/test/$testId', params: { testId: i.id }, search: { repoPath, projectId, component: undefined, level: undefined } })

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="version-backlog-page">
      <ViewHeader
        currentProjectId={projectId}
        title={t('versions.backlog.title')}
        subtitle={t('versions.backlog.subtitle', { count: items.length })}
        actions={inProgress ? (
          <>
            <button type="button" onClick={() => void include(visibleSelected)} disabled={visibleSelected.length === 0} className="btn-secondary-sm" data-testid="backlog-include">
              {t('versions.backlog.include', { version: `${inProgress.title} (${inProgress.id})`, count: visibleSelected.length })}
            </button>
            <button type="button" onClick={() => void include(items.map(i => i.id))} disabled={items.length === 0} className="btn-primary-sm" data-testid="backlog-include-all">
              {t('versions.backlog.includeAll')}
            </button>
          </>
        ) : <span className="text-xs text-ink-3">{t('versions.backlog.noInProgress')}</span>}
      />
      <div className="flex-1 overflow-y-auto p-4">
        {error && <p className="text-xs text-status-danger mb-2" role="alert">{error}</p>}
        {isLoading ? <p className="text-xs text-ink-3 italic">{t('common.loading')}</p> : items.length === 0 ? (
          <p className="text-xs text-ink-3 italic">{t('versions.backlog.empty')}</p>
        ) : (
          <table className="w-full text-xs border-collapse" data-testid="backlog-table">
            <thead>
              <tr className="text-left text-ink-3 border-b border-edge">
                <th className="py-1 pr-2 w-6">
                  <input
                    type="checkbox"
                    checked={visibleSelected.length === items.length}
                    onChange={e => setSelected(e.target.checked ? new Set(items.map(i => i.id)) : new Set())}
                    disabled={!inProgress}
                  />
                </th>
                <th className="py-1 pr-3 font-medium">{t('versions.columns.id')}</th>
                <th className="py-1 pr-3 font-medium">{t('versions.columns.label')}</th>
                <th className="py-1 pr-3 font-medium">{t('versions.columns.type')}</th>
                <th className="py-1 pr-3 font-medium">{t('versions.status')}</th>
                <th className="py-1 pr-3 font-medium">{t('versions.backlog.nature')}</th>
                <th className="py-1 font-medium">{t('versions.columns.diff')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} className="border-b border-edge-subtle" data-testid={`backlog-row-${i.id}`}>
                  <td className="py-1 pr-2"><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} disabled={!inProgress} /></td>
                  <td className="py-1 pr-3"><button type="button" onClick={() => openElement(i)} className="text-prim hover:underline font-mono">{i.id}</button></td>
                  <td className="py-1 pr-3 text-ink">{i.title}</td>
                  <td className="py-1 pr-3 text-ink-2">{t(`versions.category.${i.category}`)}</td>
                  <td className="py-1 pr-3 text-ink-2">{i.status}</td>
                  <td className="py-1 pr-3">
                    <span className={i.kind === 'new' ? 'text-status-info' : 'text-status-warning'}>{t(`versions.backlog.kind.${i.kind}`)}</span>
                    {i.outside && (
                      <span className="ml-2 inline-flex items-center gap-1 text-status-danger" title={t('versions.backlog.outsideHint')}>
                        <AlertTriangle size={11} />{t('versions.backlog.outside')}
                      </span>
                    )}
                  </td>
                  <td className="py-1">
                    <button type="button" onClick={() => openDiff(i)} className="inline-flex items-center gap-1 text-prim hover:underline">
                      <FileDiff size={12} />{t('versions.seeChanges')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
