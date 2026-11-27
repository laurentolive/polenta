import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, ChevronDown, X } from 'lucide-react'
import { useTabs } from '../../contexts/TabsContext'
import { TabListMenu } from './TabListMenu'
import { ConfirmCloseTabModal } from './ConfirmCloseTabModal'
import { ConfirmLeavePageModal } from './ConfirmLeavePageModal'
import { useHistoryNavigation } from '../../hooks/useHistoryNavigation'
import { NodeContextMenu } from '../../tiptap/NodeContextMenu'
import { api } from '../../api'
import { isWeb } from '../../platform'
import { hrefOf } from '../../lib/tabHistory'
import { flushPendingEdits } from '../../lib/pendingEdits'
import { deriveCurrentProjectId } from './AppLayout'
import { isTabDragPayload, TAB_DRAG_MIME } from '../../../shared/tab-drag'

/** GH343 — glisser hors de la fenêtre / entre fenêtres : desktop seulement (réordonner : partout). */
const multiWindow = !isWeb
/** Durée de vie côté source d'un glisser parti (même échéance que le main). */
const OUTGOING_TTL_MS = 60_000

export function TabBar() {
  const { t } = useTranslation()
  const { tabs, activeTabId, dirtyTabIds, attemptOpenTab, attemptCloseTab, attemptActivateTab, moveTab, detachTab, adoptTab, snapshotTab } = useTabs()
  const [showMenu, setShowMenu] = useState(false)
  // GH228 — Précédent / Suivant clavier et souris : écoutés ici, une seule fois ; les boutons sont
  // dans l'en-tête de chaque vue (GH464).
  useHistoryNavigation()
  // GH342 — menu contextuel d'un onglet (clic droit).
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const menuTab = tabMenu ? tabs.find(tab => tab.id === tabMenu.tabId) : undefined

  // ─── GH343 — glisser un onglet ──────────────────────────────────────────────────────────────────
  const stripRef = useRef<HTMLDivElement>(null)

  // GH405 — l'onglet activé (Ctrl+Tab, menu ▾, ouverture) devient visible quand la barre déborde.
  // Seule la barre défile (pas ses ancêtres, comme le ferait scrollIntoView).
  useLayoutEffect(() => {
    const strip = stripRef.current
    const tab = strip?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`)
    if (!strip || !tab) return
    const s = strip.getBoundingClientRect()
    const r = tab.getBoundingClientRect()
    if (r.left < s.left) strip.scrollLeft -= s.left - r.left
    else if (r.right > s.right) strip.scrollLeft += r.right - s.right
  }, [activeTabId])

  /** Emplacement d'insertion (0…n) sous le pointeur pendant un glisser accepté par cette barre. */
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  /** Onglet de cette fenêtre en cours de glisser (`dropped` : déposé dans cette même barre). */
  const localDrag = useRef<{ tabId: string; dragId: string; dropped?: boolean } | null>(null)
  /** Glisser venu d'une autre fenêtre : réponse du main pour ce passage sur la barre (une seule
   *  demande par passage ; refus tant que la réponse n'est pas là). */
  const remote = useRef<'none' | 'pending' | 'accept' | 'refuse'>('none')
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
    // Quitte le champ actif (son enregistrement au blur) et lance les enregistrements temporisés
    // (vue Édition…) : écrits avant que la page s'affiche ailleurs. Le blur est synchrone, la saisie
    // lue juste après est donc complète.
    const flushing = flushPendingEdits()
    const snapshot = snapshotTab(tabId)
    if (!snapshot) return
    outgoing.current.set(dragId, tabId)
    setTimeout(() => outgoing.current.delete(dragId), OUTGOING_TTL_MS)
    const projectId = deriveCurrentProjectId(new URLSearchParams(snapshot.tab.searchParams).toString())
    void api.app.startTabDrag(dragId, { ...snapshot, projectId, tabCount: tabs.length })
      .then(
        // Un enregistrement en échec ne retient pas l'onglet (la saisie non sauvegardée voyage avec lui).
        () => flushing.catch(() => {}).then(() => api.app.tabDragReady(dragId)),
        () => { outgoing.current.delete(dragId) },   // glisser inconnu du main : il ne partira pas
      )
      .catch(() => {})
  }

  function onDragEnd(e: DragEvent) {
    const drag = localDrag.current
    localDrag.current = null
    setDropIndex(null)
    if (!multiWindow || !drag) return
    // Réordonné dans cette barre : le glisser est libéré (pointeur sur la fenêtre). Sinon `none` =
    // lâché hors de toute cible (bureau, page) — le main décide d'une nouvelle fenêtre.
    if (drag.dropped) outgoing.current.delete(drag.dragId)
    const dropped = !drag.dropped && e.dataTransfer.dropEffect !== 'none'
    void api.app.endTabDrag(drag.dragId, dropped).catch(() => {})
  }

  function onDragEnter(e: DragEvent) {
    if (localDrag.current || !multiWindow || !e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    if (remote.current !== 'none') return   // déjà demandé pour ce passage (entrée dans un onglet enfant)
    remote.current = 'pending'
    // La valeur du glisser n'est lisible qu'au dépôt : le main dit si cette fenêtre l'accepte (D2).
    void api.app.tabDragInfo()
      .then(info => { if (remote.current === 'pending') remote.current = info?.accept ? 'accept' : 'refuse' })
      .catch(() => { if (remote.current === 'pending') remote.current = 'refuse' })
  }

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    if (!localDrag.current && remote.current !== 'accept') return   // refus (ou réponse attendue) : curseur « interdit »
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const slot = slotAt(e.clientX)
    if (slot !== dropIndex) setDropIndex(slot)
  }

  function onDragLeave(e: DragEvent) {
    if (stripRef.current && e.relatedTarget instanceof Node && stripRef.current.contains(e.relatedTarget)) return
    setDropIndex(null)
    remote.current = 'none'
  }

  function onDrop(e: DragEvent) {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    const slot = dropIndex ?? slotAt(e.clientX)
    setDropIndex(null)
    if (localDrag.current) {
      localDrag.current.dropped = true
      moveTab(localDrag.current.tabId, slot)
      return
    }
    const accepted = remote.current === 'accept'
    remote.current = 'none'
    if (!multiWindow || !accepted) return
    const dragId = e.dataTransfer.getData(TAB_DRAG_MIME)
    void api.app.takeTabDrag(dragId).then(payload => {
      if (!isTabDragPayload(payload)) return
      // GH407 — la saisie de l'onglet reçu est remise à sa page quand il s'affiche (tout de suite, ou
      // après « Quitter cette page ? » si la page active est modifiée).
      adoptTab(payload.tab, slot, payload.draft)
    }).catch(() => {})
  }

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
                onClick={() => !active && attemptActivateTab(tab.id)}
                onMouseDown={e => { if (e.button === 1) e.preventDefault() }}
                onAuxClick={e => { if (e.button === 1) attemptCloseTab(tab.id) }}
                onContextMenu={e => { e.preventDefault(); setTabMenu({ x: e.clientX, y: e.clientY, tabId: tab.id }) }}
                data-testid="tab"
                data-tab-id={tab.id}
                data-active={active || undefined}
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
            onClick={() => attemptOpenTab()}
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
