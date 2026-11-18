import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Eye, FileText, Grid3x3 } from 'lucide-react'
import type { ExecutionHistory, ExecutionHistoryRow } from '@polenta/types'
import { api } from '../../api'
import { useSystemView } from '../../contexts/SystemViewContext'
import { useSetTabTitle } from '../../contexts/TabsContext'
import { decodeProjectId } from '../../lib/projectId'
import { NO_FILTER_OPTIONS } from '../../lib/textFilter'
import { EXECUTIONS_PATH, type ExecutionsSearch, type ExecutionsViewMode } from '../../lib/executionsRoute'
import { ViewHeader } from '../layout/ViewHeader'
import type { ChecklistGroup } from '../grid/ColumnChecklist'
import type { ColumnFilters } from '../grid/columnFilters'
import type { GridColumn } from '../grid/gridTypes'
import { useGridPrefs } from '../grid/useGridPrefs'
import { ExecutionHistoryGrid, useExecutionCellGestures } from './ExecutionHistoryGrid'
import { buildExecutionColumns } from './executionColumnDefs'
import { DOC_HEADER_KEYS, STEPS_KEY, defaultRunExcelColumns, defaultRunWordColumns } from './executionColumns'
import { ExecutionConfigPanel, type ExecutionConfigTab, type ExecutionConfigTabDef } from './ExecutionConfigPanel'
import { ExecutionDocument } from './ExecutionDocument'
import { ExecutionsExportButton } from './ExecutionsExportButton'

const EMPTY_HISTORY: ExecutionHistory = { rows: [], runFieldDefs: {} }
const NO_RUN_POPUP: string[] = []

/**
 * Filtre prérempli par le lien de la fiche campagne : la cellule Campagne commence par l'ID exact
 * (`<ID> — <titre>`) — une autre campagne dont le titre cite cet ID ne passe pas.
 */
export function campaignFilter(campaignId: string | undefined): ColumnFilters {
  if (!campaignId) return {}
  const escaped = campaignId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return { campaign: { text: `^${escaped} —`, options: { ...NO_FILTER_OPTIONS, caseSensitive: true, regex: true } } }
}

/** Groupes du panneau 👁, dans l'ordre des colonnes (groupe = libellé de `GridColumn.group`). */
function checklistGroups(columns: readonly GridColumn<ExecutionHistoryRow>[], keep: (key: string) => boolean, extra: { key: string; label: string }[] = []): ChecklistGroup[] {
  const groups: ChecklistGroup[] = []
  for (const c of columns) {
    if (!keep(c.key)) continue
    const label = c.group ?? ''
    let g = groups.find(x => x.label === label)
    if (!g) { g = { label, columns: [] }; groups.push(g) }
    g.columns.push({ key: c.key, label: c.label })
  }
  if (extra.length > 0) groups.push({ columns: extra })
  return groups
}

/**
 * GH400 — vue Exécutions (specs/GH400.md) : toutes les exécutions des tests du type choisi dans le
 * panneau, en Tableau ou en Document. Lecture seule, données brutes de `executions:history` (GH79).
 */
export function ExecutionsView({ search }: { search: ExecutionsSearch }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { repoPath, effectiveNode, effectiveNodeId, effectiveTypeId, effectiveType, schemaLoading } = useSystemView()
  const projectId = search.projectId ?? ''
  const workspaceDir = projectId ? decodeProjectId(projectId) : undefined
  const typeKey = effectiveNodeId && effectiveTypeId ? `${effectiveNodeId}::${effectiveTypeId}` : ''
  const mode: ExecutionsViewMode = search.view === 'word' ? 'word' : 'excel'

  const componentLabel = effectiveNode?.label || effectiveNodeId
  const typeLabel = effectiveType?.label || effectiveTypeId
  const title = typeKey ? `${t('executionsView.title')} — ${componentLabel} / ${typeLabel}` : t('executionsView.title')
  useSetTabTitle(typeKey ? `${t('executionsView.title')} — ${typeLabel}` : t('executionsView.title'))

  const target = useMemo(() => ({ objectTypeRef: typeKey }), [typeKey])
  const { data, isLoading, error } = useQuery({
    queryKey: ['execution-history', repoPath, target, workspaceDir ?? null],
    queryFn: () => api.executions.history(repoPath, target, workspaceDir),
    enabled: !!repoPath && !!typeKey,
    staleTime: 0,   // GH202 — « a évolué » suit les versions, modifiées ailleurs.
  })
  const history = data ?? EMPTY_HISTORY

  // Filtres de la vue : partagés Tableau / Document, préremplis par l'URL, remis à zéro sur un autre
  // type ou un autre repo, jamais persistés (GH389).
  const [filters, setFilters] = useState<ColumnFilters>(() => campaignFilter(search.campaign))
  const scopeKey = `${repoPath}\n${typeKey}\n${search.campaign ?? ''}`
  const lastScope = useRef(scopeKey)
  useEffect(() => {
    if (lastScope.current === scopeKey) return
    lastScope.current = scopeKey
    setFilters(campaignFilter(search.campaign))
  }, [scopeKey, search.campaign])
  const columnFilters = useMemo(() => ({ value: filters, onChange: setFilters }), [filters])
  const forceVisible = useMemo(() => (search.campaign ? ['campaign'] : undefined), [search.campaign])

  // Colonnes (libellés du panneau, Document) et préférences des trois onglets.
  const gestures = useExecutionCellGestures(repoPath, projectId)
  const columns = useMemo(
    () => buildExecutionColumns({ history, withTestColumn: true, t, language: i18n.language, repoPath, gestures }),
    [history, t, i18n.language, repoPath, gestures],
  )
  const excelDefaults = useMemo(() => defaultRunExcelColumns(history), [history])
  const wordDefaults = useMemo(() => defaultRunWordColumns(history), [history])
  const excelPrefs = useGridPrefs({ repoPath, prefKey: typeKey, view: 'runExcel', defaults: excelDefaults })
  const wordPrefs = useGridPrefs({ repoPath, prefKey: typeKey, view: 'runWord', defaults: wordDefaults })
  const popupPrefs = useGridPrefs({ repoPath, prefKey: typeKey, view: 'runPopup', defaults: NO_RUN_POPUP })

  const [configOpen, setConfigOpen] = useState(false)
  const configTabs = useMemo((): ExecutionConfigTabDef[] => [
    { tab: 'excel', prefKey: 'runExcel', prefs: excelPrefs, groups: checklistGroups(columns, () => true) },
    {
      tab: 'word', prefKey: 'runWord', prefs: wordPrefs,
      groups: checklistGroups(columns, k => !DOC_HEADER_KEYS.includes(k) && k !== 'notes', [{ key: STEPS_KEY, label: t('executionsView.steps') }]),
    },
    { tab: 'popup', prefKey: 'runPopup', prefs: popupPrefs, groups: checklistGroups(columns, k => k !== 'notes') },
  ], [columns, excelPrefs, wordPrefs, popupPrefs, t])

  const switchMode = (next: ExecutionsViewMode) => {
    if (next === mode) return
    void navigate({ to: EXECUTIONS_PATH, search: { ...search, view: next === 'word' ? 'word' : undefined } } as never)
  }

  let body: ReactNode
  if (schemaLoading) body = <p className="p-4 text-xs text-ink-3">{t('common.loading')}</p>
  else if (!repoPath) body = <p className="p-4 text-xs text-ink-3">{t('common.loading')}</p>
  else if (!typeKey) body = <p className="p-4 text-xs text-ink-3 italic" data-testid="executions-no-type">{t('executionsView.noTestType')}</p>
  else if (isLoading) body = <p className="p-4 text-xs text-ink-3">{t('common.loading')}</p>
  else if (error) body = <p className="p-4 text-xs text-status-danger">{error instanceof Error ? error.message : String(error)}</p>
  else if (mode === 'word') {
    body = (
      <ExecutionDocument history={history} columns={columns} repoPath={repoPath}
        fields={wordPrefs.columns} filters={filters} filterKeys={[...excelPrefs.columns, ...(forceVisible ?? [])]} />
    )
  } else {
    body = (
      <div className="flex-1 min-h-0 flex flex-col p-4">
        <ExecutionHistoryGrid repoPath={repoPath} projectId={projectId} history={history} typeKey={typeKey}
          withTestColumn title={title} prefView="runExcel" defaults={excelDefaults}
          columnFilters={columnFilters} forceVisible={forceVisible} noColumnPicker fill />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="executions-view">
      <ViewHeader
        title={title}
        currentProjectId={projectId}
        actions={typeKey ? (
          <>
            {mode === 'word' && data && (
              <ExecutionsExportButton repoPath={repoPath} title={title} history={history} columns={columns}
                fields={wordPrefs.columns} filters={filters} filterKeys={[...excelPrefs.columns, ...(forceVisible ?? [])]}
                printParams={{ repoPath, username: excelPrefs.username, objectTypeRef: typeKey, workspaceDir: workspaceDir ?? '', title }} />
            )}
            <button type="button" onClick={() => setConfigOpen(v => !v)} title={t('system.fieldConfig.configureColumns')}
              disabled={!data} data-testid="executions-config"
              className="text-ink-3 hover:text-ink p-1 rounded hover:bg-hover disabled:opacity-40">
              <Eye size={14} />
            </button>
            <div className="flex border border-edge rounded overflow-hidden">
              {([
                { m: 'excel' as const, icon: <Grid3x3 size={13} />, label: t('system.systemView.tableView') },
                { m: 'word' as const, icon: <FileText size={13} />, label: t('system.systemView.documentView') },
              ]).map(({ m, icon, label }) => (
                <button key={m} type="button" onClick={() => switchMode(m)} title={label} data-testid={`executions-mode-${m}`}
                  className={`flex items-center justify-center w-7 h-6 transition-colors ${mode === m ? 'bg-ink text-prim-fg' : 'text-ink-3 hover:text-ink hover:bg-hover'}`}>
                  {icon}
                </button>
              ))}
            </div>
          </>
        ) : undefined}
      />
      {body}
      {configOpen && data && (
        <ExecutionConfigPanel tabs={configTabs} initialTab={(mode === 'word' ? 'word' : 'excel') as ExecutionConfigTab} onClose={() => setConfigOpen(false)} />
      )}
    </div>
  )
}
