import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTabs } from '../../contexts/TabsContext'

interface Props {
  onClose: () => void
}

/** Popover anchored under the chevron trigger — same click-away/Escape pattern as
 *  ModificationControl's PublishPopover. */
export function TabListMenu({ onClose }: Props) {
  const { t } = useTranslation()
  const { tabs, activeTabId, recentlyClosed, activateTab, reopenClosedTab } = useTabs()
  const [filter, setFilter] = useState('')

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const needle = filter.trim().toLowerCase()
  const filteredTabs = needle ? tabs.filter(t => t.title.toLowerCase().includes(needle)) : tabs
  const filteredClosed = needle ? recentlyClosed.filter(t => t.title.toLowerCase().includes(needle)) : recentlyClosed

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute left-0 top-full mt-1 z-50 bg-surface border border-edge rounded-lg shadow-xl w-72 max-h-[70vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-2 border-b border-edge sticky top-0 bg-surface">
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={t('layout.tabListMenu.filterPlaceholder')}
            className="input-field w-full text-xs"
            autoFocus
          />
        </div>

        <div className="py-1">
          {filteredTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { activateTab(tab.id); onClose() }}
              className={[
                'w-full text-left px-3 py-1.5 text-xs truncate transition-colors',
                tab.id === activeTabId ? 'text-ink bg-hover' : 'text-ink-2 hover:bg-hover',
              ].join(' ')}
            >
              {tab.title}
            </button>
          ))}
          {filteredTabs.length === 0 && (
            <div className="px-3 py-2 text-xs text-ink-3 italic">{t('layout.tabListMenu.noTabsOpen')}</div>
          )}
        </div>

        {filteredClosed.length > 0 && (
          <div className="border-t border-edge py-1">
            <div className="section-label px-3 py-1">{t('layout.tabListMenu.recentlyClosed')}</div>
            {filteredClosed.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => { reopenClosedTab(tab.id); onClose() }}
                className="w-full text-left px-3 py-1.5 text-xs truncate text-ink-3 hover:bg-hover hover:text-ink transition-colors"
              >
                {tab.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
