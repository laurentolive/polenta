import { useCallback, useMemo, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { isOpenCampaignStatus, type ExecutionHistory, type ExecutionHistoryRow, type SchemaField } from '@polenta/types'
import { RichTextViewer } from '../RichTextViewer'
import { RunFieldValue } from '../runs/RunFieldValues'
import { DataGrid } from '../grid/DataGrid'
import type { ControlledColumnFilters } from '../grid/useColumnFilters'
import { useGridScrollKey } from '../grid/useGridScrollKey'
import { defaultExecutionColumns, unionRunFields } from './executionColumns'
import { buildExecutionColumns, canOpenRow, STEP_KEY, VERDICT_CLASS, type ExecutionGestures } from './executionColumnDefs'

export { VERDICT_CLASS, VERDICT_KEY } from './executionColumnDefs'

// GH197 — grille d'historique des exécutions (specs/GH197.md §1–§3) : une ligne par run (ou entrée en
// attente), colonnes au choix (préférence `executions` du type), étapes dépliables. GH389 §4 : sur la
// grille commune (`DataGrid`), sans tri (D4) ; test, campagne, exigence et version testée en liens.
// GH400 — même grille pour le Tableau de la vue Exécutions (préférence `runExcel`, filtres de la vue).

const getRowKey = (row: ExecutionHistoryRow) => row.key
const hasSteps = (row: ExecutionHistoryRow) => (row.run?.stepResults ?? []).length > 0
const rowClass = (row: ExecutionHistoryRow) => (row.removed ? 'opacity-70' : undefined)

/** Étapes d'un run : n°, verdict, commentaire, champs d'étape (dépli de la grille, fiche du Document). */
export function ExecutionSteps({ row, stepFields, repoPath }: { row: ExecutionHistoryRow; stepFields: SchemaField[]; repoPath: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1">
      {(row.run?.stepResults ?? []).map(sr => (
        <div key={sr.order} className="flex items-start gap-3" data-testid="execution-step-row">
          <span className="font-mono text-ink-3 shrink-0">#{sr.order}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${VERDICT_CLASS[sr.result]}`}>{t(STEP_KEY[sr.result])}</span>
          {sr.comment && <div className="min-w-0 flex-1"><RichTextViewer value={sr.comment} repoPath={repoPath} /></div>}
          {sr.fields && stepFields.filter(f => sr.fields![f.name] !== undefined).map(f => (
            <span key={f.name} className="shrink-0"><span className="text-ink-3">{f.label ?? f.name} : </span>
              <RunFieldValue def={f} value={sr.fields![f.name]} repoPath={repoPath} /></span>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Ouverture d'une ligne (Q5 de GH197) : page d'exécution si la campagne est ouverte, relecture sinon. */
export function useExecutionGestures(repoPath: string, projectId?: string) {
  const navigate = useNavigate()
  const open = (row: ExecutionHistoryRow) => {
    if (!canOpenRow(row)) return
    const execute = isOpenCampaignStatus(row.campaign!.status)
    void navigate({
      to: execute ? '/campaign/$campaignId/execute/$testId' : '/campaign/$campaignId/run/$testId',
      params: { campaignId: row.campaign!.id, testId: row.entry!.entryId },
      search: { repoPath, projectId: projectId ?? '' },
    } as never)
  }
  const openVersion = (versionId: string, versionRepo: string) =>
    void navigate({ to: '/version/$versionId', params: { versionId }, search: { projectId: projectId ?? '', repoPath: versionRepo } } as never)
  // Gestes lus par une ref : colonnes stables (cellules mémoïsées).
  const gestures = useRef<ExecutionGestures>({ open, openVersion })
  gestures.current = { open, openVersion }
  return gestures
}

interface Props {
  repoPath: string
  projectId?: string
  history: ExecutionHistory
  /** Clé de préférence (`<nœud>::<type>` du test, de l'exigence ou du type de test affiché). */
  typeKey: string
  /** Colonne Test proposée (lignes de plusieurs tests). */
  withTestColumn: boolean
  /** Titre de l'export (feuille et fichier). */
  title: string
  /** GH400 — vue de la préférence (`executions` par défaut ; `runExcel` dans la vue Exécutions). */
  prefView?: string
  /** GH400 — colonnes par défaut de cette vue. */
  defaults?: string[]
  /** GH400 — filtres tenus par la vue. */
  columnFilters?: ControlledColumnFilters
  /** GH400 — colonnes affichées sans être écrites dans la préférence. */
  forceVisible?: readonly string[]
  /** GH400 — panneau 👁 propre à l'écran. */
  noColumnPicker?: boolean
  /** Grille à la hauteur de son conteneur (vue pleine page) plutôt que 70 % de la fenêtre. */
  fill?: boolean
}

export function ExecutionHistoryGrid({ repoPath, projectId, history, typeKey, withTestColumn, title, prefView = 'executions', defaults: viewDefaults, columnFilters, forceVisible, noColumnPicker, fill }: Props) {
  const { t, i18n } = useTranslation()
  const scrollKey = useGridScrollKey(prefView === 'executions' ? 'executions' : `executions-${prefView}`)
  const gestures = useExecutionGestures(repoPath, projectId)

  const columns = useMemo(
    () => buildExecutionColumns({ history, withTestColumn, t, language: i18n.language, repoPath, gestures }),
    [history, withTestColumn, t, i18n.language, repoPath, gestures],
  )
  const defaults = useMemo(() => viewDefaults ?? defaultExecutionColumns(history, withTestColumn), [viewDefaults, history, withTestColumn])
  const prefs = useMemo(() => ({ repoPath, prefKey: typeKey, view: prefView, defaults }), [repoPath, typeKey, prefView, defaults])
  const stepFields = useMemo(() => unionRunFields(history.runFieldDefs, 'stepFields'), [history.runFieldDefs])
  const renderSteps = useCallback(
    (row: ExecutionHistoryRow) => <ExecutionSteps row={row} stepFields={stepFields} repoPath={repoPath} />,
    [stepFields, repoPath],
  )

  if (history.rows.length === 0) return <p className="text-xs text-ink-3 italic">{t('executionHistory.empty')}</p>

  return (
    <div className={`flex flex-col min-h-0 ${fill ? 'flex-1' : 'max-h-[70vh]'}`} data-testid="execution-history">
      <DataGrid
        gridId="execution"
        title={title}
        rows={history.rows}
        getRowId={getRowKey}
        columns={columns}
        prefs={prefs}
        renderExpanded={renderSteps}
        canExpand={hasSteps}
        expandLabel={t('executionHistory.toggleSteps')}
        rowClassName={rowClass}
        scrollMemoryKey={scrollKey}
        columnFilters={columnFilters}
        forceVisible={forceVisible}
        noColumnPicker={noColumnPicker}
      />
    </div>
  )
}
