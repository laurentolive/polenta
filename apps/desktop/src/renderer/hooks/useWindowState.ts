import { useEffect } from 'react'
import { api } from '../api'
import { useTabs } from '../contexts/TabsContext'
import { hrefOf } from '../lib/tabHistory'
import { isWeb } from '../platform'

/**
 * GH342 — remonte au main l'état de la fenêtre : la page de l'onglet actif (rouverte au lancement
 * suivant) et la présence d'onglets non sauvegardés (garde de fermeture de la fenêtre ; web :
 * `beforeunload`). Sans délai : la disposition est enregistrée à la fermeture, une navigation faite
 * juste avant ne doit pas être perdue (les changements de page sont rares, l'appel est léger).
 */
export function useWindowState(): void {
  const { activeTab, dirtyTabIds } = useTabs()
  const route = hrefOf(activeTab)
  const dirty = dirtyTabIds.size > 0

  useEffect(() => {
    void api.app.setWindowState({ route }).catch(() => {})
  }, [route])

  // Desktop : la garde de fermeture est décidée dans le renderer (WindowCloseGuard), le main n'en a
  // pas besoin ; web : `beforeunload`.
  useEffect(() => {
    if (isWeb) void api.app.setWindowState({ dirty }).catch(() => {})
  }, [dirty])
}
