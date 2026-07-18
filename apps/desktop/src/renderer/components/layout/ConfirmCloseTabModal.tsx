import { useEffect } from 'react'
import { useTabs } from '../../contexts/TabsContext'

/** Same modal shell as schema.tsx's CancelConfirmModal (objectTypeEditor.tsx) — deliberately
 *  generic, it only knows "this tab is registered dirty", never which view is showing. Escape
 *  closes it same as every other popup in the app (PublishPopover, CancelConfirmModal) — schema.tsx
 *  guards its own Escape-driven CancelConfirmModal against pendingCloseId so the two never stack. */
export function ConfirmCloseTabModal() {
  const { pendingCloseId, cancelCloseTab, confirmCloseTab } = useTabs()

  useEffect(() => {
    if (!pendingCloseId) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') cancelCloseTab()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pendingCloseId, cancelCloseTab])

  if (!pendingCloseId) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={cancelCloseTab}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-ink mb-2">Fermer sans enregistrer ?</h2>
        <p className="text-xs text-ink-2 mb-5">Cet onglet a des modifications non enregistrées. Elles seront perdues.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={cancelCloseTab}
            className="text-sm px-4 py-1.5 border border-edge rounded text-ink-2 hover:text-ink transition-colors">
            Annuler
          </button>
          <button type="button" onClick={confirmCloseTab} autoFocus
            className="text-sm px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white transition-colors">
            Fermer sans enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}
