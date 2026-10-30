import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTabs } from '../../contexts/TabsContext'
import { useHistoryNavigation } from '../../hooks/useHistoryNavigation'
import { historyMenuEntries, stepHistory } from '../../lib/tabHistory'
import { IS_MAC } from './sidebarCollapse'

const LONG_PRESS_MS = 500
const SHORTCUTS = IS_MAC ? { back: '⌘[', forward: '⌘]' } : { back: 'Alt+←', forward: 'Alt+→' }

/** GH228 — boutons Précédent / Suivant de l'onglet actif, à gauche de la barre d'onglets.
 *  Clic droit ou appui long : liste des pages de ce côté de l'historique, comme un navigateur. */
export function HistoryNavButtons() {
  const { t } = useTranslation()
  const { activeTab, attemptHistoryNav } = useTabs()
  const [menu, setMenu] = useState<-1 | 1 | null>(null)
  useHistoryNavigation()

  const button = (delta: -1 | 1) => {
    const index = stepHistory(activeTab, delta)
    const label = delta < 0 ? 'back' : 'forward'
    return (
      <HistoryButton
        key={label}
        disabled={index === null}
        title={t(`layout.tabBar.${label}`, { shortcut: SHORTCUTS[label] })}
        onClick={() => { if (index !== null) attemptHistoryNav(index) }}
        onMenu={() => setMenu(delta)}
        testId={`history-${label}`}
      >
        {delta < 0 ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </HistoryButton>
    )
  }

  return (
    <div className="relative flex shrink-0 border-r border-edge">
      {button(-1)}
      {button(1)}
      {menu !== null && (
        <HistoryMenu
          direction={menu}
          onClose={() => setMenu(null)}
          entries={historyMenuEntries(activeTab, menu)}
          onSelect={index => { setMenu(null); attemptHistoryNav(index) }}
        />
      )}
    </div>
  )
}

interface HistoryButtonProps {
  disabled: boolean
  title: string
  onClick: () => void
  onMenu: () => void
  testId: string
  children: React.ReactNode
}

function HistoryButton({ disabled, title, onClick, onMenu, testId, children }: HistoryButtonProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressedRef = useRef(false)
  const cancel = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }
  useEffect(() => cancel, [])

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-label={title}
      data-testid={testId}
      onClick={() => {
        if (longPressedRef.current) { longPressedRef.current = false; return }
        onClick()
      }}
      onContextMenu={e => { e.preventDefault(); if (!disabled) onMenu() }}
      onPointerDown={e => {
        if (e.button !== 0 || disabled) return
        longPressedRef.current = false
        cancel()
        timerRef.current = setTimeout(() => { longPressedRef.current = true; onMenu() }, LONG_PRESS_MS)
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      className="flex items-center justify-center w-7 h-8 text-ink-3 hover:text-ink hover:bg-hover transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-3"
    >
      {children}
    </button>
  )
}

interface HistoryMenuProps {
  direction: -1 | 1
  entries: { index: number; entry: { title: string } }[]
  onSelect: (index: number) => void
  onClose: () => void
}

/** Même motif clic extérieur / Échap que TabListMenu. */
function HistoryMenu({ direction, entries, onSelect, onClose }: HistoryMenuProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div
        role="menu"
        data-testid={`history-menu-${direction < 0 ? 'back' : 'forward'}`}
        className="absolute left-0 top-full mt-1 z-50 bg-surface border border-edge rounded-lg shadow-xl w-72 max-h-[70vh] overflow-y-auto py-1"
      >
        {entries.map(({ index, entry }) => (
          <button
            key={index}
            type="button"
            role="menuitem"
            onClick={() => onSelect(index)}
            className="w-full text-left px-3 py-1.5 text-xs truncate text-ink-2 hover:bg-hover hover:text-ink transition-colors"
          >
            {entry.title}
          </button>
        ))}
      </div>
    </>
  )
}
