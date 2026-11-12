import { useEffect } from 'react'
import { api } from '../api'
import { useTabs } from '../contexts/TabsContext'
import { hrefOf } from '../lib/tabHistory'

const ROUTE_DEBOUNCE_MS = 300

/**
 * GH342 — remonte au main l'état de la fenêtre : la page de l'onglet actif (rouverte au lancement
 * suivant) et la présence d'onglets non sauvegardés (garde de fermeture de la fenêtre ; web :
 * `beforeunload`).
 */
export function useWindowState(): void {
  const { activeTab, dirtyTabIds } = useTabs()
  const route = hrefOf(activeTab)
  const dirty = dirtyTabIds.size > 0

  useEffect(() => {
    const id = setTimeout(() => { void api.app.setWindowState({ route }).catch(() => {}) }, ROUTE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [route])

  useEffect(() => {
    void api.app.setWindowState({ dirty }).catch(() => {})
  }, [dirty])
}
