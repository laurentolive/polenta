import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  onClose: () => void
  style: CSSProperties
}

/** Popover à cases à cocher pour un champ `multi_enum`, ancré (position `fixed`
 *  déjà calculée par l'appelant) sur la cellule/le champ cliqué — même gabarit que
 *  les popovers richtext/lien existants de ExcelView.tsx (`data-multi-enum-popover`
 *  pour le click-outside de l'appelant, cf. specs/T126-design.md §4). Chaque case cochée
 *  est un commit atomique (pas de brouillon) — Échap ferme donc sans rien à annuler. */
export function MultiEnumPopover({ options, selected, onToggle, onClose, style }: Props) {
  const { t } = useTranslation()
  return (
    <div
      data-multi-enum-popover
      style={{ ...style, position: 'fixed', zIndex: 50 }}
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
