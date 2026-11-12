import { useTranslation } from 'react-i18next'

interface Props {
  /** Libellés des champs modifiés ailleurs pendant la saisie. */
  labels: string[]
  onReload: () => void
  onKeep: () => void
}

/**
 * GH342 — un champ en cours de saisie a été modifié ailleurs (autre fenêtre, autre onglet, pull,
 * MCP…) : recharger la valeur extérieure, ou garder la saisie (l'enregistrement l'écrasera).
 */
export function ExternalChangeBanner({ labels, onReload, onKeep }: Props) {
  const { t } = useTranslation()
  if (labels.length === 0) return null
  return (
    <div
      role="alert"
      data-testid="external-change-banner"
      className="flex flex-wrap items-center gap-2 rounded border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs text-status-warning"
    >
      <span className="flex-1 min-w-0">{t('externalChange.message', { fields: labels.join(', ') })}</span>
      <button type="button" className="btn-secondary btn-sm" onClick={onReload}>{t('externalChange.reload')}</button>
      <button type="button" className="btn-secondary btn-sm" onClick={onKeep}>{t('externalChange.keep')}</button>
    </div>
  )
}
