import type { MouseEvent as ReactMouseEvent } from 'react'

// GH352 — fermeture d'une popup par clic sur son fond.
//
// Un simple `onClick` sur le fond ferme aussi quand l'appui commence DANS la popup (sélection de
// texte dans un champ) et que le bouton est relâché sur le fond : le navigateur envoie alors le
// `click` à l'ancêtre commun des deux cibles, c'est-à-dire au fond. On ne ferme donc que si
// l'appui et le relâchement ont eu lieu sur l'élément qui reçoit le clic.
//
// Sans hook (utilisable dans du JSX conditionnel) : les cibles de l'appui et du relâchement sont
// mémorisées sur l'élément du fond lui-même.

interface Press { down: EventTarget | null; up: EventTarget | null }
const presses = new WeakMap<EventTarget, Press>()

export interface BackdropDismissOptions {
  /** Arrête la propagation du clic sur ce fond (popup imbriquée dans une autre). */
  stopPropagation?: boolean
}

export interface BackdropDismissProps {
  onMouseDown: (e: ReactMouseEvent) => void
  onMouseUp: (e: ReactMouseEvent) => void
  onClick: (e: ReactMouseEvent) => void
}

/** Props à étaler sur le fond d'une popup : `<div className="fixed inset-0 …" {...backdropDismiss(onClose)}>`.
 *  `onDismiss` absent (popup non fermable pour l'instant, ex. opération en cours) : aucun effet. */
export function backdropDismiss(
  onDismiss: (() => void) | undefined | null | false,
  options: BackdropDismissOptions = {},
): BackdropDismissProps {
  return {
    onMouseDown: e => { presses.set(e.currentTarget, { down: e.target, up: null }) },
    onMouseUp: e => {
      const press = presses.get(e.currentTarget)
      if (press) press.up = e.target
    },
    onClick: e => {
      if (options.stopPropagation) e.stopPropagation()
      const press = presses.get(e.currentTarget)
      presses.delete(e.currentTarget)
      // Appui et relâchement sur la même cible, celle du clic. Un clic sans appui mémorisé
      // (clavier, clic synthétique) n'est pas un geste de souris commencé ailleurs : il ferme.
      const genuine = !press || (press.down === e.target && press.up === e.target)
      if (genuine && onDismiss) onDismiss()
    },
  }
}
