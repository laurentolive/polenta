import { useMemo, useRef, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ExecutionHistoryRow } from '@polenta/types'
import { api } from '../../api'
import { runQueryKey, useElementNav, type ElementRef } from '../../contexts/ElementNavContext'
import { CATEGORY_CHART_BG } from '../../lib/objectCategoryColors'
import type { GridColumn } from '../grid/gridTypes'
import { useGridPrefs } from '../grid/useGridPrefs'
import { buildExecutionColumns, type ExecutionGestures } from './executionColumnDefs'

/** Ni notes ni étapes dans la popup (spec §2, Q4). */
const EXCLUDED = new Set(['notes', 'steps'])
const NO_FIELDS: string[] = []
const INERT: ExecutionGestures = { openVersion: () => {}, openPending: () => {} }

/**
 * GH399 — corps de la popup d'aperçu d'une exécution (specs/GH399.md §2) : en-tête fixe (ID, test,
 * verdict, date, testeur, campagne, entrée), puis les colonnes cochées dans l'onglet Popup de la vue
 * Exécutions pour le type du test (`runPopup`). Lecture seule ; liens sans popup imbriquée.
 */
export function RunPreviewBody({ target }: { target: ElementRef }) {
  const { t, i18n } = useTranslation()
  const nav = useElementNav()!
  const { repoPath, id } = target
  const workspaceDir = nav.workspace.workspaceDir
  const { data: history, isPending, isError } = useQuery({
    queryKey: runQueryKey(repoPath, id, workspaceDir),
    queryFn: () => api.executions.history(repoPath, { runId: id, testId: target.testId }, workspaceDir),
    staleTime: 5_000,
  })
  const row = history?.rows[0]
  // Réglage écrit par l'onglet Popup de la vue Exécutions (même lecture que ses grilles).
  const fields = useGridPrefs({ repoPath, prefKey: target.objectTypeRef, view: 'runPopup', defaults: NO_FIELDS }).columns
  const gestures = useRef(INERT)
  const columns = useMemo(
    () => (history ? buildExecutionColumns({ history, withTestColumn: true, t, language: i18n.language, repoPath, gestures }) : []),
    [history, t, i18n.language, repoPath],
  )
  const byKey = useMemo(() => new Map(columns.map(c => [c.key, c])), [columns])
  const cell = (key: string): ReactNode => {
    const col = byKey.get(key)
    return col && row ? (col.render ? col.render(row) : col.getText(row)) : null
  }
  const otherRepo = !!target.repoLabel && target.repoPath !== nav.workspace.rootRepoPath

  return (
    <div className="p-3 space-y-2" data-testid="run-preview">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={`inline-block w-2 h-2 rounded-full ${CATEGORY_CHART_BG.test}`} />
        <span className="font-mono font-semibold" data-testid="element-preview-id">{id}</span>
        <span className="text-ink-3">{t('executionsView.runLabel')}</span>
        {otherRepo && <span className="text-[10px] text-ink-3 border border-edge rounded px-1">{target.repoLabel}</span>}
      </div>
      <p className="text-sm font-medium leading-snug" data-testid="element-preview-title">{row ? cell('test') : `${target.testId ?? ''} — ${target.title}`}</p>
      {isPending && <div className="space-y-1" aria-busy="true"><div className="h-2 bg-hover rounded w-3/4" /><div className="h-2 bg-hover rounded w-1/2" /></div>}
      {(isError || (history && !row)) && <p className="text-xs text-status-danger">{t('system.preview.notFound')}</p>}
      {row && (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2" data-testid="run-preview-header">
            {cell('verdict')}
            <span>{cell('date')}</span>
            {row.run?.executedBy && <span>{cell('tester')}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="run-preview-campaign">
            {cell('campaign')}
            {row.entry && <span>{cell('entry')}</span>}
          </div>
          {fields.filter(k => !EXCLUDED.has(k)).map(key => <RunField key={key} col={byKey.get(key)} row={row} />)}
        </>
      )}
    </div>
  )
}

function RunField({ col, row }: { col: GridColumn<ExecutionHistoryRow> | undefined; row: ExecutionHistoryRow }) {
  if (!col || !col.getText(row).trim()) return null
  return (
    <div className="min-w-0" data-testid={`run-preview-field-${col.key}`}>
      <p className="text-[10px] uppercase tracking-wide text-ink-3 leading-tight">{col.label}</p>
      <div className="text-xs text-ink break-words whitespace-pre-wrap">{col.render ? col.render(row) : col.getText(row)}</div>
    </div>
  )
}
