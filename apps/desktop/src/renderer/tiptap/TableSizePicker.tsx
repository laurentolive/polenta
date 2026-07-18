import { useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  top: number
  left: number
  onPick: (rows: number, cols: number) => void
  onClose: () => void
}

const MAX_ROWS = 8
const MAX_COLS = 8

// Popover d'insertion de tableau : grille survolable (façon Word/Google Docs)
// plutôt que des champs numériques — interaction plus rapide pour le cas
// courant d'un petit tableau. `rows`/`cols` désignent le nombre total de
// lignes/colonnes du tableau inséré (la ligne d'en-tête fait partie du
// compte, cohérent avec l'insertion Word/Google Docs). Sur le modèle de
// DrawioPagePicker.tsx (portail, stopPropagation pour ne pas fermer une
// popover richtext ancêtre).
export function TableSizePicker({ top, left, onPick, onClose }: Props) {
  const [hover, setHover] = useState({ rows: 0, cols: 0 })

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        style={{ position: 'fixed', top, left, zIndex: 9999 }}
        className="bg-surface border border-edge rounded shadow-lg p-2"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="text-[10px] uppercase tracking-wide text-ink-3 mb-1">
          {hover.rows > 0 ? `${hover.rows} × ${hover.cols}` : 'Insérer un tableau'}
        </div>
        <div
          className="grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 1rem)` }}
          onMouseLeave={() => setHover({ rows: 0, cols: 0 })}
        >
          {Array.from({ length: MAX_ROWS * MAX_COLS }, (_, i) => {
            const row = Math.floor(i / MAX_COLS) + 1
            const col = (i % MAX_COLS) + 1
            const active = row <= hover.rows && col <= hover.cols
            return (
              <button
                key={i}
                type="button"
                onMouseEnter={() => setHover({ rows: row, cols: col })}
                onMouseDown={e => { e.preventDefault(); onPick(row, col); onClose() }}
                className={`w-4 h-4 border ${active ? 'bg-hover border-ink-2' : 'border-edge'}`}
              />
            )
          })}
        </div>
      </div>
    </>,
    document.body,
  )
}
