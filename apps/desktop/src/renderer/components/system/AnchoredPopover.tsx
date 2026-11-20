import { useRef, type HTMLAttributes } from 'react'
import { useAnchoredTop } from '../../hooks/useAnchoredTop'

/**
 * GH401 — conteneur `fixed` d'un popover ouvert sous une ancre (ligne de liens de la vue document,
 * cellule de lien de la vue Excel) : sous l'ancre, ou au-dessus s'il n'y a pas la place
 * (`useAnchoredTop`). `top` = bas de l'ancre + écart, `anchorTop` = haut de l'ancre.
 */
export function AnchoredPopover({ top, anchorTop, left, width, style, ...rest }: HTMLAttributes<HTMLDivElement> & {
  top: number
  anchorTop: number
  left: number
  width: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const placedTop = useAnchoredTop(ref, top, anchorTop)
  return <div ref={ref} {...rest} style={{ ...style, top: placedTop, left, width }} />
}
