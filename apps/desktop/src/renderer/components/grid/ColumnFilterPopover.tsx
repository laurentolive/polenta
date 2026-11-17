import { useTranslation } from 'react-i18next'
import { FilterOptionsToggle } from '../FilterOptionsToggle'
import { EMPTY_COLUMN_FILTER, type ColumnFilter } from './columnFilters'

/**
 * GH389 — popover du filtre d'une colonne (T51) : texte + options casse / mot entier / regex.
 * Échap vide le filtre et ferme ; il est consommé ici (GH33 : sinon il remonte jusqu'à l'écouteur
 * `window` d'une modale hôte, qui se fermerait).
 */
export function ColumnFilterPopover({ top, left, value, onChange, onClose }: {
  top: number
  left: number
  value: ColumnFilter | undefined
  onChange: (next: ColumnFilter) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const current = value ?? EMPTY_COLUMN_FILTER
  return (
    <div
      data-column-filter-popover
      style={{ position: 'fixed', top, left, width: 220, zIndex: 50 }}
      className="bg-surface border border-edge rounded-lg shadow-xl p-2 space-y-2"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={current.text}
          onChange={e => onChange({ ...current, text: e.target.value })}
          onKeyDown={e => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            e.nativeEvent.stopImmediatePropagation()
            onChange({ ...current, text: '' })
            onClose()
          }}
          placeholder={t('common.filterPlaceholder')}
          className="flex-1 text-xs bg-transparent text-ink border border-edge rounded px-2 py-1 outline-none"
          data-testid="column-filter-input"
        />
        {current.text && (
          <button type="button" onClick={() => onChange({ ...current, text: '' })} className="text-ink-3 hover:text-ink text-xs">
            ✕
          </button>
        )}
      </div>
      <FilterOptionsToggle options={current.options} onChange={options => onChange({ ...current, options })} />
    </div>
  )
}
