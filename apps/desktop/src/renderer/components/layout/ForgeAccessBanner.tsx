import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { ForgeAccessIssue } from '@polenta/types'
import { forgeAccessNotices } from '../../lib/forgeAccessNotices'
import { isWeb } from '../../platform'

/**
 * GH45 — bannière unique « accès révoqué » (spec §5.1) : une par hôte, quel que soit le nombre
 * d'échecs (auto-pull, Publier, chargement du workspace). Les modifications locales ne sont jamais
 * touchées ; « Se reconnecter » ouvre la connexion avec le serveur pré-rempli.
 */
export function ForgeAccessBanner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [issues, setIssues] = useState<ForgeAccessIssue[]>(forgeAccessNotices.current())

  useEffect(() => forgeAccessNotices.subscribe(setIssues), [])

  if (issues.length === 0) return null

  const reconnect = (issue: ForgeAccessIssue) => {
    // Web : la session est celle de la forge (GH44 S3) — on repasse par sa connexion.
    if (isWeb) {
      window.location.assign('/auth/login')
      return
    }
    void navigate({ to: '/login', search: { server: issue.serverUrl ?? `https://${issue.host}` } })
  }

  return (
    <div className="shrink-0 border-b border-status-warning-border bg-status-warning-bg">
      {issues.map(issue => (
        <div key={issue.host} role="alert" className="flex items-center gap-3 px-4 py-2 text-sm text-status-warning-fg">
          <span className="flex-1">{t('forgeAccess.revoked', { host: issue.host })}</span>
          <button type="button" className="btn-primary btn-sm" onClick={() => reconnect(issue)}>
            {t('forgeAccess.reconnect')}
          </button>
        </div>
      ))}
    </div>
  )
}
