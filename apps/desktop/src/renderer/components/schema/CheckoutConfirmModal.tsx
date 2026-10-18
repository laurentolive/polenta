import { Trans, useTranslation } from 'react-i18next'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

/** Pending changes before a checkout to `value` (T86) — extracted from `RepoBranchSelector` (GH106)
 *  so the Structure tab's integration-branch menu asks the same question before designating a
 *  branch that isn't checked out. Escape cancels, Enter confirms (unless `disabled`). */
export function CheckoutConfirmModal({ value, onCancel, onConfirm, disabled = false }: {
  value: string
  onCancel: () => void
  onConfirm: () => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  useModalHotkeys(onCancel, onConfirm, disabled)
  return (
    <div className="fixed inset-0 bg-overlay/50 flex items-center justify-center z-20" onClick={e => e.stopPropagation()}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl p-5 w-full max-w-sm mx-4">
        <h2 className="font-semibold text-sm text-ink mb-2">{t('schema.repoBranchSelector.changeBranchTitle')}</h2>
        <p className="text-xs text-ink-2 mb-4">
          <Trans
            i18nKey="schema.repoBranchSelector.changeBranchBody"
            values={{ value }}
            components={{ mono: <span className="font-mono font-medium" /> }}
          />
        </p>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="btn-secondary-sm">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={onConfirm} disabled={disabled} className="btn-danger-sm">
            {t('schema.repoBranchSelector.forceCheckout')}
          </button>
        </div>
      </div>
    </div>
  )
}
