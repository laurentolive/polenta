import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import type {
  ExecutionImportFatal, ExecutionImportInstanceError, ExecutionImportPreview, ExecutionImportResult,
  TestRunResult, TestRunStatus,
} from '@polenta/types'
import { api } from '../../api'
import { toIntlLocale } from '../../i18n/useLocale'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

interface ExecutionImportModalProps {
  repoPath: string
  campaignId: string
  workspaceDir?: string
  preview: ExecutionImportPreview
  onClose: () => void
}

const RESULT_CLS: Record<TestRunResult, string> = {
  PASS: 'bg-status-success-bg text-status-success',
  FAIL: 'bg-status-danger-bg text-status-danger',
  BLOCKED: 'bg-status-warning-bg text-status-warning',
  INCOMPLETE: 'bg-status-neutral-bg text-status-neutral',
}

const statusKey = (s: TestRunStatus) => `campaignPage.runStatus.${s === 'pending' ? 'pending' : s.toLowerCase()}`

/**
 * GH36 sprint 2 — aperçu d'un classeur d'exécution rempli avant écriture (spec §4.3), puis
 * application. Le main relit et revalide le fichier à l'application : le bilan final s'appuie sur
 * ce qui a réellement été écrit, pas sur l'aperçu.
 */
export function ExecutionImportModal({ repoPath, campaignId, workspaceDir, preview, onClose }: ExecutionImportModalProps) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [result, setResult] = useState<ExecutionImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applyMutation = useMutation({
    mutationFn: () => api.campaigns.executionSheet.apply(repoPath, campaignId, preview.filePath, workspaceDir),
    onSuccess: res => setResult(res),
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('common.unknownError')),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['campaign', repoPath, campaignId] })
      qc.invalidateQueries({ queryKey: ['campaigns', repoPath] })
      qc.invalidateQueries({ queryKey: ['traceability-matrix', repoPath] })
      qc.invalidateQueries({ queryKey: ['test-runs', repoPath] })
    },
  })

  const count = preview.importable.length
  const canApply = !preview.fatal && count > 0 && !applyMutation.isPending && !result
  const confirm = () => { if (canApply) applyMutation.mutate() }
  useModalHotkeys(onClose, confirm, applyMutation.isPending)

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(toIntlLocale(i18n.language), { dateStyle: 'short', timeStyle: 'short' })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={() => !applyMutation.isPending && onClose()}>
      <div
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-4xl w-full mx-4 max-h-[85vh] flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <h2 className="text-sm font-semibold text-ink">{t('campaignPage.executionSheet.importTitle')}</h2>
          <p className="text-xs text-ink-3 break-all">{preview.fileName}</p>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          {result ? (
            <ResultSummary result={result} previewCount={count} />
          ) : preview.fatal ? (
            <p className="text-sm text-status-danger">{fatalMessage(t, preview.fatal)}</p>
          ) : (
            <>
              <section>
                <h3 className="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-2">
                  {t('campaignPage.executionSheet.toImport', { count })}
                </h3>
                {count === 0 ? (
                  <p className="text-xs text-ink-3">{t('campaignPage.executionSheet.nothingToImport')}</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="text-ink-3 text-left">
                      <tr>
                        <th className="py-1 pr-2 font-medium">{t('campaignPage.executionSheet.colInstance')}</th>
                        <th className="py-1 pr-2 font-medium">{t('campaignPage.executionSheet.colTest')}</th>
                        <th className="py-1 pr-2 font-medium">{t('campaignPage.executionSheet.colResult')}</th>
                        <th className="py-1 pr-2 font-medium">{t('campaignPage.executionSheet.colTester')}</th>
                        <th className="py-1 pr-2 font-medium">{t('campaignPage.executionSheet.colDate')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.importable.map(inst => (
                        <tr key={inst.entryId} className="border-t border-edge align-top">
                          <td className="py-1.5 pr-2 font-mono text-ink-2 whitespace-nowrap">{inst.entryId}</td>
                          <td className="py-1.5 pr-2 text-ink">
                            {inst.title}
                            {inst.requirementId && <span className="text-ink-3 font-mono"> · {inst.requirementId}</span>}
                            {inst.previousStatus !== 'pending' && (
                              <span className="flex items-center gap-1 text-status-warning mt-0.5">
                                <AlertTriangle size={11} />
                                {t('campaignPage.executionSheet.replaces', { status: t(statusKey(inst.previousStatus)) })}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-2 whitespace-nowrap">
                            <span className={`px-1.5 py-0.5 rounded-full font-medium ${RESULT_CLS[inst.result]}`}>
                              {t(statusKey(inst.result))}
                            </span>
                            {!inst.resultForced && (
                              <span className="block text-ink-3 mt-0.5">{t('campaignPage.executionSheet.computed')}</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-2 text-ink-2">{inst.executedBy}</td>
                          <td className="py-1.5 pr-2 text-ink-2 whitespace-nowrap">{formatDate(inst.executedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              {preview.errors.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-status-danger uppercase tracking-wide mb-2">
                    {t('campaignPage.executionSheet.inError', { count: preview.errors.length })}
                  </h3>
                  <ul className="space-y-1 text-xs">
                    {preview.errors.map(({ entryId, error: err }) => (
                      <li key={entryId}>
                        <span className="font-mono text-ink-2">{entryId}</span>
                        <span className="text-ink-2"> — {instanceErrorMessage(t, err)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {preview.warnings.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-status-warning uppercase tracking-wide mb-2">
                    {t('campaignPage.executionSheet.warnings')}
                  </h3>
                  <ul className="space-y-1 text-xs text-ink-2">
                    {preview.warnings.map(w => (
                      <li key={w.row}>{t('campaignPage.executionSheet.rowWithoutKey', { row: w.row })}</li>
                    ))}
                  </ul>
                </section>
              )}

              {preview.unfilledCount > 0 && (
                <p className="text-xs text-ink-3">{t('campaignPage.executionSheet.unfilled', { count: preview.unfilledCount })}</p>
              )}
            </>
          )}
          {error && <p className="text-xs text-status-danger">{error}</p>}
        </div>

        <div className="flex justify-end gap-2">
          {result || preview.fatal ? (
            <button type="button" onClick={onClose} className="btn-primary">{t('common.close')}</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={applyMutation.isPending} className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button type="button" onClick={confirm} disabled={!canApply} className="btn-primary">
                {applyMutation.isPending
                  ? t('campaignPage.executionSheet.importing')
                  : t('campaignPage.executionSheet.importN', { count })}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ResultSummary({ result, previewCount }: { result: ExecutionImportResult; previewCount: number }) {
  const { t } = useTranslation()
  const { imported, failure, preview } = result
  return (
    <div className="space-y-2 text-sm">
      {preview.fatal ? (
        <p className="text-status-danger">{fatalMessage(t, preview.fatal)}</p>
      ) : (
        <p className="text-ink">{t('campaignPage.executionSheet.imported', { count: imported.length })}</p>
      )}
      {!preview.fatal && preview.importable.length !== previewCount && (
        <p className="text-xs text-status-warning">{t('campaignPage.executionSheet.changedSincePreview')}</p>
      )}
      {failure && (
        <p className="text-xs text-status-danger">
          {t('campaignPage.executionSheet.failure', { entryId: failure.entryId, message: failure.message })}
        </p>
      )}
    </div>
  )
}

type T = ReturnType<typeof useTranslation>['t']

function fatalMessage(t: T, fatal: ExecutionImportFatal): string {
  switch (fatal.code) {
    case 'unreadable': return t('campaignPage.executionSheet.fatal.unreadable')
    case 'not_an_execution_sheet': return t('campaignPage.executionSheet.fatal.notAnExecutionSheet')
    case 'unsupported_version': return t('campaignPage.executionSheet.fatal.unsupportedVersion', { version: fatal.version })
    case 'wrong_campaign': return t('campaignPage.executionSheet.fatal.wrongCampaign', { campaignId: fatal.fileCampaignId })
    case 'campaign_closed': return t('campaignPage.executionSheet.fatal.campaignClosed')
  }
}

function instanceErrorMessage(t: T, err: ExecutionImportInstanceError): string {
  switch (err.code) {
    case 'entry_not_found': return t('campaignPage.executionSheet.error.entryNotFound')
    case 'test_not_found': return t('campaignPage.executionSheet.error.testNotFound', { testCaseId: err.testCaseId })
    case 'steps_mismatch': return t('campaignPage.executionSheet.error.stepsMismatch', {
      expected: err.expected.join(', ') || '—', found: err.found.join(', ') || '—',
    })
    case 'invalid_verdict': return t('campaignPage.executionSheet.error.invalidVerdict', { row: err.row, value: err.value })
    case 'invalid_date': return t('campaignPage.executionSheet.error.invalidDate', { row: err.row, value: err.value })
  }
}
