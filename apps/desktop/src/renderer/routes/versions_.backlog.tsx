import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, FileDiff } from 'lucide-react'
import type { VersionBacklogItem } from '@polenta/types'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { ViewHeader } from '../components/layout/ViewHeader'
import { ElementLink } from '../components/element/ElementLink'
import { DataGrid } from '../components/grid/DataGrid'
import type { GridColumn } from '../components/grid/gridTypes'
import { useGridScrollKey } from '../components/grid/useGridScrollKey'
import { useSetTabTitle } from '../contexts/TabsContext'
import { useInvalidateVersions, useVersionBacklog, versionErrorText } from '../components/versions/useVersions'

const DEFAULTS = ['id', 'label', 'type', 'status', 'nature', 'diff']
const itemId = (i: VersionBacklogItem) => i.id

/**
 * GH201 §4 — backlog d'un composant : changements jamais inclus dans une version (jamais livrés,
 * ou modifiés depuis la dernière version released qui les incluait). URL : /versions/backlog?repoPath=…
 * GH389 §4 : grille commune (`DataGrid`) à cases, types mélangés, ID en liens d'élément.
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
  // Versions pouvant recevoir des changements, la plus récente d'abord ; aucune n'est imposée.
  const inProgress = useMemo(() => versions.filter(v => v.state === 'in_progress').reverse(), [versions])
  const [chosenTarget, setChosenTarget] = useState<string | null>(null)
  const target = inProgress.find(v => v.id === chosenTarget) ?? inProgress[0]
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  // Éléments sortis du backlog (inclus ailleurs, relus) : hors de la sélection.
  useEffect(() => {
    const ids = new Set(items.map(i => i.id))
    setSelected(prev => ([...prev].every(id => ids.has(id)) ? prev : new Set([...prev].filter(id => ids.has(id)))))
  }, [items])
  const [error, setError] = useState<string | null>(null)
  const visibleSelected = useMemo(() => items.map(i => i.id).filter(id => selected.has(id)), [items, selected])
  const scrollKey = useGridScrollKey('backlog')

  const include = async (ids: string[]) => {
    if (!target || ids.length === 0) return
    setError(null)
    try {
      await api.versions.include(repoPath, target.id, ids, workspaceDir || undefined)
      setSelected(new Set())
      await invalidate()
    } catch (err) {
      setError(versionErrorText(t, err))
    }
  }
  const openDiff = (i: VersionBacklogItem) => void navigate({
    to: '/diff',
    search: { projectId, repoPath, filepath: i.filePath, commitSha: undefined, element: '1', ...(i.base && { baseSha: i.base.sha }) },
  })
  // Gestes des cellules lus par une ref : colonnes stables (cellules mémoïsées).
  const gestures = useRef({ openDiff })
  gestures.current = { openDiff }
  const columns = useMemo<GridColumn<VersionBacklogItem>[]>(() => [
    {
      key: 'id', label: t('versions.columns.id'), locked: true, getText: i => i.id,
      render: i => <ElementLink id={i.id} className="font-mono text-prim" />, elementId: i => i.id,
    },
    { key: 'label', label: t('versions.columns.label'), getText: i => i.title },
    { key: 'type', label: t('versions.columns.type'), getText: i => t(`versions.category.${i.category}`) },
    { key: 'status', label: t('versions.status'), getText: i => i.status },
    {
      key: 'nature', label: t('versions.backlog.nature'),
      getText: i => [t(`versions.backlog.kind.${i.kind}`), i.outside ? t('versions.backlog.outside') : ''].filter(Boolean).join(' '),
      render: i => (
        <>
          <span className={i.kind === 'new' ? 'text-status-info' : 'text-status-warning'}>{t(`versions.backlog.kind.${i.kind}`)}</span>
          {i.outside && (
            <span className="ml-2 inline-flex items-center gap-1 text-status-danger" title={t('versions.backlog.outsideHint')}>
              <AlertTriangle size={11} />{t('versions.backlog.outside')}
            </span>
          )}
        </>
      ),
    },
    {
      key: 'diff', label: t('versions.columns.diff'), filterable: false, getText: () => t('versions.seeChanges'),
      render: i => (
        <button type="button" data-cell-link data-cell-dblclick-ignore onClick={e => { e.stopPropagation(); gestures.current.openDiff(i) }}
          className="inline-flex items-center gap-1 text-prim hover:underline">
          <FileDiff size={12} />{t('versions.seeChanges')}
        </button>
      ),
    },
  ], [t])
  const prefs = useMemo(() => ({ repoPath, prefKey: 'grid::backlog', view: 'columns', defaults: DEFAULTS }), [repoPath])
  const canSelect = useMemo(() => (target ? undefined : () => false), [target])

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="version-backlog-page">
      <ViewHeader
        currentProjectId={projectId}
        title={t('versions.backlog.title')}
        subtitle={t('versions.backlog.subtitle', { count: items.length })}
        actions={target ? (
          <>
            <label className="flex items-center gap-2 text-xs text-ink-2">
              {t('versions.backlog.target')}
              <select value={target.id} onChange={e => setChosenTarget(e.target.value)} className="input-field text-xs py-1" data-testid="backlog-target">
                {inProgress.map(v => <option key={v.id} value={v.id}>{v.title} ({v.id})</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void include(visibleSelected)} disabled={visibleSelected.length === 0} className="btn-secondary-sm" data-testid="backlog-include">
              {t('versions.backlog.includeSelected', { count: visibleSelected.length })}
            </button>
            <button type="button" onClick={() => void include(items.map(i => i.id))} disabled={items.length === 0} className="btn-primary-sm" data-testid="backlog-include-all">
              {t('versions.backlog.includeAll')}
            </button>
          </>
        ) : <span className="text-xs text-ink-3">{t('versions.backlog.noInProgress')}</span>}
      />
      <div className="flex-1 min-h-0 p-4 flex flex-col gap-2">
        {error && <p className="text-xs text-status-danger" role="alert">{error}</p>}
        {isLoading ? <p className="text-xs text-ink-3 italic">{t('common.loading')}</p> : items.length === 0 ? (
          <p className="text-xs text-ink-3 italic">{t('versions.backlog.empty')}</p>
        ) : (
          <div className="flex flex-col flex-1 min-h-0" data-testid="backlog-table">
            <DataGrid
              gridId="backlog"
              title={t('versions.backlog.title')}
              rows={items}
              getRowId={itemId}
              columns={columns}
              prefs={prefs}
              selection={{ mode: 'checkbox', selected, onChange: setSelected, isSelectable: canSelect }}
              scrollMemoryKey={scrollKey}
            />
          </div>
        )}
      </div>
    </div>
  )
}
