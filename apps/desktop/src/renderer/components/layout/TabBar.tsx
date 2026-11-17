import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, ChevronDown, X } from 'lucide-react'
import { useTabs } from '../../contexts/TabsContext'
import { TabListMenu } from './TabListMenu'
import { ConfirmCloseTabModal } from './ConfirmCloseTabModal'
import { ConfirmLeavePageModal } from './ConfirmLeavePageModal'
import { HistoryNavButtons } from './HistoryNavButtons'
import { NodeContextMenu } from '../../tiptap/NodeContextMenu'
import { api } from '../../api'
import { isWeb } from '../../platform'
import { hrefOf } from '../../lib/tabHistory'
import { flushPendingEdits } from '../../lib/pendingEdits'
import { stageIncomingDraft } from '../../lib/tabDraft'
import { deriveCurrentProjectId } from './AppLayout'
import { isTabDragPayload, TAB_DRAG_MIME } from '../../../shared/tab-drag'

/** GH343 — glisser hors de la fenêtre / entre fenêtres : desktop seulement (réordonner : partout). */
const multiWindow = !isWeb

function isEditableElement(el: Element | null): el is HTMLElement {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)
}

export function TabBar() {
  const { t } = useTranslation()
  const { tabs, activeTabId, dirtyTabIds, openTab, attemptCloseTab, activateTab, moveTab, detachTab, adoptTab, snapshotTab } = useTabs()
  const [showMenu, setShowMenu] = useState(false)
  // GH342 — menu contextuel d'un onglet (clic droit).
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const menuTab = tabMenu ? tabs.find(tab => tab.id === tabMenu.tabId) : undefined

  // ─── GH343 — glisser un onglet ──────────────────────────────────────────────────────────────────
  const stripRef = useRef<HTMLDivElement>(null)
  /** Emplacement d'insertion (0…n) sous le pointeur pendant un glisser accepté par cette barre. */
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  /** Onglet de cette fenêtre en cours de glisser (réordonnancement local). */
  const localDrag = useRef<{ tabId: string; dragId: string } | null>(null)
  /** Glisser venu d'une autre fenêtre : accepté par cette fenêtre (réponse du main) ? */
  const remoteAccept = useRef(false)
  /** Glissers partis de cette fenêtre : id → onglet, retiré quand une autre fenêtre le prend. */
  const outgoing = useRef(new Map<string, string>())
  const detachRef = useRef(detachTab)
  detachRef.current = detachTab

  useEffect(() => {
    if (!multiWindow) return
    return window.polenta.on('app:tab-moved', (...args: unknown[]) => {
      const tabId = outgoing.current.get(String(args[0]))
      if (!tabId) return
      outgoing.current.delete(String(args[0]))
      detachRef.current(tabId)
    })
  }, [])

  function slotAt(clientX: number): number {
    const items = stripRef.current?.querySelectorAll<HTMLElement>('[data-testid="tab"]') ?? []
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect()
      if (clientX < r.left + r.width / 2) return i
    }
    return items.length
  }

  function onDragStart(e: DragEvent, tabId: string) {
    const dragId = crypto.randomUUID()
    e.dataTransfer.setData(TAB_DRAG_MIME, dragId)
    e.dataTransfer.effectAllowed = 'move'
    localDrag.current = { tabId, dragId }
    if (!multiWindow) return
    // Saisie du champ actif enregistrée (blur) et lue avant le départ de l'onglet.
    if (tabId === activeTabId && isEditableElement(document.activeElement)) document.activeElement.blur()
    const snapshot = snapshotTab(tabId)
    if (!snapshot) return
    outgoing.current.set(dragId, tabId)
    const projectId = deriveCurrentProjectId(new URLSearchParams(snapshot.tab.searchParams).toString())
    void api.app.startTabDrag(dragId, { ...snapshot, projectId, tabCount: tabs.length })
      // Enregistrements automatiques (vue Édition…) écrits avant que la page s'affiche ailleurs.
      .then(() => flushPendingEdits())
      .then(() => api.app.tabDragReady(dragId))
      .catch(() => { outgoing.current.delete(dragId) })
  }

  function onDragEnd(e: DragEvent) {
    const drag = localDrag.current
    localDrag.current = null
    setDropIndex(null)
    if (!multiWindow || !drag) return
    // `none` : lâché hors de toute cible (bureau, page) — le main décide d'une nouvelle fenêtre.
    void api.app.endTabDrag(drag.dragId, e.dataTransfer.dropEffect !== 'none').catch(() => {})
  }

  function onDragEnter(e: DragEvent) {
    if (localDrag.current || !multiWindow || !e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    // La valeur du glisser n'est lisible qu'au dépôt : le main dit si cette fenêtre l'accepte (D2).
    void api.app.tabDragInfo().then(info => { remoteAccept.current = !!info?.accept }).catch(() => { remoteAccept.current = false })
  }

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    if (!localDrag.current && !remoteAccept.current) return   // refus : curseur « interdit »
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const slot = slotAt(e.clientX)
    if (slot !== dropIndex) setDropIndex(slot)
  }

  function onDragLeave(e: DragEvent) {
    if (stripRef.current && e.relatedTarget instanceof Node && stripRef.current.contains(e.relatedTarget)) return
    setDropIndex(null)
  }

  function onDrop(e: DragEvent) {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    const slot = dropIndex ?? slotAt(e.clientX)
    setDropIndex(null)
    if (localDrag.current) {
      moveTab(localDrag.current.tabId, slot)
      return
    }
    if (!multiWindow || !remoteAccept.current) return
    remoteAccept.current = false
    const dragId = e.dataTransfer.getData(TAB_DRAG_MIME)
    void api.app.takeTabDrag(dragId).then(payload => {
      if (!isTabDragPayload(payload)) return
      stageIncomingDraft(payload.draft)
      adoptTab(payload.tab, slot)
    }).catch(() => {})
  }

  return (
    <div className="relative flex items-center h-8 shrink-0 bg-surface border-b border-edge">
      <HistoryNavButtons />
      <button
        type="button"
        onClick={() => setShowMenu(v => !v)}
        title={t('layout.tabBar.allTabs')}
        className="flex items-center justify-center w-8 h-8 shrink-0 text-ink-3 hover:text-ink hover:bg-hover transition-colors border-r border-edge"
      >
        <ChevronDown size={14} />
      </button>

      <div
        ref={stripRef}
        className="flex-1 min-w-0 flex items-center overflow-x-auto h-8"
        data-testid="tab-strip"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId
          const dirty = dirtyTabIds.has(tab.id)
          return (
            <div key={tab.id} className="relative flex items-center h-8 shrink-0">
              {dropIndex === index && <DropIndicator />}
              <button
                type="button"
                draggable
                onDragStart={e => onDragStart(e, tab.id)}
                onDragEnd={onDragEnd}
                onClick={() => !active && activateTab(tab.id)}
                onMouseDown={e => { if (e.button === 1) e.preventDefault() }}
                onAuxClick={e => { if (e.button === 1) attemptCloseTab(tab.id) }}
                onContextMenu={e => { e.preventDefault(); setTabMenu({ x: e.clientX, y: e.clientY, tabId: tab.id }) }}
                data-testid="tab"
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
            </div>
          )
        })}

        <div className="relative flex items-center h-8 shrink-0">
          {dropIndex === tabs.length && <DropIndicator />}
          <button
            type="button"
            onClick={() => openTab()}
            title={t('layout.tabBar.newTab')}
            className="flex items-center justify-center w-8 h-8 shrink-0 text-ink-3 hover:text-ink hover:bg-hover transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {showMenu && <TabListMenu onClose={() => setShowMenu(false)} />}
      {tabMenu && menuTab && (
        <NodeContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => setTabMenu(null)}
          items={[
            { id: 'open-window', label: t('layout.tabBar.openInNewWindow'), onSelect: () => { void api.app.openWindow(hrefOf(menuTab)) } },
            'separator',
            { id: 'close', label: t('layout.tabBar.closeTab'), onSelect: () => attemptCloseTab(menuTab.id) },
          ]}
        />
      )}
      <ConfirmCloseTabModal />
      <ConfirmLeavePageModal />
    </div>
  )
}

/** Trait d'insertion entre deux onglets pendant un glisser. */
function DropIndicator() {
  return <span data-testid="tab-drop-indicator" className="absolute left-0 top-1 bottom-1 w-0.5 -ml-px bg-status-info-solid rounded-full pointer-events-none z-10" />
}
