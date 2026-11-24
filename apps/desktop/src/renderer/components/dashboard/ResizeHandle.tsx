import { useEffect, useRef } from 'react'

/**
 * GH435 — poignée de redimensionnement d'une carte de widget (specs/GH435.md § 3.3) : bord droit (largeur) ou
 * bord bas (hauteur).
 *
 * - Un repère reste visible en permanence (barre discrète au milieu du bord), accentué au survol : une poignée
 *   qui n'apparaît qu'au survol ne dirait pas qu'on peut redimensionner.
 * - Le pointeur est capturé : le glissement continue hors de la poignée, et `pointerleave` ne part qu'au
 *   relâchement. `onPointerInside` sert à retirer le glisser-déposer de la carte tant que le pointeur est
 *   sur la poignée (la carte est `draggable` ; sans cela, saisir la poignée déplacerait la carte).
 * - `onLive` reçoit la taille bornée au plus une fois par frame ; `onEnd` la valeur finale au relâchement
 *   (un clic sans mouvement n'enregistre rien) ; double-clic : retour à la dimension par défaut.
 */
export interface ResizeHandleProps {
  axis: 'x' | 'y'
  label: string
  testId: string
  /** Taille affichée de la carte au début du glissement (px). */
  getStartSize: () => number
  /** Bornes du glissement (px), lues au début du glissement. */
  getBounds: () => [min: number, max: number]
  onLive: (size: number) => void
  /** `null` : glissement annulé ou sans mouvement. */
  onEnd: (size: number | null) => void
  onReset: () => void
  onPointerInside: (inside: boolean) => void
}

interface Drag {
  start: number
  origin: number
  min: number
  max: number
  latest: number
  frame: number
  moved: boolean
  userSelect: string
}

export function ResizeHandle({ axis, label, testId, getStartSize, getBounds, onLive, onEnd, onReset, onPointerInside }: ResizeHandleProps) {
  const drag = useRef<Drag | null>(null)
  // Démonté en plein glissement (widget supprimé, dashboard changé) : la sélection de texte est rendue.
  useEffect(() => () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (d.frame) cancelAnimationFrame(d.frame)
    document.body.style.userSelect = d.userSelect
  }, [])

  const coord = (e: { clientX: number; clientY: number }) => (axis === 'x' ? e.clientX : e.clientY)

  function end(commit: boolean) {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (d.frame) cancelAnimationFrame(d.frame)
    document.body.style.userSelect = d.userSelect
    onEnd(commit && d.moved ? d.latest : null)
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const [min, max] = getBounds()
    const start = getStartSize()
    drag.current = { start, origin: coord(e), min, max, latest: start, frame: 0, moved: false, userSelect: document.body.style.userSelect }
    document.body.style.userSelect = 'none'
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    d.latest = Math.min(Math.max(Math.round(d.start + coord(e) - d.origin), d.min), d.max)
    d.moved = d.moved || d.latest !== d.start
    if (!d.frame) {
      d.frame = requestAnimationFrame(() => {
        d.frame = 0
        onLive(d.latest)
      })
    }
  }

  const horizontal = axis === 'x'
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={label}
      data-testid={testId}
      draggable={false}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onLostPointerCapture={() => end(false)}
      onPointerEnter={() => onPointerInside(true)}
      onPointerLeave={() => { if (!drag.current) onPointerInside(false) }}
      onDoubleClick={(e) => { e.stopPropagation(); onReset() }}
      style={{ touchAction: 'none' }}
      className={`group absolute z-10 flex items-center justify-center ${
        horizontal ? 'top-0 bottom-0 -right-1.5 w-3 cursor-ew-resize' : 'left-0 right-0 -bottom-1.5 h-3 cursor-ns-resize'
      }`}
    >
      <span
        aria-hidden
        className={`rounded-full bg-ink-3/50 transition-colors group-hover:bg-status-info-solid ${horizontal ? 'h-8 w-1' : 'w-8 h-1'}`}
      />
    </div>
  )
}
