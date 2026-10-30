/**
 * GH222 — historique de la sortie d'un fichier en résolution (Ctrl+Z / Ctrl+Y), commun aux vues
 * Raw et Rendu : chaque choix (prendre gauche, droite, les deux, l'ancêtre, réinitialiser, tout à
 * gauche…) est une étape ; une frappe continue dans un même champ (même `group`, moins de
 * `GROUP_MS` d'écart) ne fait qu'une étape.
 */

export interface OutputHistory {
  past: string[]
  future: string[]
  /** Group of the last recorded step, and when it was recorded (ms). */
  group?: string
  at: number
}

export const GROUP_MS = 1000
const LIMIT = 200

export const emptyHistory = (): OutputHistory => ({ past: [], future: [], at: 0 })

/** Records `previous` (the text being left) before a new text; clears what could be redone. */
export function record(h: OutputHistory, previous: string, group: string | undefined, now: number): OutputHistory {
  if (group !== undefined && h.group === group && now - h.at < GROUP_MS && h.past.length > 0) {
    return { ...h, future: [], at: now }
  }
  return { past: [...h.past, previous].slice(-LIMIT), future: [], group, at: now }
}

export function undo(h: OutputHistory, current: string): { history: OutputHistory; text: string } | null {
  if (h.past.length === 0) return null
  return { history: { past: h.past.slice(0, -1), future: [...h.future, current], at: 0 }, text: h.past[h.past.length - 1] }
}

export function redo(h: OutputHistory, current: string): { history: OutputHistory; text: string } | null {
  if (h.future.length === 0) return null
  return { history: { past: [...h.past, current], future: h.future.slice(0, -1), at: 0 }, text: h.future[h.future.length - 1] }
}

/** Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (⌘ on macOS). */
export function historyKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const k = e.key.toLowerCase()
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (k === 'y' && !e.shiftKey) return 'redo'
  return null
}
