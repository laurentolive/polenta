import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * GH222 — navigation d'un changement (ou d'un conflit) au suivant, comme le diff de VS Code :
 * boutons, et raccourcis `F7` / `Maj+F7`, ou `Alt+↓` / `Alt+↑` hors d'un champ éditable (dans un
 * éditeur, `Alt+↑/↓` déplace la ligne). `go(i)` fait défiler jusqu'au changement `i`. Au-delà du
 * dernier, `onPastEnd` (fichier suivant à résoudre) s'il est donné, sinon retour au premier.
 * `listKey` identifie la liste : quand elle change (conflit résolu, autre fichier), la position
 * repart de zéro — l'ancien index désignerait un autre élément. `enabled: false` : pas de
 * raccourcis (rien à parcourir, ex. fichier à choix de côté).
 */
export function useChangeNavigation(
  count: number, go: (index: number) => void, opts: { onPastEnd?: () => void; listKey?: string; enabled?: boolean } = {},
) {
  const { enabled = true } = opts
  const [index, setIndex] = useState(-1)
  const latest = useRef({ count, go, onPastEnd: opts.onPastEnd, index })
  latest.current = { count, go, onPastEnd: opts.onPastEnd, index }

  useEffect(() => { setIndex(-1) }, [count, opts.listKey])

  const moveTo = useCallback((i: number) => {
    setIndex(i)
    latest.current.go(i)
  }, [])

  const next = useCallback(() => {
    const { count: n, index: i, onPastEnd } = latest.current
    if (n === 0 || i >= n - 1) {
      if (onPastEnd) { onPastEnd(); return }
      if (n > 0) moveTo(0)
      return
    }
    moveTo(i + 1)
  }, [moveTo])

  const prev = useCallback(() => {
    const { count: n, index: i } = latest.current
    if (n === 0) return
    moveTo(i <= 0 ? n - 1 : i - 1)
  }, [moveTo])

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F7') {
        e.preventDefault()
        if (e.shiftKey) prev()
        else next()
        return
      }
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isEditable(e.target)) {
        e.preventDefault()
        if (e.key === 'ArrowDown') next()
        else prev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, enabled])

  return { index, next, prev, moveTo }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}
