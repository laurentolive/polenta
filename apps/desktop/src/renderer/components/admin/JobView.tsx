import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobView as Job } from '@polenta/types'
import { adminApi } from '../../lib/adminApi'
import { useJobFollow } from '../../hooks/useAdmin'
import { OneTimeSecret } from './OneTimeSecret'

const STATE_CLASS: Record<string, string> = {
  succeeded: 'text-status-success',
  failed: 'text-status-danger',
  'rolled-back': 'text-status-warning',
  cancelled: 'text-ink-3',
  interrupted: 'text-status-warning',
}

/** GH63 — suivi d'un travail : état, étapes, journal (`aria-live`), annulation, valeur à usage unique. */
export function JobView({ jobId, onEnd, onClose }: { jobId: string; onEnd?: (job: Job) => void; onClose?: () => void }) {
  const { t } = useTranslation()
  const { job, lines, disconnected } = useJobFollow(jobId, onEnd)
  const [secret, setSecret] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function revealSecret() {
    try {
      setSecret((await adminApi.secret(jobId)).secret)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="border border-edge rounded-lg bg-surface" aria-label={t('admin.job.title')} data-testid="admin-job">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-edge">
        <span className="text-sm font-medium text-ink">{job ? t(`admin.op.${job.operation}`, { defaultValue: job.operation }) : t('common.loading')}</span>
        {job && job.instance && <span className="text-xs font-mono text-ink-3">{job.instance}</span>}
        {job && (
          <span className={`text-xs font-medium ${STATE_CLASS[job.state] ?? 'text-prim'}`} data-testid="admin-job-state">
            {t(`admin.state.${job.state}`)}
          </span>
        )}
        {disconnected && <span className="text-xs text-status-warning">{t('admin.job.reconnecting')}</span>}
        <span className="flex-1" />
        {job?.cancellable && job.state === 'running' && (
          <button type="button" className="btn-secondary-sm" onClick={() => void adminApi.cancel(jobId).catch(e => setError(String(e.message ?? e)))}>
            {t('admin.job.cancel')}
          </button>
        )}
        {onClose && job && !['running', 'queued', 'rebooting'].includes(job.state) && (
          <button type="button" className="btn-secondary-sm" onClick={onClose}>{t('common.close')}</button>
        )}
      </header>
      {job && job.steps.length > 0 && (
        <ol className="flex flex-wrap gap-3 px-4 py-2 text-xs text-ink-2">
          {job.steps.map(s => (
            <li key={s.name} className={s.state === 'done' ? 'text-status-success' : s.state === 'failed' ? 'text-status-danger' : s.state === 'running' ? 'text-prim' : ''}>
              {s.name}
            </li>
          ))}
        </ol>
      )}
      <pre className="max-h-64 overflow-auto px-4 py-2 text-xs font-mono text-ink-2 whitespace-pre-wrap" aria-live="polite" data-testid="admin-job-log">
        {lines.join('\n')}
      </pre>
      {job?.error && <p className="px-4 pb-2 text-sm text-status-danger" role="alert">{job.error.message}</p>}
      {job?.state === 'rebooting' && <p className="px-4 pb-2 text-sm text-ink-2">{t('admin.job.rebooting')}</p>}
      {job?.state === 'succeeded' && job.result && job.result.oneTime !== true && (
        <details className="px-4 pb-3 text-xs">
          <summary className="cursor-pointer text-ink-2">{t('admin.job.result')}</summary>
          <pre className="mt-1 max-h-64 overflow-auto font-mono text-ink-2 whitespace-pre-wrap">{typeof job.result.text === 'string' ? job.result.text : JSON.stringify(job.result, null, 2)}</pre>
        </details>
      )}
      {job?.result?.oneTime === true && !secret && (
        <div className="px-4 pb-3">
          <button type="button" className="btn-primary-sm" onClick={revealSecret}>{t('admin.job.revealSecret')}</button>
          <p className="text-xs text-ink-3 mt-1">{t('admin.job.secretOnce')}</p>
        </div>
      )}
      {secret && <OneTimeSecret secret={secret} jobResult={job?.result} fileName={`${job?.operation ?? 'secret'}-${jobId}`} />}
      {error && <p className="px-4 pb-2 text-sm text-status-danger" role="alert">{error}</p>}
    </section>
  )
}
