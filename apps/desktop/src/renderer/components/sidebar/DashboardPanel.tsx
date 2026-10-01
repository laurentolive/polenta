/**
 * DashboardPanel — sidebar panel for the "Suivi" activity.
 *
 * Sprint 1 shipped only the "Requêtes" section (dashboards.service.ts and widgets
 * didn't exist yet). Sprint 2 adds the "Dashboards" section on top — same pattern:
 * a list reorderable by native HTML5 drag & drop, filterable by text, with a
 * dedicated "Ajouter" button. Both sections now share their list/DnD/filter/delete
 * logic via `ReorderableSidebarSection` (extracted here rather than duplicated —
 * see that file's header comment).
 *
 * GH14: T92's icon tab bar (one section at a time) was unclear — both sections are
 * shown again, stacked, each collapsible. The collapsed state is persisted in
 * localStorage (UI preference, shared by all projects) and a section is forced
 * open when it holds the active item. When both are expanded, a horizontal splitter
 * between them sets their height ratio (persisted too; double-click resets 50/50).
 *
 * Clicking a saved query opens the Requêtes view with it loaded; clicking a
 * dashboard opens the Dashboard view (T77.md § Panneau latéral).
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'
import { ReorderableSidebarSection } from './ReorderableSidebarSection'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import type { Dashboard, SavedQuery } from '@polenta/types'

interface Collapsed {
  dashboards: boolean
  queries: boolean
}

const COLLAPSED_KEY = 'polenta:suiviCollapsed'
const DEFAULT_COLLAPSED: Collapsed = { dashboards: false, queries: false }

function readCollapsed(): Collapsed {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? 'null')
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Partial<Record<keyof Collapsed, unknown>>
      return { dashboards: p.dashboards === true, queries: p.queries === true }
    }
  } catch {
    // Valeur illisible — on retombe sur les deux sections dépliées.
  }
  return DEFAULT_COLLAPSED
}

const SPLIT_KEY = 'polenta:suiviSplit'
const SPLIT_DEFAULT = 0.5
/** Minimum height (px) kept for each section while dragging the splitter — header +
 *  filter + the list's own 64px minimum, so a section never overflows into the other. */
const SPLIT_MIN_PX = 140

/** Share of the two-section area given to Dashboards (Requêtes gets the rest). */
function readSplit(): number {
  try {
    const parsed = parseFloat(localStorage.getItem(SPLIT_KEY) ?? '')
    if (parsed > 0 && parsed < 1) return parsed
  } catch {
    // Valeur illisible — partage 50/50.
  }
  return SPLIT_DEFAULT
}

interface Props {
  currentProjectId: string
  projectId: string
}

/** Text used for filtering: title + a rough serialization of the query content. */
function queryFilterText(q: SavedQuery): string {
  const content = q.mode === 'sql' ? (q.sqlText ?? '') : JSON.stringify(q.builderConfig ?? {})
  return `${q.title} ${content}`.toLowerCase()
}

function dashboardFilterText(d: Dashboard): string {
  return d.title.toLowerCase()
}

export function DashboardPanel({ currentProjectId, projectId }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { searchStr } = useRouterState({ select: (s) => ({ searchStr: s.location.searchStr }) })
  const params = new URLSearchParams(searchStr ?? '')
  const activeQueryId = params.get('queryId') ?? undefined
  const activeDashboardId = params.get('dashboardId') ?? undefined

  const [newDashboardTitle, setNewDashboardTitle] = useState<string | null>(null)
  const [queryDeleteError, setQueryDeleteError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Collapsed>(readCollapsed)

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed))
    } catch {
      // Préférence d'affichage non persistée — sans conséquence.
    }
  }, [collapsed])

  function toggleCollapsed(section: keyof Collapsed) {
    setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // ── Splitter Dashboards / Requêtes (both expanded only) ─────────────────────
  const [split, setSplit] = useState<number>(readSplit)
  const sectionsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(split))
    } catch {
      // Préférence d'affichage non persistée — sans conséquence.
    }
  }, [split])

  function handleSplitMouseDown(e: ReactMouseEvent) {
    e.preventDefault()
    const container = sectionsRef.current
    if (!container) return
    const onMouseMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      if (rect.height <= 2 * SPLIT_MIN_PX) return
      const min = SPLIT_MIN_PX / rect.height
      setSplit(Math.min(1 - min, Math.max(min, (ev.clientY - rect.top) / rect.height)))
    }
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
    }
    // Keep the resize cursor while the pointer leaves the thin handle mid-drag.
    document.body.style.cursor = 'row-resize'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const bothExpanded = !collapsed.dashboards && !collapsed.queries

  const { data: project } = useQuery({
    queryKey: ['workspace', currentProjectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId)),
  })
  const repoPath = project?.localPath ?? ''

  const { data: identityLogin, isError: identityError } = useQuery({
    queryKey: ['project-username', repoPath],
    queryFn: () => api.auth.projectUsername(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  // GH29 — vide tant que l'identité n'est pas résolue : les lectures (gardées par `!!username`)
  // attendent, rien n'est lu ni écrit sous `local` par erreur.
  const username = identityLogin ?? (identityError ? 'local' : '')

  // ── Requêtes ─────────────────────────────────────────────────────────────────

  const { data: queries = [], isLoading: queriesLoading } = useQuery({
    queryKey: ['queries', repoPath, username],
    queryFn: () => api.queries.list(repoPath, username),
    enabled: !!repoPath && !!username,
  })

  const { data: queriesOrder = [] } = useQuery({
    queryKey: ['queries-order', repoPath, username],
    queryFn: () => api.queries.getOrder(repoPath, username),
    enabled: !!repoPath && !!username,
  })

  const queriesOrderMutation = useMutation({
    mutationFn: (order: string[]) => api.queries.setOrder(repoPath, username, order),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queries-order', repoPath, username] }),
  })

  const deleteQueryMutation = useMutation({
    mutationFn: (id: string) => api.queries.delete(repoPath, username, id),
    onSuccess: () => {
      setQueryDeleteError(null)
      qc.invalidateQueries({ queryKey: ['queries', repoPath, username] })
    },
    onError: (err) => setQueryDeleteError(err instanceof Error ? err.message : t('sidebar.dashboard.deleteFailed')),
  })

  function openQuery(id?: string) {
    navigate({ to: '/query', search: { projectId, queryId: id } })
  }

  // ── Dashboards ───────────────────────────────────────────────────────────────

  const { data: dashboards = [], isLoading: dashboardsLoading } = useQuery({
    queryKey: ['dashboards', repoPath, username],
    queryFn: () => api.dashboards.list(repoPath, username),
    enabled: !!repoPath && !!username,
  })

  const { data: dashboardsOrder = [] } = useQuery({
    queryKey: ['dashboards-order', repoPath, username],
    queryFn: () => api.dashboards.getOrder(repoPath, username),
    enabled: !!repoPath && !!username,
  })

  const dashboardsOrderMutation = useMutation({
    mutationFn: (order: string[]) => api.dashboards.setOrder(repoPath, username, order),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards-order', repoPath, username] }),
  })

  const deleteDashboardMutation = useMutation({
    mutationFn: (id: string) => api.dashboards.delete(repoPath, username, id),
    onSuccess: (_void, id) => {
      // T109: quand le dashboard actif est supprimé, `dashboard.tsx` lit ce même
      // cache pour rediriger vers le "premier" restant dès que `dashboardId` devient
      // undefined ci-dessous. `invalidateQueries` seul ne fait que planifier un
      // refetch asynchrone — la mise à jour synchrone du cache évite qu'il lise la
      // liste périmée (encore avec l'id qu'on vient de supprimer) et se redirige
      // dessus.
      qc.setQueryData<Dashboard[]>(['dashboards', repoPath, username], (old) => old?.filter((d) => d.id !== id) ?? [])
      qc.invalidateQueries({ queryKey: ['dashboards', repoPath, username] })
      if (activeDashboardId === id) navigate({ to: '/dashboard', search: { projectId, dashboardId: undefined } })
    },
  })

  const createDashboardMutation = useMutation({
    mutationFn: (title: string) => api.dashboards.create(repoPath, username, { title, scope: 'private', createdBy: username }),
    onSuccess: (created) => {
      setNewDashboardTitle(null)
      qc.invalidateQueries({ queryKey: ['dashboards', repoPath, username] })
      navigate({ to: '/dashboard', search: { projectId, dashboardId: created.id } })
    },
  })

  // A section holding the active item (URL, freshly saved query, "+"…) is forced
  // open so the highlighted item is visible. Only when the id really is one of its
  // items: a history entry also opens /query with a `queryId` — not a saved query,
  // nothing to highlight, so the user's collapsed choice is left alone. Keyed on
  // booleans (not the lists) so a mere refetch doesn't reopen a section the user
  // just collapsed.
  const activeQueryListed = !!activeQueryId && queries.some((q) => q.id === activeQueryId)
  const activeDashboardListed = !!activeDashboardId && dashboards.some((d) => d.id === activeDashboardId)
  useEffect(() => {
    setCollapsed((prev) => {
      const next = {
        dashboards: activeDashboardListed ? false : prev.dashboards,
        queries: activeQueryListed ? false : prev.queries,
      }
      return next.dashboards === prev.dashboards && next.queries === prev.queries ? prev : next
    })
  }, [activeQueryId, activeDashboardId, activeQueryListed, activeDashboardListed])

  function openDashboard(id: string) {
    navigate({ to: '/dashboard', search: { projectId, dashboardId: id } })
  }

  useModalHotkeys(
    () => setNewDashboardTitle(null),
    () => newDashboardTitle?.trim() && createDashboardMutation.mutate(newDashboardTitle.trim()),
    newDashboardTitle === null || createDashboardMutation.isPending,
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header (T92 — cohérent avec les autres panneaux latéraux) ── */}
      <div className="px-4 py-3 border-b border-edge shrink-0">
        <p className="section-label">{t('sidebar.dashboard.title')}</p>
      </div>

      <div ref={sectionsRef} className="flex-1 min-h-0 flex flex-col">
        <ReorderableSidebarSection
          label={t('sidebar.dashboard.dashboardsLabel')}
          items={dashboards}
          order={dashboardsOrder}
          activeId={activeDashboardId}
          filterText={dashboardFilterText}
          onReorder={(order) => dashboardsOrderMutation.mutate(order)}
          onSelect={(d) => openDashboard(d.id)}
          onDelete={(d) => deleteDashboardMutation.mutate(d.id)}
          onAdd={() => setNewDashboardTitle('')}
          emptyMessage={t('sidebar.dashboard.noDashboards')}
          addTitle={t('sidebar.dashboard.addDashboard')}
          addFirstLabel={t('sidebar.dashboard.createFirstDashboard')}
          isLoading={dashboardsLoading}
          collapsed={collapsed.dashboards}
          onToggleCollapsed={() => toggleCollapsed('dashboards')}
          flexGrow={bothExpanded ? split : 1}
        />

        {bothExpanded && (
          <div
            role="separator"
            aria-orientation="horizontal"
            onMouseDown={handleSplitMouseDown}
            onDoubleClick={() => setSplit(SPLIT_DEFAULT)}
            className="h-1 -mt-px shrink-0 cursor-row-resize hover:bg-status-info-solid transition-colors"
          />
        )}

        <ReorderableSidebarSection
          label={t('sidebar.dashboard.queriesLabel')}
          items={queries}
          order={queriesOrder}
          activeId={activeQueryId}
          filterText={queryFilterText}
          onReorder={(order) => queriesOrderMutation.mutate(order)}
          onSelect={(q) => openQuery(q.id)}
          onDelete={(q) => deleteQueryMutation.mutate(q.id)}
          onAdd={() => openQuery(undefined)}
          emptyMessage={t('sidebar.dashboard.noQueries')}
          addTitle={t('sidebar.dashboard.addQuery')}
          addFirstLabel={t('sidebar.dashboard.createFirstQuery')}
          isLoading={queriesLoading}
          deleteError={queryDeleteError}
          collapsed={collapsed.queries}
          onToggleCollapsed={() => toggleCollapsed('queries')}
          flexGrow={bothExpanded ? 1 - split : 1}
        />
      </div>

      {newDashboardTitle !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40">
          <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="font-semibold text-sm text-ink mb-4">{t('sidebar.dashboard.newDashboardTitle')}</h2>
            <label className="text-xs text-ink-3 block mb-1">{t('sidebar.dashboard.titleLabel')}</label>
            <input
              value={newDashboardTitle}
              onChange={(e) => setNewDashboardTitle(e.target.value)}
              placeholder={t('sidebar.dashboard.titlePlaceholder')}
              autoFocus
              className="input-field w-full mb-5"
            />
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setNewDashboardTitle(null)} className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => newDashboardTitle.trim() && createDashboardMutation.mutate(newDashboardTitle.trim())}
                disabled={!newDashboardTitle.trim() || createDashboardMutation.isPending}
                className="btn-primary"
              >
                {createDashboardMutation.isPending ? t('sidebar.dashboard.creating') : t('sidebar.dashboard.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
