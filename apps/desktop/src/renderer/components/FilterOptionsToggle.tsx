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
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        title="Sensible à la casse"
        onClick={() => onChange({ ...options, caseSensitive: !options.caseSensitive })}
        className={`text-xs px-1.5 py-0.5 rounded border ${
          options.caseSensitive
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
            : 'border-edge text-ink-3'
        }`}
      >
        Aa
      </button>
      <button
        type="button"
        title="Mot entier"
        onClick={() => onChange({ ...options, wholeWord: !options.wholeWord })}
        className={`text-xs px-1.5 py-0.5 rounded border ${
          options.wholeWord
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
            : 'border-edge text-ink-3'
        }`}
      >
        [W]
      </button>
      <button
        type="button"
        title="Expression régulière"
        onClick={() => onChange({ ...options, regex: !options.regex })}
        className={`text-xs px-1.5 py-0.5 rounded border ${
          options.regex
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
            : 'border-edge text-ink-3'
        }`}
      >
        .*
      </button>
    </div>
  )
}
