import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAdminMe, useRunningJob } from '../../hooks/useAdmin'

/**
 * GH63 — bandeau global « opération en cours sur le serveur » (interface ou SSH), visible des
 * propriétaires depuis n'importe quelle vue de la version web. Rien sur le desktop.
 */
export function JobBanner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { me } = useAdminMe()
  const job = useRunningJob(!!me)
  if (!me || !job) return null
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 px-4 py-1.5 text-xs bg-status-warning-bg text-status-warning-fg border-b border-edge" data-testid="admin-job-banner">
      <span>
        {t('admin.banner.running', {
          operation: t(`admin.op.${job.operation}`, { defaultValue: job.operation }),
          actor: job.actor.login,
          origin: job.origin,
        })}
      </span>
      <button type="button" className="underline" onClick={() => void navigate({ to: '/admin' })}>{t('admin.banner.open')}</button>
    </div>
  )
}
