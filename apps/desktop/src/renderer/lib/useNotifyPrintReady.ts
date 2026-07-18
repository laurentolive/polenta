import { useEffect } from 'react'
import { api } from '../api'

/** Signale à la fenêtre Electron cachée d'export PDF (`pdf.util.ts`) qu'une route imprimable a
 *  fini de charger ses données et peut être imprimée — factorisé hors des routes `print.*.tsx`
 *  (T43 sprint 2, mécanisme dupliqué à l'identique dans 4 routes en sprint 1+2). Les deux
 *  `requestAnimationFrame` imbriqués garantissent qu'au moins une frame a été peinte après le
 *  commit React avant que le main process n'appelle `printToPDF` sur cette fenêtre cachée
 *  (`show:false`, donc pas de compositeur écran qui forcerait sinon la peinture) — sans ça, un PDF
 *  peut être généré vide/tronqué sur un contenu volumineux. */
export function useNotifyPrintReady(ready: boolean): void {
  useEffect(() => {
    if (!ready) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        api.export.notifyPrintReady().catch(() => {})
      })
    })
  }, [ready])
}
