import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { VersionChangeRow } from '@polenta/types'
import { DataGrid } from '../grid/DataGrid'
import { useGridScrollKey } from '../grid/useGridScrollKey'
import { VERSION_CHANGE_DEFAULTS, buildVersionChangeColumns, versionChangeRowKey as rowKey } from './versionChangeColumns'

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
  // Lignes disparues (retirées, version relue) : hors de la sélection — une ligne rajoutée plus tard
  // ne revient pas cochée.
  useEffect(() => {
    setSelected(prev => ([...prev].every(k => byKey.has(k)) ? prev : new Set([...prev].filter(k => byKey.has(k)))))
  }, [byKey])
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

  const columns = useMemo(() => buildVersionChangeColumns({ t, gestures, removable }), [t, removable])

  const prefs = useMemo(() => ({ repoPath, prefKey: 'grid::version-changes', view: 'columns', defaults: VERSION_CHANGE_DEFAULTS }), [repoPath])
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
        noExport
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
