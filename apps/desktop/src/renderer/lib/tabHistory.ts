/**
 * GH228 — historique Précédent / Suivant d'un onglet, comme dans un navigateur. Logique pure :
 * l'état vit dans `TabsContext`, les déclencheurs dans `useHistoryNavigation`.
 */

export interface TabHistoryEntry {
  pathname: string
  searchParams: Record<string, string>
  title: string
}

export interface TabHistory {
  history: TabHistoryEntry[]
  historyIndex: number
}

export const HISTORY_LIMIT = 50
export const HISTORY_MENU_LIMIT = 15

export function sameDestination(
  a: Pick<TabHistoryEntry, 'pathname' | 'searchParams'>,
  b: Pick<TabHistoryEntry, 'pathname' | 'searchParams'>,
): boolean {
  if (a.pathname !== b.pathname) return false
  const aKeys = Object.keys(a.searchParams)
  const bKeys = Object.keys(b.searchParams)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(key => a.searchParams[key] === b.searchParams[key])
}

/** Page affichée par l'onglet : `push` = navigation voulue par l'utilisateur (nouvelle entrée,
 *  les entrées « Suivant » sont abandonnées) ; sinon l'URL précise la page courante (filtre,
 *  redirection, retour arrière) et remplace l'entrée. Revenir sur la page courante n'ajoute rien. */
export function recordLocation(state: TabHistory, entry: TabHistoryEntry, push: boolean): TabHistory {
  const current = state.history[state.historyIndex]
  if (!current) return { history: [entry], historyIndex: 0 }
  if (!push || sameDestination(current, entry)) {
    const history = state.history.slice()
    history[state.historyIndex] = entry
    return { history, historyIndex: state.historyIndex }
  }
  const history = [...state.history.slice(0, state.historyIndex + 1), entry].slice(-HISTORY_LIMIT)
  return { history, historyIndex: history.length - 1 }
}

/** Index atteint en reculant (`delta < 0`) ou avançant de `delta` pas — `null` hors de la pile. */
export function stepHistory(state: TabHistory, delta: number): number | null {
  const index = state.historyIndex + delta
  return delta !== 0 && index >= 0 && index < state.history.length ? index : null
}

/** Entrées du menu d'historique (clic droit sur `<` / `>`), la plus proche d'abord. */
export function historyMenuEntries(state: TabHistory, direction: -1 | 1, max = HISTORY_MENU_LIMIT): { index: number; entry: TabHistoryEntry }[] {
  const result: { index: number; entry: TabHistoryEntry }[] = []
  for (let i = state.historyIndex + direction; i >= 0 && i < state.history.length && result.length < max; i += direction) {
    result.push({ index: i, entry: state.history[i] })
  }
  return result
}

export interface HistoryNavKeyEvent {
  key: string
  code?: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  defaultPrevented?: boolean
}

/** Raccourci clavier Précédent (-1) / Suivant (+1) des navigateurs, `null` sinon. Dans un champ
 *  éditable, les combinaisons qui y ont un sens d'édition (macOS : `Alt+←/→` mot par mot,
 *  `Cmd+←/→` début/fin de ligne) restent au champ ; `Alt+←/→` sous Windows / Linux et
 *  `Cmd+[` / `Cmd+]` naviguent partout, comme dans Chrome. */
export function historyNavDirection(e: HistoryNavKeyEvent, isMac: boolean, inEditable: boolean): -1 | 1 | null {
  if (e.defaultPrevented) return null
  if (e.key === 'BrowserBack') return -1
  if (e.key === 'BrowserForward') return 1
  if (e.shiftKey) return null
  const arrow = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : null
  const bracket = e.code === 'BracketLeft' || e.key === '[' ? -1 : e.code === 'BracketRight' || e.key === ']' ? 1 : null
  if (isMac) {
    if (e.ctrlKey) return null
    if (e.metaKey && !e.altKey) {
      if (bracket) return bracket
      return arrow && !inEditable ? arrow : null
    }
    if (e.altKey && !e.metaKey && arrow && !inEditable) return arrow
    return null
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey) return arrow
  return null
}
