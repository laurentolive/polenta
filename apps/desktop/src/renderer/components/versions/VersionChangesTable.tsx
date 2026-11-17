import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { FileDiff, X } from 'lucide-react'
import type { VersionChangeRow } from '@polenta/types'
import { ElementLink } from '../element/ElementLink'
import { PageLink } from '../element/PageLink'
import { DataGrid } from '../grid/DataGrid'
import type { GridColumn } from '../grid/gridTypes'
import { useGridScrollKey } from '../grid/useGridScrollKey'

const DEFAULTS = ['component', 'version', 'type', 'id', 'label', 'diff', 'actions']
/** Identifiant de ligne : un même élément peut figurer dans la version et dans celle d'un composant. */
const rowKey = (r: VersionChangeRow) => `${r.versionId}:${r.id}`

/**
 * GH201 §5 — changements d'une version (les siens, puis ceux des versions des composants). GH389 §4 :
 * grille commune (`DataGrid`), types mélangés ; cases sur les lignes propres d'une version modifiable,
 * « Retirer » par ligne ou sur la sélection.
 */
export function VersionChangesTable({ rows, repoPath, projectId, title, onRemove }: {
  rows: VersionChangeRow[]
  /** Repo de la version (préférences de la grille, export). */
  repoPath: string
  projectId: string
  /** Titre de l'export. */
  title: string
  /** Version en cours, modifiable : « Retirer » sur ses propres lignes, une à une ou la sélection. */
  onRemove?: (ids: string[]) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const scrollKey = useGridScrollKey('version-changes')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const byKey = useMemo(() => new Map(rows.map(r => [rowKey(r), r])), [rows])
  // Lignes disparues (retirées, version relue) : hors de la sélection.
  const selectedIds = [...selected].map(k => byKey.get(k)).filter((r): r is VersionChangeRow => !!r?.own).map(r => r.id)

  const openDiff = (r: VersionChangeRow) => {
    if (!r.filePath) return
    void navigate({
      to: '/diff',
      search: {
        projectId, repoPath: r.repoPath, filepath: r.filePath, commitSha: undefined, element: '1',
        ...(r.base && { baseSha: r.base.sha }), ...(r.toSha && { toSha: r.toSha }),
      },
    })
  }
  const openVersion = (r: VersionChangeRow) =>
    void navigate({ to: '/version/$versionId', params: { versionId: r.versionId }, search: { projectId, repoPath: r.repoPath } })
  // Gestes des cellules lus par une ref : colonnes stables (cellules mémoïsées).
  const gestures = useRef({ openDiff, openVersion, onRemove })
  gestures.current = { openDiff, openVersion, onRemove }
  const removable = !!onRemove

  const columns = useMemo<GridColumn<VersionChangeRow>[]>(() => [
    { key: 'component', label: t('versions.columns.component'), getText: r => r.componentLabel },
    {
      key: 'version', label: t('versions.columns.version'),
      getText: r => `${r.versionTitle} (${r.versionId})`,
      render: r => (
        <PageLink id={r.versionId} repoPath={r.repoPath} className="text-prim" onFallback={() => gestures.current.openVersion(r)}>
          {r.versionTitle} <span className="text-ink-3">({r.versionId})</span>
        </PageLink>
      ),
    },
    {
      key: 'type', label: t('versions.columns.type'),
      getText: r => (r.category ? t(`versions.category.${r.category}`) : t('versions.page.deleted')),
      render: r => (r.category ? t(`versions.category.${r.category}`) : <span className="italic text-ink-3">{t('versions.page.deleted')}</span>),
    },
    {
      key: 'id', label: t('versions.columns.id'), locked: true,
      getText: r => r.id,
      render: r => (r.category ? <ElementLink id={r.id} className="font-mono text-prim" /> : <span className="font-mono text-ink-3">{r.id}</span>),
      elementId: r => (r.category ? r.id : undefined),
    },
    {
      key: 'label', label: t('versions.columns.label'),
      getText: r => [r.title, !r.base && r.category ? t('versions.backlog.kind.new') : ''].filter(Boolean).join(' '),
      render: r => <>{r.title}{!r.base && r.category && <span className="ml-2 text-[10px] text-status-info">{t('versions.backlog.kind.new')}</span>}</>,
    },
    {
      key: 'diff', label: t('versions.columns.diff'), filterable: false,
      getText: r => (r.filePath ? t('versions.seeChanges') : ''),
      render: r => r.filePath && (
        <button type="button" data-cell-link data-cell-dblclick-ignore onClick={e => { e.stopPropagation(); gestures.current.openDiff(r) }}
          className="inline-flex items-center gap-1 text-prim hover:underline" data-testid={`version-diff-${r.id}`}>
          <FileDiff size={12} />{t('versions.seeChanges')}
        </button>
      ),
    },
    ...(removable ? [{
      key: 'actions', label: t('versions.columns.actions'), filterable: false,
      getText: () => '',
      render: (r: VersionChangeRow) => r.own && (
        <button type="button" data-cell-dblclick-ignore onClick={e => { e.stopPropagation(); gestures.current.onRemove?.([r.id]) }}
          className="btn-icon text-ink-3 hover:text-status-danger" title={t('versions.page.remove')} data-testid={`version-remove-${r.id}`}>
          <X size={12} />
        </button>
      ),
    }] : []),
  ], [t, removable])

  const prefs = useMemo(() => ({ repoPath, prefKey: 'grid::version-changes', view: 'columns', defaults: DEFAULTS }), [repoPath])
  const isOwn = useCallback((r: VersionChangeRow) => r.own, [])
  const selectable = removable && rows.some(r => r.own)

  if (rows.length === 0) return <p className="text-xs text-ink-3 italic">{t('versions.page.noChanges')}</p>

  return (
    <div className="flex flex-col max-h-[60vh] min-h-0" data-testid="version-changes">
      <DataGrid
        gridId="version-changes"
        title={title}
        rows={rows}
        getRowId={rowKey}
        columns={columns}
        prefs={prefs}
        selection={selectable ? { mode: 'checkbox', selected, onChange: setSelected, isSelectable: isOwn } : undefined}
        scrollMemoryKey={scrollKey}
        toolbarStart={onRemove && selectedIds.length > 0 && (
          <>
            <span className="text-xs text-ink-2">{t('versions.page.selected', { count: selectedIds.length })}</span>
            <button type="button" onClick={() => { onRemove(selectedIds); setSelected(new Set()) }}
              className="btn-secondary-sm flex items-center gap-1 hover:text-status-danger" data-testid="version-remove-selected">
              <X size={12} />{t('versions.page.removeSelected')}
            </button>
          </>
        )}
      />
    </div>
  )
}
