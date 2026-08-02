import { useTranslation } from 'react-i18next'
import { useTabs } from '../../contexts/TabsContext'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

/** Same modal shell as schema.tsx's CancelConfirmModal (objectTypeEditor.tsx) — deliberately
 *  generic, it only knows "this tab is registered dirty", never which view is showing. Escape
 *  closes it same as every other popup in the app (PublishPopover, CancelConfirmModal) — schema.tsx
 *  guards its own Escape-driven CancelConfirmModal against pendingCloseId so the two never stack. */
export function ConfirmCloseTabModal() {
  const { t } = useTranslation()
  const { pendingCloseId, cancelCloseTab, confirmCloseTab } = useTabs()

  useModalHotkeys(cancelCloseTab, confirmCloseTab, !pendingCloseId)

  if (!pendingCloseId) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={cancelCloseTab}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-ink mb-2">{t('layout.confirmCloseTab.title')}</h2>
        <p className="text-xs text-ink-2 mb-5">{t('layout.confirmCloseTab.message')}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={cancelCloseTab}
            className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={confirmCloseTab} autoFocus
            className="btn-danger">
            {t('layout.confirmCloseTab.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
