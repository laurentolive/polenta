import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { User, Settings, Search, GitBranch, ClipboardList, FlaskConical, Rocket, PieChart, Variable } from 'lucide-react'
import type { Panel } from './AppLayout'
import { ImpactAnalysisIcon } from './ImpactAnalysisIcon'
import { UpdateBadge } from './UpdateBadge'
import { ActivityBarMenu } from './ActivityBarMenu'
import {
  applyOrder, clearLayout, hiddenSet, loadLayout, movePanel, saveLayout, toggleHidden,
  type ActivityBarLayout,
} from './activityBarLayout'

interface Props {
  activePanel: Panel
  onSelect: (p: Panel) => void
  hasProject: boolean
  sidebarCollapsed: boolean
}

const PANELS: {
  id: Panel
  icon: ReactNode
  labelKey: string
  requiresProject?: boolean
}[] = [
  { id: 'account', icon: <User size={20} />,      labelKey: 'layout.activityBar.account' },
  { id: 'project', icon: <Settings size={20} />,   labelKey: 'layout.activityBar.project' },
  { id: 'dashboard', icon: <PieChart size={20} />, labelKey: 'layout.activityBar.dashboard', requiresProject: true },
  { id: 'requirements', icon: <ClipboardList size={20} />, labelKey: 'layout.activityBar.requirements', requiresProject: true },
  { id: 'tests',        icon: <FlaskConical size={20} />,  labelKey: 'layout.activityBar.tests',        requiresProject: true },
  { id: 'campaigns',    icon: <Rocket size={20} />,         labelKey: 'layout.activityBar.campaigns',    requiresProject: true },
  { id: 'parameters',   icon: <Variable size={20} />,       labelKey: 'layout.activityBar.parameters',   requiresProject: true },
  { id: 'search',  icon: <Search size={20} />,     labelKey: 'layout.activityBar.search', requiresProject: true },
  { id: 'version', icon: <GitBranch size={20} />,  labelKey: 'layout.activityBar.version',   requiresProject: true },
  { id: 'impact',  icon: <ImpactAnalysisIcon size={20} />, labelKey: 'layout.activityBar.impact', requiresProject: true },
]

const DEFAULT_ORDER = PANELS.map(p => p.id)
const PANEL_BY_ID = new Map(PANELS.map(p => [p.id, p]))

export function ActivityBar({ activePanel, onSelect, hasProject, sidebarCollapsed }: Props) {
  const { t } = useTranslation()
  // GH56 — ordre (drag & drop) et boutons masqués (clic droit), préférence par poste.
  const [layout, setLayout] = useState<ActivityBarLayout | null>(loadLayout)
  const [draggingId, setDraggingId] = useState<Panel | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: Panel; position: 'before' | 'after' } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; target: Panel | null } | null>(null)
  const badgeRef = useRef<HTMLDivElement>(null)

  const order = useMemo(() => applyOrder(DEFAULT_ORDER, layout), [layout])
  const hidden = useMemo(() => hiddenSet(DEFAULT_ORDER, layout), [layout])

  function update(next: ActivityBarLayout) {
    setLayout(next)
    saveLayout(next)
  }

  function handleDragOver(e: React.DragEvent, id: Panel) {
    if (!draggingId) return
    e.preventDefault()
    if (id === draggingId) {
      setDropTarget(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const position = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
    setDropTarget(prev => (prev?.id === id && prev.position === position ? prev : { id, position }))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (draggingId && dropTarget) {
      const next = movePanel(order, draggingId, dropTarget.id, dropTarget.position)
      if (next !== order && next.some((id, i) => id !== order[i])) update({ order: next, hidden: [...hidden] })
    }
    setDraggingId(null)
    setDropTarget(null)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDropTarget(null)
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (badgeRef.current?.contains(e.target as Node)) return
    e.preventDefault()
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-panel]')?.dataset.panel as Panel | undefined
    setMenu({ x: e.clientX, y: e.clientY, target: target ?? null })
  }

  const closeMenu = useCallback(() => setMenu(null), [])

  return (
    <div
      className="flex flex-col w-12 bg-activity-bg border-r border-activity-border py-2 gap-1"
      onContextMenu={handleContextMenu}
    >
      {order.filter(id => !hidden.has(id)).map(id => {
        const p = PANEL_BY_ID.get(id)!
        // aria-disabled plutôt que disabled : Chromium ne délivre ni dragstart ni contextmenu à un
        // <button disabled>, or un bouton grisé reste déplaçable (GH56).
        const disabled = !!p.requiresProject && !hasProject
        return (
          <div key={id} className="relative" data-panel={id}>
            {dropTarget?.id === id && dropTarget.position === 'before' && (
              <div className="absolute left-0 right-0 -top-0.5 h-0.5 bg-status-info-solid z-10 pointer-events-none" />
            )}
            <button
              title={t(p.labelKey)}
              aria-disabled={disabled}
              // GH123 — reclic sur le bouton actif = repli/dépli du panneau latéral.
              aria-expanded={activePanel === p.id ? !sidebarCollapsed : undefined}
              draggable
              onDragStart={e => {
                setDraggingId(id)
                e.dataTransfer.setData('text/plain', id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={e => handleDragOver(e, id)}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              onClick={() => !disabled && onSelect(p.id)}
              className={[
                'flex items-center justify-center w-12 h-12 transition-colors',
                activePanel === p.id
                  ? 'text-activity-fg-hover bg-activity-bg-active'
                  : disabled
                    ? 'text-activity-fg-disabled cursor-default'
                    : 'text-activity-fg hover:text-activity-fg-hover hover:bg-activity-bg-active',
                draggingId === id ? 'opacity-40' : '',
              ].join(' ')}
            >
              {p.icon}
            </button>
            {dropTarget?.id === id && dropTarget.position === 'after' && (
              <div className="absolute left-0 right-0 -bottom-0.5 h-0.5 bg-status-info-solid z-10 pointer-events-none" />
            )}
          </div>
        )
      })}
      <div ref={badgeRef} className="mt-auto">
        <UpdateBadge />
      </div>
      {menu && (
        <ActivityBarMenu
          x={menu.x}
          y={menu.y}
          target={menu.target}
          panels={order.map(id => ({ id, label: t(PANEL_BY_ID.get(id)!.labelKey) }))}
          hidden={hidden}
          onToggle={id => update({ order, hidden: toggleHidden([...hidden], id) })}
          onReset={() => { setLayout(null); clearLayout() }}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}
