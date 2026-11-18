/** GH405 — passage à l'onglet voisin au clavier (desktop), dans l'ordre visuel de la barre. */

type CycleKeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/** +1 onglet suivant, -1 précédent, `null` : pas un raccourci de changement d'onglet.
 *  Ctrl+Tab / Ctrl+PageDown → suivant, Ctrl+Shift+Tab / Ctrl+PageUp → précédent ; `Ctrl` sur toutes
 *  les plateformes (convention des navigateurs, macOS compris). Ctrl+Shift+PageUp/PageDown est
 *  laissé libre (déplacement d'onglet dans les navigateurs, hors scope). */
export function tabCycleDirection(e: CycleKeyEvent): 1 | -1 | null {
  if (!e.ctrlKey || e.metaKey || e.altKey) return null
  if (e.key === 'Tab') return e.shiftKey ? -1 : 1
  if (e.shiftKey) return null
  if (e.key === 'PageDown') return 1
  if (e.key === 'PageUp') return -1
  return null
}

/** Id de l'onglet voisin de `activeId` dans `tabs`, en boucle ; `null` s'il n'y a pas d'autre
 *  onglet ou si `activeId` est inconnu. */
export function cycleTabId(tabs: readonly { id: string }[], activeId: string, delta: 1 | -1): string | null {
  if (tabs.length < 2) return null
  const index = tabs.findIndex(tab => tab.id === activeId)
  if (index < 0) return null
  return tabs[(index + delta + tabs.length) % tabs.length].id
}
