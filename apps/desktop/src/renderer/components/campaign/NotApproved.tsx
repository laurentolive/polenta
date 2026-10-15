import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { ProjectSchema, TestCase } from '@polenta/types'
import { testStatusLabel } from '../../hooks/useProjectSchema'

/** GH68 — pastille « Non approuvé » d'un test (infobulle : son statut). Liste d'une campagne,
 *  onglet « Depuis une campagne » du sélecteur. */
export function NotApprovedBadge({ test, schema }: { test: TestCase; schema: ProjectSchema | undefined }) {
  const { t } = useTranslation()
  return (
    <span
      className="ml-2 inline-flex items-center gap-0.5 text-[10px] text-status-warning"
      title={t('campaignPage.notApprovedTooltip', { status: testStatusLabel(test, schema) })}
    >
      <AlertTriangle size={11} />{t('campaignPage.notApproved')}
    </span>
  )
}

/** GH68 — bandeau de la page campagne : instances à exécuter portant sur des tests non approuvés. */
export function NotApprovedRunsBanner({ count }: { count: number }) {
  const { t } = useTranslation()
  if (count === 0) return null
  return (
    <div className="mb-3 rounded border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs text-status-warning">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle size={13} />
        {t('campaignPage.notApprovedBanner', { count })}
      </p>
    </div>
  )
}
