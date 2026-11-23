import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ExecutionHistoryRow, ValidationRow, ValidationSignedRun } from '@polenta/types'
import { api } from '../../api'
import { VERDICT_CLASS, VERDICT_KEY } from '../executions/ExecutionHistoryGrid'
import { driftText, testedValueText } from '../executions/TestedConfigView'
import { runMentions, type RunMention } from './runMentions'
import { groupExecutionsByTest } from './validationRunGroups'
import { ElementLink } from '../element/ElementLink'
import { PageLink } from '../element/PageLink'
import { htmlToCellText } from '../grid/cellText'

const MENTION_CLASS: Record<RunMention, string> = {
  other_version: 'bg-status-warning-bg text-status-warning',
  no_version: 'bg-status-neutral-bg text-status-neutral',
  evolved: 'bg-status-warning-bg text-status-warning',
  after_signature: 'bg-status-info-bg text-status-info',
}

/** Date d'un run : un fichier édité à la main peut donner une `Date` YAML plutôt qu'une chaîne. */
const runDate = (v: unknown, length: number): string => {
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? String(v ?? '') : d.toISOString().slice(0, length).replace('T', ' ')
}

/** GH204 §7 — tests d'une exigence et leur dernière exécution ; dépliés : leurs exécutions. */
export function ValidationRuns({ repoPath, projectId, workspaceDir, requirementId, tests, versionId, signedAt, frozen }: {
  repoPath: string
  projectId: string
  workspaceDir?: string
  requirementId: string
  tests: ValidationRow['tests']
  versionId: string
  signedAt: string | null
  /** GH267 — lignes de test lues dans la copie ; les exécutions actuelles restent sous le chevron. */
  frozen?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['validations', 'runs', repoPath, requirementId, workspaceDir ?? ''],
    queryFn: () => api.executions.history(repoPath, { requirementId }, workspaceDir),
  })
  const [open, setOpen] = useState<Set<string>>(new Set())
  // Tous les tests liés, même jamais exécutés : la qualité voit ce qui manque (GH267 : groupes dans la copie).
  const byTest = useMemo(() => groupExecutionsByTest(tests, data?.rows ?? [], !!frozen), [data, tests, frozen])
  // GH430 — une entrée en attente ouvre sa page d'exécution, comme dans la grille des exécutions.
  const openPending = (row: ExecutionHistoryRow) => {
    if (!row.campaign || !row.entry) return
    void navigate({
      to: '/campaign/$campaignId/execute/$testId',
      params: { campaignId: row.campaign.id, testId: row.entry.entryId },
      search: { repoPath, projectId },
    } as never)
  }

  if (isLoading && !frozen) return <p className="text-xs text-ink-3 italic">{t('common.loading')}</p>
  if (error && !frozen) return <p className="text-xs text-status-danger">{String(error)}</p>
  if (byTest.length === 0) return <p className="text-xs text-ink-3 italic" data-testid="validation-no-test">{t('validation.noTest')}</p>

  // Version testée : lien vers sa page, dans son repo (GH389 §1.8).
  const testedVersion = (row: ExecutionHistoryRow) => {
    const config = row.run?.testedConfig
    if (!config) return '—'
    if (!config.ref) return testedValueText(config)
    const versionRepo = row.testedRepoPath ?? repoPath
    return (
      <PageLink id={config.ref} repoPath={versionRepo} className="text-prim"
        onFallback={() => void navigate({ to: '/version/$versionId', params: { versionId: config.ref! }, search: { projectId, repoPath: versionRepo } } as never)}>
        {testedValueText(config)}
      </PageLink>
    )
  }
  const verdict = (row: Pick<ExecutionHistoryRow, 'run'> | { run: { result: ValidationSignedRun['result'] } }) => {
    const v = row.run?.result ?? 'pending'
    return <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${VERDICT_CLASS[v]}`}>{t(VERDICT_KEY[v])}</span>
  }
  return (
    <table className="w-full text-xs border-collapse" data-testid={`validation-runs-${requirementId}`}>
      <tbody>
        {byTest.map(([testId, { title, local, signedRun, runs, pending }]) => {
          const last = runs[0] as ExecutionHistoryRow | undefined
          const shown = frozen ? signedRun : last?.run
          const isOpen = open.has(testId)
          return (
            <Fragment key={testId}>
              <tr className="border-b border-edge-subtle">
                <td className="py-1 w-6">
                  {runs.length + pending.length > 0 && (
                    <button type="button" className="text-ink-3 hover:text-ink" aria-expanded={isOpen} aria-label={testId} data-testid={`validation-test-toggle-${testId}`}
                      onClick={() => setOpen(s => { const n = new Set(s); if (!n.delete(testId)) n.add(testId); return n })}>
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  )}
                </td>
                <td className="py-1 pr-3 whitespace-nowrap">
                  <ElementLink id={testId} className="font-mono text-prim" />
                </td>
                <td className="py-1 pr-3 text-ink-2 w-full">
                  {title}
                  {frozen && signedRun && (
                    <span className="ml-2 inline-flex flex-wrap gap-1" data-testid={`validation-frozen-run-${testId}`}>
                      <span className="text-ink-3">{signedRun.testedConfig ? testedValueText(signedRun.testedConfig) : '—'}</span>
                      {runMentions({ run: signedRun, testedDrift: signedRun.testedDrift }, versionId, null).map(m => (
                        <span key={m} className={`text-[10px] px-1.5 rounded ${MENTION_CLASS[m]}`}>{t(`validation.mention.${m}`)}</span>
                      ))}
                    </span>
                  )}
                </td>
                {shown ? (
                  <>
                    <td className="py-1 pr-3 whitespace-nowrap">{runDate(shown.executedAt, 10)}</td>
                    <td className="py-1 whitespace-nowrap">{verdict({ run: shown })}</td>
                  </>
                ) : (
                  <td colSpan={2} className="py-1 whitespace-nowrap text-ink-3 italic" data-testid={`validation-test-empty-${testId}`}>
                    {t(local ? 'validation.noRun' : 'validation.otherComponent')}
                  </td>
                )}
              </tr>
              {isOpen && pending.map(row => (
                <tr key={row.key} className="border-b border-edge-subtle bg-hover/40" data-testid={`validation-pending-${row.key}`}>
                  <td />
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {row.entry && (
                      <button type="button" className="font-mono text-status-info hover:underline" data-testid={`validation-pending-link-${row.key}`}
                        onClick={() => openPending(row)}>{row.entry.entryId}</button>
                    )}
                  </td>
                  <td className="py-1 pr-3 text-ink-2">{row.campaign && `${row.campaign.id} — ${row.campaign.title}`}</td>
                  <td />
                  <td className="py-1 whitespace-nowrap">{verdict(row)}</td>
                </tr>
              ))}
              {isOpen && runs.map(row => (
                <tr key={row.key} className="border-b border-edge-subtle bg-hover/40" data-testid={`validation-run-${row.key}`}>
                  <td />
                  <td className="py-1 pr-3 whitespace-nowrap text-ink-3">
                    {/* GH399 — lien d'exécution : popup, page d'exécution ou relecture (règle de `follow`). */}
                    {row.run
                      ? <span data-testid={`validation-run-link-${row.key}`}><ElementLink id={row.run.id} className="text-prim">{runDate(row.run.executedAt, 16)}</ElementLink></span>
                      : ''}
                  </td>
                  <td className="py-1 pr-3">
                    <div className="text-ink-2">{testedVersion(row)}</div>
                    {row.run?.notes && <div className="text-ink-3">{htmlToCellText(row.run.notes)}</div>}
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {runMentions(row, versionId, signedAt).map(m => (
                        <span key={m} data-testid={`validation-mention-${m}`} className={`text-[10px] px-1.5 rounded ${MENTION_CLASS[m]}`}
                          title={m === 'evolved' ? row.testedDrift?.map(d => driftText(t, d)).join('\n') : undefined}>
                          {t(`validation.mention.${m}`)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-1 pr-3 whitespace-nowrap text-ink-3">{row.run?.executedBy}</td>
                  <td className="py-1 whitespace-nowrap">{verdict(row)}</td>
                </tr>
              ))}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
