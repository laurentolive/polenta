import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { ViewHeader } from '../components/layout/ViewHeader'
import { AssignToChangeDialog } from '../components/changes/AssignToChangeDialog'
import { useBacklog } from '../hooks/useBacklog'
import { useProjectSchema, getReqTypeDef, getTestTypeDef } from '../hooks/useProjectSchema'
import { useSetTabTitle } from '../contexts/TabsContext'

/**
 * GH199 §8bis — backlog d'un composant : éléments à traiter (ni approuvés ni terminaux) assignés à
 * aucun change ouvert ; « Assigner à… » un change. URL : /changes/backlog?projectId&repoPath&component
 */
export const Route = createFileRoute('/changes_/backlog')({
  component: BacklogPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    repoPath: (s['repoPath'] as string) ?? '',
    component: (s['component'] as string) ?? '',
  }),
})

function BacklogPage() {
  const { t } = useTranslation()
  const { projectId, repoPath, component } = Route.useSearch()
  const backlogQuery = useBacklog(projectId)
  const backlog = backlogQuery.data?.find(b => b.repoPath === repoPath && b.component === component)
  const multiple = (backlogQuery.data ?? []).filter(b => b.items.length > 0).length > 1
  const title = multiple && backlog ? `${t('changes.backlog.title')} — ${backlog.label}` : t('changes.backlog.title')
  useSetTabTitle(title)
  const { data: schema } = useProjectSchema(repoPath)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)

  const items = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (backlog?.items ?? []).filter(i => !q || i.id.toLowerCase().includes(q) || i.title.toLowerCase().includes(q))
  }, [backlog, filter])
  const statusLabel = (category: 'requirement' | 'test', ref: string, status: string) =>
    (category === 'requirement' ? getReqTypeDef(schema, ref) : getTestTypeDef(schema, ref))?.statuses?.find(s => s.name === status)?.label || status
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const chosen = items.filter(i => selected.has(i.id)).map(i => i.id)
  const allChosen = items.length > 0 && chosen.length === items.length

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="backlog-page">
      <ViewHeader
        currentProjectId={projectId}
        title={title}
        subtitle={backlog ? t('changes.backlog.subtitle', { count: backlog.items.length }) : undefined}
        actions={
          <button type="button" className="btn-primary-sm" disabled={chosen.length === 0} onClick={() => setAssigning(true)} data-testid="backlog-assign">
            {t('changes.backlog.assign', { count: chosen.length })}
          </button>
        }
      />
      <div className="px-4 py-2 border-b border-edge flex items-center gap-3">
        <input className="input-field text-xs w-64" value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('changes.backlog.filter')} />
        <p className="text-xs text-ink-3">{t('changes.backlog.help')}</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {backlogQuery.isError ? (
          <p className="text-sm text-status-danger px-4 py-3">{backlogQuery.error instanceof Error ? backlogQuery.error.message : String(backlogQuery.error)}</p>
        ) : !backlogQuery.data ? (
          <p className="text-sm text-ink-3 italic px-4 py-3">{t('common.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-ink-3 italic px-4 py-3">{t('changes.backlog.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-3 text-left border-b border-edge">
              <tr>
                <th className="px-4 py-1.5 w-8">
                  <input type="checkbox" checked={allChosen} aria-label={t('changes.backlog.selectAll')}
                    onChange={() => setSelected(allChosen ? new Set() : new Set(items.map(i => i.id)))} />
                </th>
                <th className="py-1.5 pr-3">ID</th>
                <th className="py-1.5 pr-3">{t('changes.backlog.titleCol')}</th>
                <th className="py-1.5 pr-3">{t('changes.backlog.statusCol')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} className="border-b border-edge-subtle hover:bg-hover" data-testid={`backlog-row-${i.id}`}>
                  <td className="px-4 py-1">
                    <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={t('changes.backlog.select', { id: i.id })} />
                  </td>
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {i.category === 'requirement'
                      ? <Link to="/req/$reqId" params={{ reqId: i.id }} search={{ repoPath, projectId, component: undefined, level: undefined }} className="font-mono text-prim hover:underline">{i.id}</Link>
                      : <Link to="/test/$testId" params={{ testId: i.id }} search={{ repoPath, projectId, component: undefined, level: undefined }} className="font-mono text-prim hover:underline">{i.id}</Link>}
                    {i.needsRevalidation && <AlertTriangle size={12} className="inline ml-1 text-status-warning" aria-label={t('changes.backlog.flagged')} />}
                  </td>
                  <td className="py-1 pr-3 text-ink">{i.title}</td>
                  <td className="py-1 pr-3 text-ink-3 whitespace-nowrap">{statusLabel(i.category, i.objectTypeRef, i.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {assigning && (
        <AssignToChangeDialog
          mode="assign"
          repoPath={repoPath}
          elementIds={chosen}
          component={component || null}
          onDone={() => { setAssigning(false); setSelected(new Set()) }}
          onCancel={() => setAssigning(false)}
        />
      )}
    </div>
  )
}
