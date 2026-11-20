import { useLayoutEffect, useState, type RefObject } from 'react'

const MARGIN = 8 // distance minimale au bord de la fenêtre

/**
 * Position d'un menu contextuel `fixed` ouvert au point (x, y) du clic, ramenée dans la fenêtre :
 * un menu ouvert près du bas (ou de la droite) de l'écran décalé vers le haut (ou la gauche) pour
 * que toutes ses entrées restent atteignables. Un menu `fixed` ne défile pas : sa partie hors de la
 * fenêtre serait inaccessible (ex. « Supprimer » coupé en bas du panneau latéral).
 */
export function clampMenuPosition(
  x: number, y: number, width: number, height: number,
  viewportWidth: number, viewportHeight: number,
): { left: number; top: number } {
  const maxLeft = viewportWidth - width - MARGIN
  const maxTop = viewportHeight - height - MARGIN
  return {
    left: Math.max(MARGIN, Math.min(x, maxLeft)),
    top: Math.max(MARGIN, Math.min(y, maxTop)),
  }
}

/**
 * {@link clampMenuPosition} appliqué au menu rendu (`ref`) : mesuré après le rendu, avant
 * l'affichage (`useLayoutEffect`), recalculé au redimensionnement de la fenêtre ou du menu.
 */
export function useMenuPosition(ref: RefObject<HTMLElement | null>, x: number, y: number): { left: number; top: number } {
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const next = clampMenuPosition(x, y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight)
      setPos(prev => (prev.left === next.left && prev.top === next.top ? prev : next))
    }
    update()
    window.addEventListener('resize', update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(el)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [ref, x, y])
  return pos
}
