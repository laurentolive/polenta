import { useTranslation } from 'react-i18next'
import type { FilterOptions } from '../lib/textFilter'

/** Les 3 boutons bascule casse/mot entier/regex de la barre de filtre globale
 *  (`SystemPanel.tsx` → `FilterBar`), extraits pour être réutilisés à l'identique
 *  par le popover de filtre colonne d'`ExcelView` (T51). */
export function FilterOptionsToggle({
  options,
  onChange,
}: {
  options: FilterOptions
  onChange: (next: FilterOptions) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        title={t('system.filterOptionsToggle.caseSensitive')}
        onClick={() => onChange({ ...options, caseSensitive: !options.caseSensitive })}
        className={`text-xs px-1.5 py-0.5 rounded border ${
          options.caseSensitive
            ? 'border-status-info-border bg-status-info-bg text-status-info'
            : 'border-edge text-ink-3'
        }`}
      >
        Aa
      </button>
      <button
        type="button"
        title={t('sidebar.search.wholeWord')}
        onClick={() => onChange({ ...options, wholeWord: !options.wholeWord })}
        className={`text-xs px-1.5 py-0.5 rounded border ${
          options.wholeWord
            ? 'border-status-info-border bg-status-info-bg text-status-info'
            : 'border-edge text-ink-3'
        }`}
      >
        [W]
      </button>
      <button
        type="button"
        title={t('sidebar.search.regex')}
        onClick={() => onChange({ ...options, regex: !options.regex })}
        className={`text-xs px-1.5 py-0.5 rounded border ${
          options.regex
            ? 'border-status-info-border bg-status-info-bg text-status-info'
            : 'border-edge text-ink-3'
        }`}
      >
        .*
      </button>
    </div>
  )
}
