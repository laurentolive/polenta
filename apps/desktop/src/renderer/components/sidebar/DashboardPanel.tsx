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
 * T92: the two sections used to be stacked (each capped at 50% height). Now shown
 * one at a time behind an icon tab bar (same small-icon-button style as
 * VersionPanel's header) so whichever list you're using gets the full height.
 *
 * Clicking a saved query opens the Requêtes view with it loaded; clicking a
 * dashboard opens the Dashboard view (T77.md § Panneau latéral).
 */
import { useEffect, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PieChart, Search as SearchIcon } from 'lucide-react'
import { api } from '../../api'
import { decodeProjectId } from '../../lib/projectId'
import { ReorderableSidebarSection } from './ReorderableSidebarSection'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import type { Dashboard, SavedQuery } from '@polenta/types'

type Tab = 'dashboards' | 'queries'

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
  const [activeTab, setActiveTab] = useState<Tab>(activeQueryId ? 'queries' : 'dashboards')

  // Keep the tab bar in sync with whichever view is actually open (e.g. navigating
  // straight to /query, or selecting a dashboard while the "Requêtes" tab is active).
  useEffect(() => {
    if (activeQueryId) setActiveTab('queries')
    else if (activeDashboardId) setActiveTab('dashboards')
  }, [activeQueryId, activeDashboardId])

  const { data: project } = useQuery({
    queryKey: ['workspace', currentProjectId],
    queryFn: () => api.workspace.resolve(decodeProjectId(currentProjectId)),
  })
  const repoPath = project?.localPath ?? ''

  const { data: identity } = useQuery({
    queryKey: ['identity', repoPath],
    queryFn: () => api.auth.resolveIdentity(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  const username = identity?.login ?? 'local'

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
      <div className="px-4 py-3 border-b border-edge shrink-0 flex items-center justify-between">
        <p className="section-label">{t('sidebar.dashboard.title')}</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('dashboards')}
            className={`p-1 rounded transition-colors ${
              activeTab === 'dashboards' ? 'bg-hover text-prim' : 'text-ink-3 hover:bg-hover hover:text-prim'
            }`}
            title={t('sidebar.dashboard.dashboardsTab')}
          >
            <PieChart size={14} />
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('queries')}
            className={`p-1 rounded transition-colors ${
              activeTab === 'queries' ? 'bg-hover text-prim' : 'text-ink-3 hover:bg-hover hover:text-prim'
            }`}
            title={t('sidebar.dashboard.queriesTab')}
          >
            <SearchIcon size={14} />
          </button>
        </div>
      </div>

      {activeTab === 'dashboards' ? (
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
          fillHeight
        />
      ) : (
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
          fillHeight
        />
      )}

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
