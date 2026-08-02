import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, ChevronDown, X } from 'lucide-react'
import { useTabs } from '../../contexts/TabsContext'
import { TabListMenu } from './TabListMenu'
import { ConfirmCloseTabModal } from './ConfirmCloseTabModal'

export function TabBar() {
  const { t } = useTranslation()
  const { tabs, activeTabId, dirtyTabIds, openTab, attemptCloseTab, activateTab } = useTabs()
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div className="relative flex items-center h-8 shrink-0 bg-surface border-b border-edge">
      <button
        type="button"
        onClick={() => setShowMenu(v => !v)}
        title={t('layout.tabBar.allTabs')}
        className="flex items-center justify-center w-8 h-8 shrink-0 text-ink-3 hover:text-ink hover:bg-hover transition-colors border-r border-edge"
      >
        <ChevronDown size={14} />
      </button>

      <div className="flex-1 min-w-0 flex items-center overflow-x-auto">
        {tabs.map(tab => {
          const active = tab.id === activeTabId
          const dirty = dirtyTabIds.has(tab.id)
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => !active && activateTab(tab.id)}
              onMouseDown={e => { if (e.button === 1) e.preventDefault() }}
              onAuxClick={e => { if (e.button === 1) attemptCloseTab(tab.id) }}
              className={[
                'group flex items-center gap-1.5 h-8 px-3 max-w-[200px] shrink-0 text-xs border-r border-edge transition-colors',
                active ? 'bg-canvas text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink',
              ].join(' ')}
              title={tab.title}
            >
              {dirty && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-status-warning-solid" />}
              <span className="truncate">{tab.title}</span>
              <span
                role="button"
                onClick={e => { e.stopPropagation(); attemptCloseTab(tab.id) }}
                className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-edge transition-opacity"
              >
                <X size={11} />
              </span>
            </button>
          )
        })}

        <button
          type="button"
          onClick={() => openTab()}
          title={t('layout.tabBar.newTab')}
          className="flex items-center justify-center w-8 h-8 shrink-0 text-ink-3 hover:text-ink hover:bg-hover transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      {showMenu && <TabListMenu onClose={() => setShowMenu(false)} />}
      <ConfirmCloseTabModal />
    </div>
  )
}
