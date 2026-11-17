import { useCallback, useMemo, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { fieldValueToText, isOpenCampaignStatus, testedDeviations, type ExecutionHistory, type ExecutionHistoryRow, type StepResultValue, type TestedConfigNode, stripRichTextColorTags } from '@polenta/types'
import { RichTextViewer } from '../RichTextViewer'
import { RunFieldValue } from '../runs/RunFieldValues'
import { ElementLink } from '../element/ElementLink'
import { PageLink } from '../element/PageLink'
import { DataGrid } from '../grid/DataGrid'
import type { GridColumn } from '../grid/gridTypes'
import { useGridScrollKey } from '../grid/useGridScrollKey'
import { driftText, testedValueText } from './TestedConfigView'
import { availableColumns, defaultExecutionColumns, unionRunFields, type ExecutionColumn } from './executionColumns'

/** Libellé de l'origine d'un run (GH36 classeur, GH129 JUnit) ; absente : saisie dans l'outil. */
const ORIGIN_LABEL_KEY: Record<string, string> = {
  'excel-import': 'executionHistory.originExcel',
  'junit-import': 'executionHistory.originJunit',
}

// GH197 — grille d'historique des exécutions (specs/GH197.md §1–§3) : une ligne par run (ou entrée en
// attente), colonnes au choix (préférence `executions` du type), étapes dépliables. GH389 §4 : sur la
// grille commune (`DataGrid`), sans tri (D4) ; test, campagne, exigence et version testée en liens.

export const VERDICT_KEY: Record<string, string> = {
  pending: 'campaignPage.runStatus.pending', PASS: 'campaignPage.runStatus.pass', FAIL: 'campaignPage.runStatus.fail',
  BLOCKED: 'campaignPage.runStatus.blocked', INCOMPLETE: 'campaignPage.runStatus.incomplete',
}
const STEP_KEY: Record<StepResultValue, string> = {
  PASS: 'campaignPage.runStatus.pass', FAIL: 'campaignPage.runStatus.fail', BLOCKED: 'campaignPage.runStatus.blocked',
  SKIP: 'campaignPage.stepResult.skip', NOT_EXECUTED: 'campaignPage.stepResult.notExecuted',
}
export const VERDICT_CLASS: Record<string, string> = {
  pending: 'bg-status-neutral-bg text-status-neutral', PASS: 'bg-status-success-bg text-status-success',
  FAIL: 'bg-status-danger-bg text-status-danger', BLOCKED: 'bg-status-warning-bg text-status-warning',
  INCOMPLETE: 'bg-status-warning-bg text-status-warning', SKIP: 'bg-status-warning-bg text-status-warning',
  NOT_EXECUTED: 'bg-status-neutral-bg text-status-neutral',
}

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const getRowKey = (row: ExecutionHistoryRow) => row.key
const hasSteps = (row: ExecutionHistoryRow) => (row.run?.stepResults ?? []).length > 0
const rowClass = (row: ExecutionHistoryRow) => (row.removed ? 'opacity-70' : undefined)

/** GH202 — composants de la copie, à plat : `chemin = valeur`. */
function structureLines(node: TestedConfigNode, prefix = ''): string[] {
  return Object.entries(node.components ?? {}).flatMap(([name, child]) => {
    const path = prefix ? `${prefix}/${name}` : name
    return [`${path} = ${testedValueText(child)}`, ...structureLines(child, path)]
  })
}

interface Props {
  repoPath: string
  projectId?: string
  history: ExecutionHistory
  /** Clé de préférence (`<nœud>::<type>` du test ou de l'exigence). */
  typeKey: string
  /** Grille d'une exigence : colonne Test proposée (lignes de plusieurs tests). */
  withTestColumn: boolean
  /** Titre de l'export (feuille et fichier). */
  title: string
}

export function ExecutionHistoryGrid({ repoPath, projectId, history, typeKey, withTestColumn, title }: Props) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const scrollKey = useGridScrollKey('executions')

  const open = (row: ExecutionHistoryRow) => {
    if (!row.campaign || !row.entry || row.removed || row.superseded) return
    const execute = isOpenCampaignStatus(row.campaign.status)        // Q5 — campagne ouverte : exécution
    void navigate({
      to: execute ? '/campaign/$campaignId/execute/$testId' : '/campaign/$campaignId/run/$testId',
      params: { campaignId: row.campaign.id, testId: row.entry.entryId },
      search: { repoPath, projectId: projectId ?? '' },
    } as never)
  }
  const openVersion = (versionId: string, versionRepo: string) =>
    void navigate({ to: '/version/$versionId', params: { versionId }, search: { projectId: projectId ?? '', repoPath: versionRepo } } as never)
  // Gestes des cellules lus par une ref : colonnes stables (cellules mémoïsées).
  const gestures = useRef({ open, openVersion })
  gestures.current = { open, openVersion }

  const columns = useMemo<GridColumn<ExecutionHistoryRow>[]>(() => {
    const locale = i18n.language === 'en' ? 'en-GB' : 'fr-FR'
    const label = (c: ExecutionColumn) => (c.literal ? c.label : t(`executionHistory.col.${c.label}`))
    const group = (c: ExecutionColumn) => t(`executionHistory.group.${c.group}`)
    const fieldDefOf = (row: ExecutionHistoryRow, name: string) =>
      history.runFieldDefs[row.objectTypeRef]?.runFields.find(f => f.name === name)
    const verdictText = (row: ExecutionHistoryRow) => t(VERDICT_KEY[row.run?.result ?? 'pending'])
    const campaignText = (row: ExecutionHistoryRow) => {
      if (row.campaignMissing) return t('executionHistory.campaignMissing')
      if (!row.campaign) return t('executionHistory.isolated')
      return `${row.campaign.id} — ${row.campaign.title}`
    }
    const entryText = (row: ExecutionHistoryRow) => (row.entry
      ? [row.entry.entryId, row.removed ? t('executionHistory.removed') : '', row.superseded ? t('executionHistory.superseded') : ''].filter(Boolean).join(' ')
      : '')
    const paramsText = (row: ExecutionHistoryRow) => {
      const values = { ...(row.entry?.paramValues ?? {}), ...(row.entry?.resolvedParams ?? {}) }
      return Object.keys(values).sort().map(k => `${k} = ${values[k]}`).join('\n')
    }
    const deviationText = (node: TestedConfigNode, path: string) =>
      `${path ? `${path} : ` : ''}${testedValueText(node)}${node.expected !== undefined ? ` (${t('testedConfig.expected', { ref: node.expected ?? t('testedConfig.none') })})` : ''}`

    const describe = (c: ExecutionColumn): Pick<GridColumn<ExecutionHistoryRow>, 'getText' | 'render' | 'elementId'> => {
      switch (c.key) {
        case 'verdict':
          return {
            getText: verdictText,
            render: row => <span className={`text-xs px-2 py-0.5 rounded-full ${VERDICT_CLASS[row.run?.result ?? 'pending']}`}>{verdictText(row)}</span>,
          }
        case 'date':
          return { getText: row => (row.run ? new Date(row.run.executedAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '') }
        case 'tester': return { getText: row => row.run?.executedBy ?? '' }
        case 'duration': return { getText: row => (row.run?.duration ? `${row.run.duration} s` : '') }
        case 'origin': return { getText: row => (row.run ? t(ORIGIN_LABEL_KEY[row.run.origin ?? ''] ?? 'executionHistory.originApp') : '') }
        case 'notes':
          return {
            getText: row => (row.run?.notes ? stripHtml(row.run.notes) : ''),
            render: row => (row.run?.notes ? <RichTextViewer value={row.run.notes} repoPath={repoPath} /> : ''),
          }
        case 'equipment':
          return { getText: row => (row.run?.equipmentUsed ?? []).map(e => `${e.role} : ${(e as { identification?: string }).identification ?? ''}`).join('\n') }
        case 'campaign':
          return {
            getText: campaignText,
            render: row => {
              if (row.campaignMissing) return <span className="text-ink-3 italic">{campaignText(row)}</span>
              if (!row.campaign) return <span className="text-ink-3">{campaignText(row)}</span>
              return <span><ElementLink id={row.campaign.id} className="font-mono text-prim" /> — {row.campaign.title}</span>
            },
            elementId: row => row.campaign?.id,
          }
        case 'campaignStatus': return { getText: row => (row.campaign ? t(`executionHistory.campaignStatus.${row.campaign.status}`) : '') }
        case 'entry':
          return {
            getText: entryText,
            render: row => {
              if (!row.entry) return ''
              const clickable = !!row.campaign && !row.removed && !row.superseded
              return (
                <span className="inline-flex items-center gap-1">
                  {clickable
                    ? <button type="button" data-cell-link data-cell-dblclick-ignore className="font-mono text-status-info hover:underline"
                        onClick={e => { e.stopPropagation(); gestures.current.open(row) }}>{row.entry.entryId}</button>
                    : <span className="font-mono">{row.entry.entryId}</span>}
                  {row.removed && <span className="text-[10px] px-1 rounded bg-status-neutral-bg text-status-neutral">{t('executionHistory.removed')}</span>}
                  {row.superseded && <span className="text-[10px] px-1 rounded bg-status-neutral-bg text-status-neutral" title={t('executionHistory.supersededTitle')}>{t('executionHistory.superseded')}</span>}
                </span>
              )
            },
          }
        case 'entryRequirement':
          return {
            getText: row => row.entry?.requirementId ?? '',
            render: row => (row.entry?.requirementId ? <ElementLink id={row.entry.requirementId} className="font-mono text-prim" /> : ''),
            elementId: row => row.entry?.requirementId,
          }
        case 'params': return { getText: paramsText }
        case 'testVersion': return { getText: row => (row.entry?.testVersion !== undefined ? `v${row.entry.testVersion}` : '') }
        case 'carriedFrom':
          return {
            getText: row => (row.entry?.carriedFrom ? `${row.entry.carriedFrom.campaignId} / ${row.entry.carriedFrom.entryId}` : ''),
            render: row => {
              const from = row.entry?.carriedFrom
              return from ? <span><ElementLink id={from.campaignId} className="font-mono text-prim" /> / {from.entryId}</span> : ''
            },
            elementId: row => row.entry?.carriedFrom?.campaignId,
          }
        case 'testedVersion':
          return {
            getText: row => (row.run?.testedConfig ? testedValueText(row.run.testedConfig) : row.run ? '—' : ''),
            render: row => {
              const config = row.run?.testedConfig
              if (!row.run) return ''
              if (!config) return <span className="text-ink-3">—</span>
              const versionRepo = row.testedRepoPath ?? repoPath
              return (
                <span className="inline-flex items-center gap-1 flex-wrap">
                  {config.ref
                    ? <PageLink id={config.ref} repoPath={versionRepo} className="text-status-info"
                        onFallback={() => gestures.current.openVersion(config.ref!, versionRepo)}>{testedValueText(config)}</PageLink>
                    : <span className="px-1 rounded bg-status-danger-bg text-status-danger">{config.undocumented}</span>}
                  {row.testedDrift && (
                    <span className="text-[10px] px-1 rounded bg-status-warning-bg text-status-warning" data-testid="execution-tested-evolved"
                      title={row.testedDrift.map(d => driftText(t, d)).join('\n')}>{t('testedConfig.evolved')}</span>
                  )}
                </span>
              )
            },
          }
        case 'testedStructure': return { getText: row => (row.run?.testedConfig ? structureLines(row.run.testedConfig).join('\n') : '') }
        case 'testedCommit':
          return {
            getText: row => row.run?.testedConfig?.commit?.slice(0, 7) ?? '',
            render: row => (row.run?.testedConfig?.commit ? <span className="font-mono" title={row.run.testedConfig.commit}>{row.run.testedConfig.commit.slice(0, 7)}</span> : ''),
          }
        case 'testedDeviations':
          return {
            getText: row => (row.run?.testedConfig ? testedDeviations(row.run.testedConfig).map(({ path, node }) => deviationText(node, path)).join('\n') : ''),
            render: row => {
              if (!row.run?.testedConfig) return ''
              return (
                <span className="flex flex-col gap-0.5">
                  {testedDeviations(row.run.testedConfig).map(({ path, node }) => (
                    <span key={path} className={`px-1 rounded ${node.undocumented ? 'bg-status-danger-bg text-status-danger' : 'bg-status-warning-bg text-status-warning'}`}>
                      {deviationText(node, path)}
                    </span>
                  ))}
                </span>
              )
            },
          }
        case 'test':
          return {
            getText: row => `${row.testCaseId} — ${row.testTitle}`,
            render: row => <span><ElementLink id={row.testCaseId} className="font-mono text-prim" /> — {row.testTitle}</span>,
            elementId: row => row.testCaseId,
          }
        default: {
          if (c.key.startsWith('run:')) {
            const name = c.key.slice(4)
            return {
              getText: row => (row.run?.fields?.[name] === undefined ? '' : stripHtml(fieldValueToText(row.run.fields[name]))),
              render: row => {
                const value = row.run?.fields?.[name]
                if (value === undefined) return ''
                const def = fieldDefOf(row, name) ?? c.field
                return def ? <RunFieldValue def={def} value={value} repoPath={repoPath} /> : fieldValueToText(value)
              },
            }
          }
          // GH299 — cellule texte : sans les balises de couleur d'un richtext.
          if (c.key.startsWith('campaign:')) {
            const name = c.key.slice(9)
            return { getText: row => stripRichTextColorTags(fieldValueToText(row.campaign?.fields[name])) }
          }
          return { getText: () => '' }
        }
      }
    }
    return availableColumns(history, withTestColumn).map(c => ({ key: c.key, label: label(c), group: group(c), ...describe(c) }))
  }, [history, withTestColumn, t, i18n.language, repoPath])

  const defaults = useMemo(() => defaultExecutionColumns(history, withTestColumn), [history, withTestColumn])
  const prefs = useMemo(() => ({ repoPath, prefKey: typeKey, view: 'executions', defaults }), [repoPath, typeKey, defaults])
  const stepFields = useMemo(() => unionRunFields(history.runFieldDefs, 'stepFields'), [history.runFieldDefs])
  const renderSteps = useCallback((row: ExecutionHistoryRow) => (
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
  ), [stepFields, repoPath, t])

  if (history.rows.length === 0) return <p className="text-xs text-ink-3 italic">{t('executionHistory.empty')}</p>

  return (
    <div className="flex flex-col max-h-[70vh] min-h-0" data-testid="execution-history">
      <DataGrid
        gridId="execution"
        title={title}
        rows={history.rows}
        getRowId={getRowKey}
        columns={columns}
        prefs={prefs}
        renderExpanded={renderSteps}
        canExpand={hasSteps}
        rowClassName={rowClass}
        scrollMemoryKey={scrollKey}
      />
    </div>
  )
}
