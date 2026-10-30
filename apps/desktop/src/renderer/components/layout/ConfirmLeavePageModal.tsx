import { useTranslation } from 'react-i18next'
import { useTabs } from '../../contexts/TabsContext'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

/** GH228 — Précédent / Suivant sur un onglet dirty. Même coque que ConfirmCloseTabModal ;
 *  Échap = Rester, Entrée = Quitter sans enregistrer. */
export function ConfirmLeavePageModal() {
  const { t } = useTranslation()
  const { pendingHistoryIndex, cancelHistoryNav, confirmHistoryNav } = useTabs()

  useModalHotkeys(cancelHistoryNav, confirmHistoryNav, pendingHistoryIndex === null)

  if (pendingHistoryIndex === null) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={cancelHistoryNav}>
      <div role="dialog" aria-modal="true" className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-ink mb-2">{t('layout.confirmLeavePage.title')}</h2>
        <p className="text-xs text-ink-2 mb-5">{t('layout.confirmLeavePage.message')}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={cancelHistoryNav} className="btn-secondary">
            {t('layout.confirmLeavePage.stay')}
          </button>
          <button type="button" onClick={confirmHistoryNav} autoFocus className="btn-danger">
            {t('layout.confirmLeavePage.leave')}
          </button>
        </div>
      </div>
    </div>
  )
}
