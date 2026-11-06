import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useJobFollow } from '../../hooks/useAdmin'
import { useLaunch } from '../admin/useLaunch'

/**
 * GH305 — popover W2 de l'administrateur (client web) : mise à jour du client web de son instance
 * vers la release détectée, en un clic confirmé (travail `web.update` du service d'administration).
 * Le travail est suivi par son identifiant, gardé par `UpdateBadge` : fermer le popover ne le perd
 * pas. Pendant le redémarrage du serveur, le suivi se reconnecte ; W1 propose ensuite « Recharger ».
 */
export function WebReleaseUpdate({
  version,
  instance,
  dirtyTabs,
  jobId,
  onLaunched,
}: {
  version: string
  instance: string
  dirtyTabs: number
  jobId: string | null
  onLaunched: (jobId: string | null) => void
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const { error, launch } = useLaunch()

  if (jobId) return <WebUpdateProgress jobId={jobId} onRetry={() => onLaunched(null)} />

  async function run() {
    setConfirming(false)
    const id = await launch({ operation: 'web.update', instance, params: { version }, confirm: true })
    if (id) onLaunched(id)
  }

  return (
    <div className="mb-3">
      {error && <p className="text-xs text-status-danger mb-2" role="alert">{error}</p>}
      {confirming ? (
        <div className="text-xs text-ink-2" data-testid="web-update-confirm">
          <p className="mb-2">{t('update.popover.webUpdateConfirm', { instance, version })}</p>
          {dirtyTabs > 0 && <p className="text-status-warning mb-2">{t('update.popover.dirtyReloadWarning')}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
            <button type="button" className="btn-primary" onClick={() => void run()}>{t('update.popover.webUpdateRun')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-primary w-full" onClick={() => setConfirming(true)}>
          {t('update.popover.webUpdate', { version })}
        </button>
      )}
    </div>
  )
}

/** Suivi du travail ; affiché aussi dans la vue « Recharger » (le serveur a redémarré avant la fin du travail). */
export function WebUpdateProgress({ jobId, onRetry }: { jobId: string; onRetry?: () => void }) {
  const { t } = useTranslation()
  const { job, disconnected } = useJobFollow(jobId)
  const state = job?.state ?? 'running'
  const running = ['queued', 'running'].includes(state)
  return (
    <div className="text-xs mb-3" data-testid="web-update-progress" data-job-state={state}>
      {running && (
        <p className="text-ink-2">
          {t('update.popover.webUpdateRunning')}
          {disconnected && <span className="block text-status-warning mt-1">{t('update.popover.webUpdateRestarting')}</span>}
        </p>
      )}
      {state === 'succeeded' && <p className="text-status-success">{t('update.popover.webUpdateDone')}</p>}
      {!running && state !== 'succeeded' && (
        <>
          <p className="text-status-danger" role="alert">{t('update.popover.webUpdateFailed', { message: job?.error?.message ?? state })}</p>
          {onRetry && <button type="button" className="btn-secondary-sm mt-2" onClick={onRetry}>{t('update.popover.retry')}</button>}
        </>
      )}
    </div>
  )
}
