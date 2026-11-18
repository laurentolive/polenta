import { useEffect, useLayoutEffect, useRef } from 'react'
import { api } from '../api'
import { useTabs } from '../contexts/TabsContext'
import { modalOpen } from '../lib/modalOpen'
import { cycleTabId, tabCycleDirection } from '../lib/tabCycle'
import { hrefOf } from '../lib/tabHistory'
import { isWeb } from '../platform'

/** Global Ctrl+T (new tab) / Ctrl+W (close active tab) — mirrors Firefox/VS Code. Ctrl+W used to
 *  be the Electron "Fermer le projet" accelerator (menu.ts); that accelerator was removed so this
 *  is now the only handler for it. GH342 — Ctrl+Shift+N (desktop) : nouvelle fenêtre sur la page
 *  de l'onglet actif ; dans un navigateur ce raccourci appartient au navigateur (navigation privée).
 *  GH405 — Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+PageDown / Ctrl+PageUp (desktop) : onglet voisin. */
export function useTabShortcuts(): void {
  const tabsContext = useTabs()
  // GH405 — état lu par ref, mis à jour à chaque commit : les écouteurs restent enregistrés une
  // fois et voient toujours l'onglet actif courant (répétition rapide de la touche comprise).
  const latest = useRef(tabsContext)
  useLayoutEffect(() => { latest.current = tabsContext })

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // GH44 — dans un navigateur, Ctrl+T / Ctrl+W ouvrent/ferment un onglet du navigateur avant
      // d'arriver à la page : la version web utilise Alt+T / Alt+W.
      const modifier = isWeb ? e.altKey && !e.ctrlKey && !e.metaKey : e.ctrlKey || e.metaKey
      if (!modifier) return
      const { activeTabId, activeTab, pendingCloseId, pendingLeave, attemptOpenTab, attemptCloseTab } = latest.current
      // The confirm-close / leave popups already trap the interaction — opening a new tab or
      // triggering another close attempt underneath them would be confusing without adding any
      // real capability (their own Escape/Annuler/click-away already cover dismissing them).
      if (pendingCloseId || pendingLeave) return

      const key = e.key.toLowerCase()
      if (!isWeb && e.shiftKey && key === 'n') {
        e.preventDefault()
        void api.app.openWindow(hrefOf(activeTab))
      } else if (key === 't') {
        e.preventDefault()
        attemptOpenTab()
      } else if (key === 'w') {
        e.preventDefault()
        attemptCloseTab(activeTabId)
      }
    }

    // Phase de capture sur `window` : passe avant les écouteurs du champ qui a le focus (richtext,
    // CodeMirror, grille, xterm), qui ne voient jamais la touche — le raccourci agit partout.
    // Desktop seulement : le navigateur garde Ctrl+Tab / Ctrl+PageUp/PageDown pour ses onglets.
    function onKeyDownCapture(e: KeyboardEvent) {
      const delta = tabCycleDirection(e)
      if (delta === null) return
      const { tabs, activeTabId, pendingCloseId, pendingLeave, attemptActivateTab } = latest.current
      if (pendingCloseId || pendingLeave || modalOpen()) return
      e.preventDefault()
      e.stopPropagation()
      const target = cycleTabId(tabs, activeTabId, delta)
      if (target) attemptActivateTab(target)
    }

    window.addEventListener('keydown', onKeyDown)
    if (!isWeb) window.addEventListener('keydown', onKeyDownCapture, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keydown', onKeyDownCapture, true)
    }
  }, [])
}
