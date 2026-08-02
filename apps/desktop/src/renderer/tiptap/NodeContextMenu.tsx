import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface NodeContextMenuItem {
  id: string
  label: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export type NodeContextMenuEntry = NodeContextMenuItem | 'separator'

interface Props {
  x: number
  y: number
  items: NodeContextMenuEntry[]
  onClose: () => void
}

// Menu contextuel générique pour les blocs média du richtext (image, drawio).
// Reprend volontairement le pattern visuel/de fermeture du ContextMenu de
// ElementTree.tsx (mêmes classes, même mécanisme mousedown-extérieur) sans
// extraire de composant partagé entre les deux : ElementTree est hors
// périmètre de ce ticket et les items portent des concepts différents
// (cf. specs/T75-design.md §3).
export function NodeContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', handler)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', handler)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      // Rendu via portail dans document.body : ce menu sort de l'arbre DOM du
      // champ richtext. Si ce champ est édité dans une popover (ex.
      // ExcelView.tsx) qui se ferme sur tout mousedown hors de sa propre
      // sous-arborescence (`target.closest('[data-richtext-popover]')`),
      // interagir avec ce menu ressemblerait à un clic "à l'extérieur" et
      // fermerait toute la popover d'édition. stopPropagation empêche le
      // mousedown de remonter jusqu'à ce genre d'écouteur global.
      onMouseDown={e => e.stopPropagation()}
      className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl py-1 w-52 text-xs"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="border-t border-edge my-1" />
        ) : (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            // onMouseDown + preventDefault (pas onClick) : même convention que
            // les boutons de toolbar de RichTextField.tsx — empêche le focus
            // DOM par défaut de quitter l'éditeur richtext au clic (cause du
            // "focus perdu" constaté, indépendante du stopPropagation ci-dessus
            // qui visait la fermeture intempestive de la popover ancêtre).
            onMouseDown={e => {
              e.preventDefault()
              if (item.disabled) return
              item.onSelect()
              onClose()
            }}
            className={[
              'w-full text-left px-3 py-1.5 hover:bg-hover transition-colors disabled:opacity-40 disabled:hover:bg-transparent',
              item.danger ? 'text-status-danger' : 'text-ink',
            ].join(' ')}
          >
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body,
  )
}
