import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'

/** GH222 — « changement précédent / suivant » et compteur « 3 / 12 » (ou « conflit … »). */
export function NavBar({ index, count, onPrev, onNext, kind = 'change' }: {
  index: number
  count: number
  onPrev: () => void
  onNext: () => void
  kind?: 'change' | 'conflict'
}) {
  const { t } = useTranslation()
  const prefix = kind === 'conflict' ? 'diffkit.conflict' : 'diffkit.change'
  return (
    <div className="flex items-center gap-1 shrink-0" data-testid="diff-nav">
      <span className="text-xs text-ink-3 tabular-nums" data-testid="diff-nav-counter">
        {count === 0
          ? t(`${prefix}.none`)
          : t(`${prefix}.counter`, { current: index < 0 ? '–' : index + 1, total: count })}
      </span>
      <button type="button" className="btn-secondary-sm px-1" onClick={onPrev} disabled={count === 0}
        title={t(`${prefix}.prev`)} aria-label={t(`${prefix}.prev`)}>
        <ChevronUp size={12} />
      </button>
      <button type="button" className="btn-secondary-sm px-1" onClick={onNext} disabled={count === 0}
        title={t(`${prefix}.next`)} aria-label={t(`${prefix}.next`)}>
        <ChevronDown size={12} />
      </button>
    </div>
  )
}
