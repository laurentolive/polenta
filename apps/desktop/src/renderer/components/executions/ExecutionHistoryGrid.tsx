import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fieldValueToText, isOpenCampaignStatus, type ExecutionHistory, type ExecutionHistoryRow, type StepResultValue } from '@polenta/types'
import type { FieldVisibilityPref } from '@polenta/api-client'
import { api } from '../../api'
import { RichTextViewer } from '../RichTextViewer'
import { RunFieldValue } from '../runs/RunFieldValues'
import {
  availableColumns, defaultExecutionColumns, isSortable, sortValue, unionRunFields, type ExecutionColumn, type ExecutionColumnGroup,
} from './executionColumns'

// GH197 — grille d'historique des exécutions (specs/GH197.md §1–§3) : une ligne par run (ou entrée en
// attente), colonnes au choix (préférence `executions` du type), tri par en-tête, étapes dépliables.
// Réutilisée par la vue Conformité (L6).

const VERDICT_KEY: Record<string, string> = {
  pending: 'campaignPage.runStatus.pending', PASS: 'campaignPage.runStatus.pass', FAIL: 'campaignPage.runStatus.fail',
  BLOCKED: 'campaignPage.runStatus.blocked', INCOMPLETE: 'campaignPage.runStatus.incomplete',
}
const STEP_KEY: Record<StepResultValue, string> = {
  PASS: 'campaignPage.runStatus.pass', FAIL: 'campaignPage.runStatus.fail', BLOCKED: 'campaignPage.runStatus.blocked',
  SKIP: 'campaignPage.stepResult.skip', NOT_EXECUTED: 'campaignPage.stepResult.notExecuted',
}
const VERDICT_CLASS: Record<string, string> = {
  pending: 'bg-status-neutral-bg text-status-neutral', PASS: 'bg-status-success-bg text-status-success',
  FAIL: 'bg-status-danger-bg text-status-danger', BLOCKED: 'bg-status-warning-bg text-status-warning',
  INCOMPLETE: 'bg-status-warning-bg text-status-warning', SKIP: 'bg-status-warning-bg text-status-warning',
  NOT_EXECUTED: 'bg-status-neutral-bg text-status-neutral',
}
const GROUPS: ExecutionColumnGroup[] = ['execution', 'campaign', 'entry', 'test']

interface Props {
  repoPath: string
  projectId?: string
  history: ExecutionHistory
  /** Clé de préférence (`<nœud>::<type>` du test ou de l'exigence). */
  typeKey: string
  /** Grille d'une exigence : colonne Test proposée (lignes de plusieurs tests). */
  withTestColumn: boolean
}

export function ExecutionHistoryGrid({ repoPath, projectId, history, typeKey, withTestColumn }: Props) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: username } = useQuery({
    queryKey: ['project-username', repoPath],
    queryFn: () => api.auth.projectUsername(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  const prefsKey = ['pref-visibility', repoPath, username ?? 'local', typeKey]
  const { data: prefs } = useQuery({
    queryKey: prefsKey,
    queryFn: () => api.pref.getFieldVisibility(repoPath, username ?? 'local', typeKey),
    enabled: !!repoPath && username !== undefined,
  })
  const columns = useMemo(() => availableColumns(history, withTestColumn), [history, withTestColumn])
  const visibleKeys = prefs?.executions ?? defaultExecutionColumns(history, withTestColumn)
  const visible = visibleKeys.map(k => columns.find(c => c.key === k)).filter((c): c is ExecutionColumn => !!c)
  const stepFields = unionRunFields(history.runFieldDefs, 'stepFields')

  // Mise à jour immédiate du cache (la case suit le clic), puis écriture du `.pref`.
  const savePrefs = async (executions: string[] | null) => {
    qc.setQueryData<FieldVisibilityPref | null>(prefsKey, prev => {
      const next = { ...(prev ?? {}) } as FieldVisibilityPref
      if (executions === null) delete next.executions
      else next.executions = executions
      return next
    })
    await api.pref.setFieldVisibility(repoPath, username ?? 'local', typeKey, { executions })
  }

  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const rows = useMemo(() => {
    if (!sort) return history.rows
    return [...history.rows].sort((a, b) => {
      const va = sortValue(a, sort.key)
      const vb = sortValue(b, sort.key)
      return va.localeCompare(vb, undefined, { numeric: true }) * sort.dir
    })
  }, [history.rows, sort])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [panelOpen, setPanelOpen] = useState(false)

  const open = (row: ExecutionHistoryRow) => {
    if (!row.campaign || !row.entry || row.removed || row.superseded) return
    const execute = isOpenCampaignStatus(row.campaign.status)        // Q5 — campagne ouverte : exécution
    void navigate({
      to: execute ? '/campaign/$campaignId/execute/$testId' : '/campaign/$campaignId/run/$testId',
      params: { campaignId: row.campaign.id, testId: row.entry.entryId },
      search: { repoPath, projectId: projectId ?? '' },
    } as never)
  }

  const label = (c: ExecutionColumn) => (c.literal ? c.label : t(`executionHistory.col.${c.label}`))
  const fieldDefOf = (row: ExecutionHistoryRow, name: string) =>
    history.runFieldDefs[row.objectTypeRef]?.runFields.find(f => f.name === name)

  const cell = (row: ExecutionHistoryRow, c: ExecutionColumn) => {
    const run = row.run
    switch (c.key) {
      case 'verdict': {
        const v = run?.result ?? 'pending'
        return <span className={`text-xs px-2 py-0.5 rounded-full ${VERDICT_CLASS[v]}`}>{t(VERDICT_KEY[v])}</span>
      }
      case 'date': return run ? new Date(run.executedAt).toLocaleString(i18n.language === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''
      case 'tester': return run?.executedBy ?? ''
      case 'duration': return run?.duration ? `${run.duration} s` : ''
      case 'origin': return run ? t(run.origin === 'excel-import' ? 'executionHistory.originExcel' : 'executionHistory.originApp') : ''
      case 'notes': return run?.notes ? <RichTextViewer value={run.notes} repoPath={repoPath} /> : ''
      case 'equipment': return (run?.equipmentUsed ?? []).map(e => `${e.role} : ${(e as { identification?: string }).identification ?? ''}`).join('\n')
      case 'campaign': {
        if (row.campaignMissing) return <span className="text-ink-3 italic">{t('executionHistory.campaignMissing')}</span>
        if (!row.campaign) return <span className="text-ink-3">{t('executionHistory.isolated')}</span>
        return <span title={row.campaign.title}>{row.campaign.id} — {row.campaign.title}</span>
      }
      case 'campaignStatus': return row.campaign ? t(`executionHistory.campaignStatus.${row.campaign.status}`) : ''
      case 'entry': {
        if (!row.entry) return ''
        const clickable = !!row.campaign && !row.removed && !row.superseded
        return (
          <span className="inline-flex items-center gap-1">
            {clickable
              ? <button type="button" className="font-mono text-status-info hover:underline" onClick={() => open(row)}>{row.entry.entryId}</button>
              : <span className="font-mono">{row.entry.entryId}</span>}
            {row.removed && <span className="text-[10px] px-1 rounded bg-status-neutral-bg text-status-neutral">{t('executionHistory.removed')}</span>}
            {row.superseded && <span className="text-[10px] px-1 rounded bg-status-neutral-bg text-status-neutral" title={t('executionHistory.supersededTitle')}>{t('executionHistory.superseded')}</span>}
          </span>
        )
      }
      case 'entryRequirement': return row.entry?.requirementId ?? ''
      case 'params': {
        const values = { ...(row.entry?.paramValues ?? {}), ...(row.entry?.resolvedParams ?? {}) }
        return Object.keys(values).sort().map(k => `${k} = ${values[k]}`).join('\n')
      }
      case 'testVersion': return row.entry?.testVersion !== undefined ? `v${row.entry.testVersion}` : ''
      case 'carriedFrom': return row.entry?.carriedFrom ? `${row.entry.carriedFrom.campaignId} / ${row.entry.carriedFrom.entryId}` : ''
      case 'test': return <span title={row.testTitle}><span className="font-mono">{row.testCaseId}</span> — {row.testTitle}</span>
      default: {
        if (c.key.startsWith('run:')) {
          const name = c.key.slice(4)
          const value = run?.fields?.[name]
          if (value === undefined) return ''
          const def = fieldDefOf(row, name) ?? c.field
          return def ? <RunFieldValue def={def} value={value} repoPath={repoPath} /> : fieldValueToText(value)
        }
        if (c.key.startsWith('campaign:')) return fieldValueToText(row.campaign?.fields[c.key.slice(9)])
        return ''
      }
    }
  }

  if (history.rows.length === 0) return <p className="text-xs text-ink-3 italic">{t('executionHistory.empty')}</p>

  return (
    <div className="relative" data-testid="execution-history">
      <div className="flex justify-end mb-1">
        <button type="button" onClick={() => setPanelOpen(o => !o)} className="text-xs text-ink-2 hover:text-ink" title={t('executionHistory.configure')}
          data-testid="execution-columns-button">⚙️ {t('executionHistory.columns')}</button>
      </div>
      {panelOpen && (
        <div className="absolute right-0 top-6 z-20 bg-surface border border-edge rounded shadow-lg p-3 w-72 max-h-96 overflow-y-auto" data-testid="execution-columns-panel">
          {GROUPS.map(g => {
            const inGroup = columns.filter(c => c.group === g)
            if (inGroup.length === 0) return null
            return (
              <div key={g} className="mb-2">
                <p className="section-label mb-1">{t(`executionHistory.group.${g}`)}</p>
                {inGroup.map(c => (
                  <label key={c.key} className="flex items-center gap-1.5 text-xs text-ink py-0.5 cursor-pointer">
                    <input type="checkbox" className="h-3 w-3 accent-ink" checked={visibleKeys.includes(c.key)}
                      data-testid={`execution-column-${c.key}`}
                      onChange={e => void savePrefs(e.target.checked
                        ? [...visibleKeys.filter(k => columns.some(x => x.key === k)), c.key]
                        : visibleKeys.filter(k => k !== c.key))} />
                    {label(c)}
                  </label>
                ))}
              </div>
            )
          })}
          <button type="button" className="text-xs text-ink-3 hover:text-ink underline" onClick={() => void savePrefs(null)}>
            {t('system.fieldConfig.reset')}
          </button>
        </div>
      )}
      <div className="overflow-x-auto border border-edge rounded">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-hover">
              <th className="w-6" />
              {visible.map(c => (
                <th key={c.key} className={`text-left font-medium text-ink-2 px-2 py-1 border-b border-edge select-none whitespace-nowrap ${isSortable(c.key) ? 'cursor-pointer' : ''}`}
                  onClick={isSortable(c.key) ? () => setSort(s => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })) : undefined}>
                  {label(c)}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isOpen = expanded.has(row.key)
              const steps = row.run?.stepResults ?? []
              return (
                <Fragment key={row.key}>
                  <tr className={`border-b border-edge hover:bg-hover/50 ${row.removed ? 'opacity-70' : ''}`} data-testid="execution-row" data-key={row.key}>
                    <td className="px-1 align-top">
                      {steps.length > 0 && (
                        <button type="button" className="text-ink-3 hover:text-ink" aria-label={t('executionHistory.toggleSteps')}
                          onClick={() => setExpanded(prev => { const n = new Set(prev); if (n.has(row.key)) n.delete(row.key); else n.add(row.key); return n })}>
                          {isOpen ? '▾' : '▸'}
                        </button>
                      )}
                    </td>
                    {visible.map(c => <td key={c.key} className="px-2 py-1 align-top whitespace-pre-wrap">{cell(row, c)}</td>)}
                  </tr>
                  {isOpen && steps.map(sr => (
                    <tr key={`${row.key}#${sr.order}`} className="bg-hover/30 border-b border-edge" data-testid="execution-step-row">
                      <td />
                      <td colSpan={Math.max(visible.length, 1)} className="px-2 py-1">
                        <div className="flex items-start gap-3">
                          <span className="font-mono text-ink-3 shrink-0">#{sr.order}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${VERDICT_CLASS[sr.result]}`}>{t(STEP_KEY[sr.result])}</span>
                          {sr.comment && <div className="min-w-0 flex-1"><RichTextViewer value={sr.comment} repoPath={repoPath} /></div>}
                          {sr.fields && stepFields.filter(f => sr.fields![f.name] !== undefined).map(f => (
                            <span key={f.name} className="shrink-0"><span className="text-ink-3">{f.label ?? f.name} : </span>
                              <RunFieldValue def={f} value={sr.fields![f.name]} repoPath={repoPath} /></span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
