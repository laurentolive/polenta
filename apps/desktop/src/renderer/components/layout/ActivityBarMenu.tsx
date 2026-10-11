import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { Panel } from './AppLayout'
import { UNHIDEABLE_PANELS } from './activityBarLayout'

/** Hauteur d'une entrée (py-1.5 + texte xs) et marge, pour garder le menu dans la fenêtre. */
const ITEM_HEIGHT = 28
const MENU_PADDING = 24

/** GH56 — menu contextuel de l'ActivityBar (clic droit sur un bouton ou sur la zone vide). */
export function ActivityBarMenu({
  x, y, target, panels, hidden, onToggle, onReset, onClose,
}: {
  x: number
  y: number
  /** Bouton visé par le clic droit, null sur la zone vide. */
  target: Panel | null
  /** Tous les panneaux, dans l'ordre courant. */
  panels: { id: Panel; label: string }[]
  hidden: Set<Panel>
  onToggle: (id: Panel) => void
  onReset: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const targetLabel = target && !UNHIDEABLE_PANELS.includes(target)
    ? panels.find(p => p.id === target)?.label
    : undefined
  const itemCount = panels.length + 1 + (targetLabel ? 1 : 0)
  const top = Math.max(0, Math.min(y, window.innerHeight - itemCount * ITEM_HEIGHT - MENU_PADDING))

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl py-1 w-56 text-xs"
      style={{ left: x, top }}
      // Le menu est un enfant DOM de la barre : sans ça, un clic droit dessus le rouvrirait ailleurs.
      onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}
    >
      {targetLabel && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => { onToggle(target!); onClose() }}
            className="w-full text-left px-3 py-1.5 hover:bg-hover transition-colors text-ink"
          >
            {t('layout.activityBar.menu.hide', { label: targetLabel })}
          </button>
          <div className="border-t border-edge my-1" />
        </>
      )}
      {panels.map(p => {
        const locked = UNHIDEABLE_PANELS.includes(p.id)
        const visible = !hidden.has(p.id)
        return (
          <button
            key={p.id}
            type="button"
            role="menuitemcheckbox"
            aria-checked={visible}
            aria-disabled={locked}
            onClick={() => { if (!locked) { onToggle(p.id); onClose() } }}
            className={[
              'w-full flex items-center gap-2 text-left px-3 py-1.5 transition-colors',
              locked ? 'text-ink-3 cursor-default' : 'text-ink hover:bg-hover',
            ].join(' ')}
          >
            <span className="w-3 shrink-0">{visible && <Check size={12} />}</span>
            {p.label}
          </button>
        )
      })}
      <div className="border-t border-edge my-1" />
      <button
        type="button"
        role="menuitem"
        onClick={() => { onReset(); onClose() }}
        className="w-full text-left px-3 py-1.5 hover:bg-hover transition-colors text-ink"
      >
        {t('layout.activityBar.menu.reset')}
      </button>
    </div>
  )
}
