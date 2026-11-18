import type { RefObject } from 'react'
import type { TFunction } from 'i18next'
import { fieldValueToText, isOpenCampaignStatus, testedDeviations, type ExecutionHistory, type ExecutionHistoryRow, type StepResultValue, type TestedConfigNode, stripRichTextColorTags } from '@polenta/types'
import { RichTextViewer } from '../RichTextViewer'
import { RunFieldValue } from '../runs/RunFieldValues'
import { ElementLink } from '../element/ElementLink'
import { PageLink } from '../element/PageLink'
import type { GridColumn } from '../grid/gridTypes'
import { htmlToCellText } from '../grid/cellText'
import { driftText, testedValueText } from './TestedConfigView'
import { availableColumns, type ExecutionColumn } from './executionColumns'

/** Libellé de l'origine d'un run (GH36 classeur, GH129 JUnit) ; absente : saisie dans l'outil. */
const ORIGIN_LABEL_KEY: Record<string, string> = {
  'excel-import': 'executionHistory.originExcel',
  'junit-import': 'executionHistory.originJunit',
}

export const VERDICT_KEY: Record<string, string> = {
  pending: 'campaignPage.runStatus.pending', PASS: 'campaignPage.runStatus.pass', FAIL: 'campaignPage.runStatus.fail',
  BLOCKED: 'campaignPage.runStatus.blocked', INCOMPLETE: 'campaignPage.runStatus.incomplete',
}
/** Verdict d'une étape (dépli de la grille, fiche du Document, export docx). */
export const STEP_KEY: Record<StepResultValue, string> = {
  PASS: 'campaignPage.runStatus.pass', FAIL: 'campaignPage.runStatus.fail', BLOCKED: 'campaignPage.runStatus.blocked',
  SKIP: 'campaignPage.stepResult.skip', NOT_EXECUTED: 'campaignPage.stepResult.notExecuted',
}
export const VERDICT_CLASS: Record<string, string> = {
  pending: 'bg-status-neutral-bg text-status-neutral', PASS: 'bg-status-success-bg text-status-success',
  FAIL: 'bg-status-danger-bg text-status-danger', BLOCKED: 'bg-status-warning-bg text-status-warning',
  INCOMPLETE: 'bg-status-warning-bg text-status-warning', SKIP: 'bg-status-warning-bg text-status-warning',
  NOT_EXECUTED: 'bg-status-neutral-bg text-status-neutral',
}

/** Gestes des cellules, lus par une ref : colonnes stables (cellules mémoïsées). */
export interface ExecutionGestures {
  openVersion(versionId: string, versionRepo: string): void
  /** Entrée en attente d'une campagne ouverte : page d'exécution. */
  openPending(row: ExecutionHistoryRow): void
}

/** GH202 — composants de la copie, à plat : `chemin = valeur`. */
function structureLines(node: TestedConfigNode, prefix = ''): string[] {
  return Object.entries(node.components ?? {}).flatMap(([name, child]) => {
    const path = prefix ? `${prefix}/${name}` : name
    return [`${path} = ${testedValueText(child)}`, ...structureLines(child, path)]
  })
}

export interface ExecutionColumnOptions {
  history: ExecutionHistory
  withTestColumn: boolean
  t: TFunction
  /** Langue de l'interface (`fr`, `en`). */
  language: string
  repoPath: string
  gestures: RefObject<ExecutionGestures>
  /** Rendu imprimable : liens en texte simple. */
  print?: boolean
}

/**
 * GH197 / GH400 — colonnes de l'historique des exécutions (specs/GH400-design.md §5) : un seul module
 * pour la grille, le Document, la page imprimable et l'export docx. `getText` sert au filtre et aux
 * exports, `render` à l'écran.
 */
export function buildExecutionColumns({ history, withTestColumn, t, language, repoPath, gestures, print }: ExecutionColumnOptions): GridColumn<ExecutionHistoryRow>[] {
  const locale = language === 'en' ? 'en-GB' : 'fr-FR'
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
  const idLink = (id: string) => (print ? <span className="font-mono">{id}</span> : <ElementLink id={id} className="font-mono text-prim" />)

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
          getText: row => (row.run?.notes ? htmlToCellText(row.run.notes) : ''),
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
            return <span>{idLink(row.campaign.id)} — {row.campaign.title}</span>
          },
          elementId: row => row.campaign?.id,
        }
      case 'campaignStatus': return { getText: row => (row.campaign ? t(`executionHistory.campaignStatus.${row.campaign.status}`) : '') }
      case 'entry':
        // GH399 — lien d'exécution (popup, navigation de `follow`) sur toute ligne de run ; exécution
        // isolée : son ID, en grisé, à la place de l'entrée. Entrée en attente d'une campagne ouverte :
        // bouton vers la page d'exécution, comme avant (pas d'exécution à prévisualiser).
        return {
          getText: row => (row.entry ? entryText(row) : row.run?.id ?? ''),
          render: row => {
            if (!row.entry && !row.run) return ''
            const text = row.entry?.entryId ?? row.run!.id
            const textClass = row.entry ? 'font-mono text-status-info' : 'font-mono text-ink-3'
            const pendingOpen = !print && !row.run && row.campaign && row.entry && isOpenCampaignStatus(row.campaign.status)
            return (
              <span className="inline-flex items-center gap-1">
                {row.run && !print
                  ? <ElementLink id={row.run.id} className={textClass}>{text}</ElementLink>
                  : pendingOpen
                    ? <button type="button" data-cell-link data-cell-dblclick-ignore className="font-mono text-status-info hover:underline"
                        onClick={e => { e.stopPropagation(); gestures.current?.openPending(row) }}>{text}</button>
                    : <span className="font-mono">{text}</span>}
                {row.removed && <span className="text-[10px] px-1 rounded bg-status-neutral-bg text-status-neutral">{t('executionHistory.removed')}</span>}
                {row.superseded && <span className="text-[10px] px-1 rounded bg-status-neutral-bg text-status-neutral" title={t('executionHistory.supersededTitle')}>{t('executionHistory.superseded')}</span>}
              </span>
            )
          },
          elementId: row => (print ? undefined : row.run?.id),
        }
      case 'entryRequirement':
        return {
          getText: row => row.entry?.requirementId ?? '',
          render: row => (row.entry?.requirementId ? idLink(row.entry.requirementId) : ''),
          elementId: row => row.entry?.requirementId,
        }
      case 'params': return { getText: paramsText }
      case 'testVersion': return { getText: row => (row.entry?.testVersion !== undefined ? `v${row.entry.testVersion}` : '') }
      case 'carriedFrom':
        return {
          getText: row => (row.entry?.carriedFrom ? `${row.entry.carriedFrom.campaignId} / ${row.entry.carriedFrom.entryId}` : ''),
          render: row => {
            const from = row.entry?.carriedFrom
            return from ? <span>{idLink(from.campaignId)} / {from.entryId}</span> : ''
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
                  ? print
                    ? <span>{testedValueText(config)}</span>
                    : <PageLink id={config.ref} repoPath={versionRepo} className="text-status-info"
                        onFallback={() => gestures.current?.openVersion(config.ref!, versionRepo)}>{testedValueText(config)}</PageLink>
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
          render: row => <span>{idLink(row.testCaseId)} — {row.testTitle}</span>,
          elementId: row => row.testCaseId,
        }
      default: {
        if (c.key.startsWith('run:')) {
          const name = c.key.slice(4)
          return {
            getText: row => (row.run?.fields?.[name] === undefined ? '' : htmlToCellText(fieldValueToText(row.run.fields[name]))),
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
}
