import { useEffect } from 'react'
import { api } from '../api'
import { useTabs } from '../contexts/TabsContext'
import { hrefOf } from '../lib/tabHistory'
import { isWeb } from '../platform'

/** Global Ctrl+T (new tab) / Ctrl+W (close active tab) — mirrors Firefox/VS Code. Ctrl+W used to
 *  be the Electron "Fermer le projet" accelerator (menu.ts); that accelerator was removed so this
 *  is now the only handler for it. GH342 — Ctrl+Shift+N (desktop) : nouvelle fenêtre sur la page
 *  de l'onglet actif ; dans un navigateur ce raccourci appartient au navigateur (navigation privée). */
export function useTabShortcuts(): void {
  const { activeTabId, activeTab, pendingCloseId, openTab, attemptCloseTab } = useTabs()
  const activeHref = hrefOf(activeTab)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // GH44 — dans un navigateur, Ctrl+T / Ctrl+W ouvrent/ferment un onglet du navigateur avant
      // d'arriver à la page : la version web utilise Alt+T / Alt+W.
      const modifier = isWeb ? e.altKey && !e.ctrlKey && !e.metaKey : e.ctrlKey || e.metaKey
      if (!modifier) return
      // The confirm-close popup already traps the interaction — opening a new tab or triggering
      // another close attempt underneath it would be confusing without adding any real capability
      // (ConfirmCloseTabModal's own Escape/Annuler/click-away already cover dismissing it).
      if (pendingCloseId) return

      const key = e.key.toLowerCase()
      if (!isWeb && e.shiftKey && key === 'n') {
        e.preventDefault()
        void api.app.openWindow(activeHref)
      } else if (key === 't') {
        e.preventDefault()
        openTab()
      } else if (key === 'w') {
        e.preventDefault()
        attemptCloseTab(activeTabId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTabId, activeHref, pendingCloseId, openTab, attemptCloseTab])
}
