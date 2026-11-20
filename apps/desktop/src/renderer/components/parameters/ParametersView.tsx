import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Lock, Plus, Search } from 'lucide-react'
import type { Parameter, RepoParameters } from '@polenta/types'
import { api } from '../../api'
import { DataGrid } from '../grid/DataGrid'
import type { GridColumn } from '../grid/gridTypes'
import { useGridScrollKey } from '../grid/useGridScrollKey'
import { ParameterEditDialog } from './ParameterEditDialog'

interface Props {
  /** Repo ouvert (repo produit / racine du workspace). */
  repoPath: string
  workspaceDir: string
  projectId: string
  /** Filtre sur un repo (sélection dans le panneau latéral) ; absent = tous. */
  repoFilter?: string
}

type DialogState = { repo: RepoParameters; parameter?: Parameter } | null

const DEFAULTS = ['name', 'value', 'unit', 'description', 'uses']
const paramName = (p: Parameter) => p.name

/** T171 — vue Paramètres : bases de paramètres regroupées par repo, recherche, édition. */
export function ParametersView({ repoPath, workspaceDir, projectId, repoFilter }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<DialogState>(null)

  const { data: repos = [], isLoading } = useQuery({
    queryKey: ['parameters', workspaceDir, repoPath],
    queryFn: () => api.parameters.list(repoPath, workspaceDir || undefined),
    enabled: !!repoPath,
  })

  const needle = search.trim().toLowerCase()
  const shown = useMemo(() => repos.filter(r => !repoFilter || r.repoPath === repoFilter), [repos, repoFilter])
  // Recherche globale de l'écran : filtre de chaque grille, combiné en ET aux filtres de colonne.
  const rowFilter = useMemo(() => (needle
    ? (p: Parameter) => [p.name, p.value, p.description ?? ''].some(s => s.toLowerCase().includes(needle))
    : undefined), [needle])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-6">
        <div className="flex items-center gap-2 mb-5">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              className="input-field w-full pl-7 text-xs"
              placeholder={t('parameters.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {isLoading && <p className="text-sm text-ink-3">{t('common.loading')}</p>}

        {shown.map(repo => (
          <section key={repo.repoPath} className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-semibold text-ink">{repo.label ?? repo.repoName}</h2>
              {repo.label && <span className="text-xs text-ink-3 font-mono">{repo.repoName}</span>}
              {repo.readonly && (
                <span className="flex items-center gap-1 text-xs text-ink-3"><Lock size={12} />{t('parameters.readOnly')}</span>
              )}
              <div className="flex-1" />
              {!repo.readonly && (
                <button type="button" className="btn-secondary flex items-center gap-1 text-xs" onClick={() => setDialog({ repo })}>
                  <Plus size={12} />{t('parameters.new')}
                </button>
              )}
            </div>
            {repo.parameters.length === 0 ? (
              <p className="text-xs text-ink-3 italic">{t('parameters.empty')}</p>
            ) : (
              <RepoParametersGrid repo={repo} rowFilter={rowFilter} onOpen={parameter => setDialog({ repo, parameter })} />
            )}
          </section>
        ))}
      </div>

      {dialog && (
        <ParameterEditDialog
          repoPath={dialog.repo.repoPath}
          workspaceDir={workspaceDir}
          projectId={projectId}
          parameter={dialog.parameter}
          readOnly={dialog.repo.readonly}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

/**
 * GH389 §4 — base de paramètres d'un repo sur la grille commune (`DataGrid`) : préférences dans le
 * `.pref` de ce repo (`grid::parameters`). Entrée / double-clic ouvre le dialogue d'édition (pas
 * d'édition dans la cellule).
 */
function RepoParametersGrid({ repo, rowFilter, onOpen }: {
  repo: RepoParameters
  rowFilter?: (p: Parameter) => boolean
  onOpen: (parameter: Parameter) => void
}) {
  const { t } = useTranslation()
  const gridId = `parameters-${repo.repoName}`
  const scrollKey = useGridScrollKey(gridId)
  const openRef = useRef(onOpen)
  openRef.current = onOpen
  const onActivate = useCallback((p: Parameter) => openRef.current(p), [])
  const usage = repo.usageCounts

  const columns = useMemo<GridColumn<Parameter>[]>(() => [
    {
      key: 'name', label: t('parameters.fields.name'), locked: true,
      getText: p => p.name,
      render: p => <span className="font-mono">{p.name}</span>,
    },
    {
      key: 'value', label: t('parameters.fields.value'),
      getText: p => p.value || t('parameters.emptyValue'),
      render: p => p.value || <span className="text-status-warning italic">{t('parameters.emptyValue')}</span>,
    },
    { key: 'unit', label: t('parameters.fields.unit'), getText: p => p.unit ?? '' },
    { key: 'description', label: t('parameters.fields.description'), getText: p => p.description ?? '' },
    { key: 'uses', label: t('parameters.uses'), getText: p => String(usage[p.name] ?? 0) },
  ], [t, usage])
  const prefs = useMemo(() => ({ repoPath: repo.repoPath, prefKey: 'grid::parameters', view: 'columns', defaults: DEFAULTS }), [repo.repoPath])

  return (
    <div className="flex flex-col max-h-[60vh] min-h-0" data-testid={`parameters-grid-${repo.repoName}`}>
      <DataGrid
        gridId={gridId}
        title={`${t('parameters.title')} ${repo.label ?? repo.repoName}`}
        rows={repo.parameters}
        getRowId={paramName}
        columns={columns}
        prefs={prefs}
        rowFilter={rowFilter}
        onActivate={onActivate}
        scrollMemoryKey={scrollKey}
      />
    </div>
  )
}
