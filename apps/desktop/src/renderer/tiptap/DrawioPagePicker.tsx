import { createPortal } from 'react-dom'
import type { DrawioPage } from '@polenta/api-client'

interface Props {
  top: number
  left: number
  pages: DrawioPage[]
  onPick: (pageId: string) => void
  onClose: () => void
}

// Popover de sélection de page draw.io, partagée entre l'insertion
// (DrawioInsertButton.tsx) et l'action "Changer de page/node-id" du menu
// contextuel d'un bloc déjà inséré (DrawioEmbedView.tsx) — même liste de
// pages, même présentation, seul le point d'appel diffère.
export function DrawioPagePicker({ top, left, pages, onPick, onClose }: Props) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        style={{ position: 'fixed', top, left, zIndex: 9999 }}
        className="min-w-[180px] bg-surface border border-edge rounded shadow-lg py-1"
        // Rendu via portail (document.body) : empêche le mousedown de
        // remonter jusqu'à un éventuel écouteur global "clic à l'extérieur"
        // d'une popover ancêtre (ex. richtext édité dans ExcelView.tsx), qui
        // fermerait toute la popover en le prenant pour un clic extérieur.
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-3">Choisir une page</div>
        {pages.map(p => (
          <button
            key={p.id}
            type="button"
            onMouseDown={e => { e.preventDefault(); onPick(p.id); onClose() }}
            className="w-full text-left px-2 py-1 text-xs text-ink hover:bg-hover transition-colors"
          >
            {p.name}
          </button>
        ))}
      </div>
    </>,
    document.body,
  )
}
