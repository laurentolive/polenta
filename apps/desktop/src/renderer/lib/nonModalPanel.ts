import { useEffect, useRef, type RefObject } from 'react'

// GH465 — panneau de colonnes non modal : la vue derrière reste utilisable tant qu'il est ouvert.
//
// Le panneau n'est plus un fond plein écran (`backdropDismiss`) : sans fond recouvrant la vue, ses
// barres de défilement et sa molette lui reviennent. Hors du panneau, un clic franc (bouton principal,
// appui et relâchement hors du panneau) le ferme et n'atteint pas la vue, comme le faisait le fond.
// Un appui sur une barre de défilement n'est jamais un clic « hors panneau » : la vue le gère.

/** Vrai si l'appui tombe sur la barre de défilement d'un élément (ou de la fenêtre), pas sur son contenu. */
export function isScrollbarPress(e: MouseEvent): boolean {
  const target = e.target
  if (!(target instanceof HTMLElement)) return false
  if (target === document.documentElement) {
    return e.clientX >= target.clientWidth || e.clientY >= target.clientHeight
  }
  const style = getComputedStyle(target)
  const rect = target.getBoundingClientRect()
  const hasVertical = /auto|scroll/.test(style.overflowY) && target.scrollHeight > target.clientHeight
  const hasHorizontal = /auto|scroll/.test(style.overflowX) && target.scrollWidth > target.clientWidth
  if (hasVertical && e.clientX >= rect.left + target.clientLeft + target.clientWidth && e.clientX < rect.right) return true
  return hasHorizontal && e.clientY >= rect.top + target.clientTop + target.clientHeight && e.clientY < rect.bottom
}

interface Press { down: EventTarget | null; up: EventTarget | null }

/** Ferme `onDismiss` sur un clic franc hors de `panelRef`. L'appui et le clic qui ferment ne vont pas à
 *  la vue. Un geste commencé dans le panneau, ou un appui sur une barre de défilement, est laissé tel quel. */
export function useNonModalDismiss(panelRef: RefObject<HTMLElement | null>, onDismiss: () => void): void {
  const dismissRef = useRef(onDismiss)
  const pressRef = useRef<Press | null>(null)
  useEffect(() => { dismissRef.current = onDismiss }, [onDismiss])

  useEffect(() => {
    const outside = (node: EventTarget | null) => !(node instanceof Node && panelRef.current?.contains(node))

    const onDown = (e: MouseEvent) => {
      pressRef.current = null
      if (e.button !== 0 || !outside(e.target) || isScrollbarPress(e)) return
      pressRef.current = { down: e.target, up: null }
      e.stopPropagation()
      e.preventDefault()
    }
    const onUp = (e: MouseEvent) => {
      if (pressRef.current) pressRef.current.up = e.target
    }
    const onClick = (e: MouseEvent) => {
      const press = pressRef.current
      pressRef.current = null
      if (!press || press.up === null) return
      e.stopPropagation()
      e.preventDefault()
      if (outside(press.down) && outside(press.up)) dismissRef.current()
    }

    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('mouseup', onUp, true)
    window.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mouseup', onUp, true)
      window.removeEventListener('click', onClick, true)
    }
  }, [panelRef])
}
