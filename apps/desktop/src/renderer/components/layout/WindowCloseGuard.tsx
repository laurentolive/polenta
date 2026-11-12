import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { useOptionalTabs } from '../../contexts/TabsContext'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { flushPendingEdits } from '../../lib/pendingEdits'

const NO_DIRTY: ReadonlySet<string> = new Set()

/**
 * GH342 — fermeture de la fenêtre (desktop) : le main la retient et envoie 'app:close-requested'.
 * Les saisies en attente sont d'abord enregistrées (champ actif, enregistrements temporisés) ; s'il
 * reste des onglets non sauvegardés, confirmation — sinon la fenêtre se ferme.
 */
export function WindowCloseGuard() {
  const { t } = useTranslation()
  // Hors onglets (`/login`) : rien à protéger, la fenêtre se ferme après le vidage des saisies.
  const tabsCtx = useOptionalTabs()
  const tabs = tabsCtx?.tabs ?? []
  const dirtyTabIds = tabsCtx?.dirtyTabIds ?? NO_DIRTY
  const [asking, setAsking] = useState(false)
  const dirtyRef = useRef(dirtyTabIds)
  dirtyRef.current = dirtyTabIds
  const busy = useRef(false)

  useEffect(() => window.polenta.on('app:close-requested', () => {
    void api.app.closeWindow('ack')
    if (busy.current) return
    busy.current = true
    void flushPendingEdits().then(() => {
      if (dirtyRef.current.size > 0) {
        setAsking(true)
      } else {
        busy.current = false
        void api.app.closeWindow('close')
      }
    })
  }), [])

  const cancel = () => {
    setAsking(false)
    busy.current = false
    void api.app.closeWindow('cancel')
  }
  const confirm = () => {
    setAsking(false)
    busy.current = false
    void api.app.closeWindow('close')
  }

  useModalHotkeys(cancel, confirm, !asking)

  if (!asking) return null

  const dirtyTitles = tabs.filter(tab => dirtyTabIds.has(tab.id)).map(tab => tab.title)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" onClick={cancel} data-testid="window-close-guard">
      <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-ink mb-2">{t('layout.windowClose.title')}</h2>
        <p className="text-xs text-ink-2 mb-2">{t('layout.windowClose.message')}</p>
        <ul className="text-xs text-ink mb-5 list-disc pl-5">
          {dirtyTitles.map((title, i) => <li key={i} className="truncate">{title}</li>)}
        </ul>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={cancel} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={confirm} autoFocus className="btn-danger">
            {t('layout.windowClose.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
