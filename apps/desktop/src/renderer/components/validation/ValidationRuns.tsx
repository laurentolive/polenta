import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ExecutionHistoryRow, ValidationRow } from '@polenta/types'
import { isOpenCampaignStatus } from '@polenta/types'
import { api } from '../../api'
import { VERDICT_CLASS, VERDICT_KEY } from '../executions/ExecutionHistoryGrid'
import { driftText, testedValueText } from '../executions/TestedConfigView'
import { runMentions, type RunMention } from './runMentions'

const MENTION_CLASS: Record<RunMention, string> = {
  other_version: 'bg-status-warning-bg text-status-warning',
  no_version: 'bg-status-neutral-bg text-status-neutral',
  evolved: 'bg-status-warning-bg text-status-warning',
  after_signature: 'bg-status-info-bg text-status-info',
}

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
/** Date d'un run : un fichier édité à la main peut donner une `Date` YAML plutôt qu'une chaîne. */
const runDate = (v: unknown, length: number): string => {
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? String(v ?? '') : d.toISOString().slice(0, length).replace('T', ' ')
}

/** GH204 §7 — tests d'une exigence et leur dernière exécution ; dépliés : leurs exécutions. */
export function ValidationRuns({ repoPath, projectId, workspaceDir, requirementId, tests, versionId, signedAt }: {
  repoPath: string
  projectId: string
  workspaceDir?: string
  requirementId: string
  tests: ValidationRow['tests']
  versionId: string
  signedAt: string | null
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['validations', 'runs', repoPath, requirementId, workspaceDir ?? ''],
    queryFn: () => api.executions.history(repoPath, { requirementId }, workspaceDir),
  })
  const [open, setOpen] = useState<Set<string>>(new Set())
  const byTest = useMemo(() => {
    // Tous les tests liés, même jamais exécutés : la qualité voit ce qui manque.
    const map = new Map(tests.map(test => [test.id, { title: test.title, local: test.local, rows: [] as ExecutionHistoryRow[] }]))
    for (const row of data?.rows ?? []) {
      if (row.kind !== 'run') continue
      const entry = map.get(row.testCaseId) ?? { title: row.testTitle, local: true, rows: [] }
      entry.rows.push(row)
      map.set(row.testCaseId, entry)
    }
    return [...map.entries()]
  }, [data, tests])

  if (isLoading) return <p className="text-xs text-ink-3 italic">{t('common.loading')}</p>
  if (error) return <p className="text-xs text-status-danger">{String(error)}</p>
  if (byTest.length === 0) return <p className="text-xs text-ink-3 italic" data-testid="validation-no-test">{t('validation.noTest')}</p>

  const canOpen = (row: ExecutionHistoryRow) => !!row.campaign && !!row.entry && !row.removed && !row.superseded
  // Comme la grille d'historique : l'exécution ouverte, ou son résultat si la campagne est fermée.
  const openRun = (row: ExecutionHistoryRow) => void navigate({
    to: isOpenCampaignStatus(row.campaign!.status) ? '/campaign/$campaignId/execute/$testId' : '/campaign/$campaignId/run/$testId',
    params: { campaignId: row.campaign!.id, testId: row.entry!.entryId },
    search: { repoPath, projectId },
  } as never)
  const verdict = (row: ExecutionHistoryRow) => {
    const v = row.run?.result ?? 'pending'
    return <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${VERDICT_CLASS[v]}`}>{t(VERDICT_KEY[v])}</span>
  }
  return (
    <table className="w-full text-xs border-collapse" data-testid={`validation-runs-${requirementId}`}>
      <tbody>
        {byTest.map(([testId, { title, local, rows }]) => {
          const last = rows[0] as ExecutionHistoryRow | undefined
          const isOpen = open.has(testId)
          return (
            <Fragment key={testId}>
              <tr className="border-b border-edge-subtle">
                <td className="py-1 w-6">
                  {last && (
                    <button type="button" className="text-ink-3 hover:text-ink" aria-expanded={isOpen} aria-label={testId} data-testid={`validation-test-toggle-${testId}`}
                      onClick={() => setOpen(s => { const n = new Set(s); if (!n.delete(testId)) n.add(testId); return n })}>
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  )}
                </td>
                <td className="py-1 pr-3 whitespace-nowrap">
                  <button type="button" className="font-mono text-prim hover:underline" onClick={() => void navigate({ to: '/test/$testId', params: { testId }, search: { projectId, repoPath } as never })}>{testId}</button>
                </td>
                <td className="py-1 pr-3 text-ink-2 w-full">{title}</td>
                {last ? (
                  <>
                    <td className="py-1 pr-3 whitespace-nowrap">{last.run ? runDate(last.run.executedAt, 10) : ''}</td>
                    <td className="py-1 whitespace-nowrap">{verdict(last)}</td>
                  </>
                ) : (
                  <td colSpan={2} className="py-1 whitespace-nowrap text-ink-3 italic" data-testid={`validation-test-empty-${testId}`}>
                    {t(local ? 'validation.noRun' : 'validation.otherComponent')}
                  </td>
                )}
              </tr>
              {isOpen && rows.map(row => (
                <tr key={row.key} className="border-b border-edge-subtle bg-hover/40" data-testid={`validation-run-${row.key}`}>
                  <td />
                  <td className="py-1 pr-3 whitespace-nowrap text-ink-3">
                    {canOpen(row)
                      ? <button type="button" className="text-prim hover:underline" onClick={() => openRun(row)} data-testid={`validation-run-link-${row.key}`}>{row.run ? runDate(row.run.executedAt, 16) : ''}</button>
                      : row.run ? runDate(row.run.executedAt, 16) : ''}
                  </td>
                  <td className="py-1 pr-3">
                    <div className="text-ink-2">{row.run?.testedConfig ? testedValueText(row.run.testedConfig) : '—'}</div>
                    {row.run?.notes && <div className="text-ink-3">{stripHtml(row.run.notes)}</div>}
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
