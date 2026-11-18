import { useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useAnchoredTop } from '../../hooks/useAnchoredTop'

interface Props {
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  onClose: () => void
  /** GH401 — bas de la cellule + écart, et haut de la cellule : au-dessus s'il ne tient pas dessous. */
  top: number
  anchorTop: number
  style: CSSProperties
}

/** Popover à cases à cocher pour un champ `multi_enum`, ancré (position `fixed`
 *  déjà calculée par l'appelant) sur la cellule/le champ cliqué — même gabarit que
 *  les popovers richtext/lien existants de ExcelView.tsx (`data-multi-enum-popover`
 *  pour le click-outside de l'appelant, cf. specs/T126-design.md §4). Chaque case cochée
 *  est un commit atomique (pas de brouillon) — Échap ferme donc sans rien à annuler. */
export function MultiEnumPopover({ options, selected, onToggle, onClose, top, anchorTop, style }: Props) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const placedTop = useAnchoredTop(ref, top, anchorTop)
  return (
    <div
      ref={ref}
      data-multi-enum-popover
      style={{ ...style, top: placedTop, position: 'fixed', zIndex: 50 }}
      className="bg-surface border border-edge rounded shadow-lg p-2 flex flex-wrap gap-2"
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      {options.map(v => (
        <label key={v} className="flex items-center gap-1.5 text-sm text-ink cursor-pointer">
          <input
            type="checkbox"
            checked={selected.includes(v)}
            onChange={() => onToggle(v)}
            className="h-3.5 w-3.5 accent-ink"
          />
          {v}
        </label>
      ))}
      {options.length === 0 && (
        <span className="text-ink-3 text-xs italic">{t('system.editView.noConfiguredValue')}</span>
      )}
    </div>
  )
}
