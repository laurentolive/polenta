import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export const ROW_MAX_LINES_MIN = 1
export const ROW_MAX_LINES_MAX = 20
/** Position du slider au-delà de `ROW_MAX_LINES_MAX` : hauteur non limitée (toutes les lignes). */
export const ROW_MAX_LINES_ALL = ROW_MAX_LINES_MAX + 1
export const ROW_MAX_LINES_DEFAULT = ROW_MAX_LINES_ALL

/** Icône au style lucide : double flèche verticale (hauteur) à gauche d'une ligne/cadre. */
function RowHeightIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 3v18" />
      <path d="m2 6 3-3 3 3" />
      <path d="m2 18 3 3 3-3" />
      <rect x="11" y="4" width="10" height="16" rx="1" />
    </svg>
  )
}

/** Bouton de la barre du haut (vue tableau) — ouvre une popup avec un slider réglant la
 *  hauteur max des lignes d'`ExcelView`, exprimée en nombre de lignes de texte ; le bout du
 *  slider (`ROW_MAX_LINES_ALL`) affiche toutes les lignes. */
export function RowMaxHeightButton({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={t('system.excelView.rowMaxHeight')}
        className={[
          'text-ink-3 hover:text-ink p-1 rounded hover:bg-hover',
          open ? 'bg-hover text-ink' : '',
        ].join(' ')}
      >
        <RowHeightIcon size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-56 bg-surface border border-edge rounded-lg shadow-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-ink-2">{t('system.excelView.rowMaxHeight')}</span>
              <span className="text-xs font-mono text-ink">
                {value >= ROW_MAX_LINES_ALL
                  ? t('system.excelView.rowMaxLinesAll')
                  : t('system.excelView.rowMaxLines', { count: value })}
              </span>
            </div>
            <input
              type="range"
              min={ROW_MAX_LINES_MIN}
              max={ROW_MAX_LINES_ALL}
              step={1}
              value={value}
              onChange={e => onChange(Number(e.target.value))}
              className="w-full accent-ink"
              autoFocus
            />
          </div>
        </>
      )}
    </div>
  )
}
