import { useLayoutEffect, useState, type RefObject } from 'react'

const MARGIN = 8 // distance minimale au bord de la fenêtre
const GAP = 4 // écart entre l'ancre et le popover ouvert au-dessus

/**
 * GH401 — `top` d'un popover `fixed` ouvert sous une ancre (ligne de liens, cellule) : sous
 * l'ancre s'il y tient, au-dessus sinon, et à défaut collé au bas de la fenêtre — jamais hors
 * de la fenêtre. Un popover `fixed` ne défile pas : ouvert près du bas de l'écran, sa partie
 * hors de la fenêtre resterait inatteignable.
 *
 * `below` : position voulue sous l'ancre (bas de l'ancre + écart) ; `anchorTop` : haut de l'ancre.
 */
export function anchoredTop(height: number, below: number, anchorTop: number, viewportHeight: number): number {
  if (below + height + MARGIN <= viewportHeight) return below
  const above = anchorTop - GAP - height
  if (above >= MARGIN) return above
  return Math.max(MARGIN, viewportHeight - height - MARGIN)
}

/** {@link anchoredTop} appliqué au popover rendu (`ref`), recalculé quand sa hauteur ou celle de la fenêtre change. */
export function useAnchoredTop(ref: RefObject<HTMLElement | null>, below: number, anchorTop: number = below): number {
  const [top, setTop] = useState(below)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setTop(anchoredTop(el.offsetHeight, below, anchorTop, window.innerHeight))
    update()
    window.addEventListener('resize', update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(el)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [ref, below, anchorTop])
  return top
}
