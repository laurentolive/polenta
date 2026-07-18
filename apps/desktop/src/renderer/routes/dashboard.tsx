/**
 * DashboardPage — "Vue Dashboard" (T77 sprint 2).
 *
 * Title (inline editable), scope toggle (privé/partagé — blocked with an explicit
 * message when a widget still references a private query), "Ajouter un widget"
 * button opening `WidgetConfigModal`, and the widget grid (`DashboardGrid`).
 *
 * URL: /dashboard?projectId=<encoded>&dashboardId=<id?>
 *
 * Unlike `/query` (sprint 1), a Dashboard always exists server-side with an id
 * before this route is useful — `DashboardPanel.tsx`'s "Ajouter" prompts for a
 * title, creates the dashboard immediately, then navigates here with its id
 * (T77-tests.md scenario 7). `dashboardId` absent here (app startup via last-opened
 * project, or the active dashboard was just deleted) redirects to the first
 * dashboard in sidebar order (T109) — only the fully-empty project falls back to a
 * prompt to create one.
 */
import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus, Users2 } from 'lucide-react'
import type { Widget, QueryResult } from '@polenta/types'
import { api } from '../api'
import { decodeProjectId } from '../lib/projectId'
import { DashboardGrid } from '../components/dashboard/DashboardGrid'
import { WidgetConfigModal, type WidgetConfigResult } from '../components/dashboard/WidgetConfigModal'
import { ViewHeader } from '../components/layout/ViewHeader'
import { ExportButton } from '../components/export/ExportButton'
import { dashboardExportBaseName } from '../components/export/exportFilenames'
import { widgetQueryOptions } from '../hooks/useQueryResult'
import { useSetTabTitle } from '../contexts/TabsContext'
import { orderItems } from '../components/sidebar/ReorderableSidebarSection'

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: (s['projectId'] as string) ?? '',
    dashboardId: (s['dashboardId'] as string | undefined) ?? undefined,
  }),
})

function DashboardPage() {
  const { projectId, dashboardId } = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const workspaceDir = decodeProjectId(projectId)

  const { data: project } = useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => api.workspace.resolve(workspaceDir),
    enabled: !!projectId,
  })
  const repoPath = project?.localPath ?? ''

  const { data: identity } = useQuery({
    queryKey: ['identity', repoPath],
    queryFn: () => api.auth.resolveIdentity(repoPath),
    enabled: !!repoPath,
    retry: false,
  })
  const username = identity?.login ?? 'local'

  const dashboardQueryKey = ['dashboard', repoPath, username, dashboardId]
  const { data: dashboard, isLoading } = useQuery({
    queryKey: dashboardQueryKey,
    queryFn: () => api.dashboards.get(repoPath, username, dashboardId!),
    enabled: !!repoPath && !!username && !!dashboardId,
  })
  useSetTabTitle(dashboard?.title)

  const { data: savedQueries = [] } = useQuery({
    queryKey: ['queries', repoPath, username],
    queryFn: () => api.queries.list(repoPath, username),
    enabled: !!repoPath && !!username,
  })

  // T109: `dashboardId` absent — need the sidebar's own list/order (same queryKey,
  // shared cache with `DashboardPanel.tsx`) to redirect to the first dashboard
  // instead of showing the "pick one" prompt. Only fetched when actually needed.
  const { data: dashboards = [], isLoading: dashboardsLoading } = useQuery({
    queryKey: ['dashboards', repoPath, username],
    queryFn: () => api.dashboards.list(repoPath, username),
    enabled: !!repoPath && !!username && !dashboardId,
  })
  const { data: dashboardsOrder = [], isLoading: dashboardsOrderLoading } = useQuery({
    queryKey: ['dashboards-order', repoPath, username],
    queryFn: () => api.dashboards.getOrder(repoPath, username),
    enabled: !!repoPath && !!username && !dashboardId,
  })
  // `!repoPath` covers the startup window before the `workspace` query resolves —
  // without it, the two queries above are `enabled: false` and report
  // `isLoading: false` (React Query v5: isLoading = isPending && isFetching), which
  // would flash the "no dashboards" message below even when some exist.
  const resolvingFirstDashboard = !repoPath || dashboardsLoading || dashboardsOrderLoading
  // Derived to a primitive (not the `dashboards`/`dashboardsOrder` arrays, which are
  // fresh `[]` literals on every render while unset) so the effect below only reruns
  // when the actual redirect target changes.
  const firstDashboardId = orderItems(dashboards, dashboardsOrder)[0]?.id

  useEffect(() => {
    if (dashboardId || resolvingFirstDashboard || !firstDashboardId) return
    navigate({ to: '/dashboard', search: { projectId, dashboardId: firstDashboardId }, replace: true })
  }, [dashboardId, resolvingFirstDashboard, firstDashboardId, projectId, navigate])

  const [titleDraft, setTitleDraft] = useState('')
  const [showAddWidget, setShowAddWidget] = useState(false)
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null)
  const [scopeError, setScopeError] = useState<string | null>(null)

  useEffect(() => {
    setTitleDraft(dashboard?.title ?? '')
    setScopeError(null)
  }, [dashboard?.id, dashboard?.title])

  const invalidateDashboard = () => {
    qc.invalidateQueries({ queryKey: dashboardQueryKey })
    qc.invalidateQueries({ queryKey: ['dashboards', repoPath, username] })
  }

  const renameMutation = useMutation({
    mutationFn: (title: string) => api.dashboards.update(repoPath, username, dashboardId!, { title }),
    onSuccess: invalidateDashboard,
  })

  const scopeMutation = useMutation({
    mutationFn: (scope: 'private' | 'shared') => api.dashboards.setScope(repoPath, username, dashboardId!, scope),
    onSuccess: (updated) => {
      setScopeError(null)
      qc.invalidateQueries({ queryKey: ['dashboards', repoPath, username] })
      // L'id change lors d'un passage privé<->partagé (schémas d'id différents) —
      // on préremplit le cache sous le nouvel id puis on aligne l'URL dessus, sans
      // quoi la prochaine lecture (repoPath/username/dashboardId) pointerait sur
      // l'ancien id qui n'existe plus.
      qc.setQueryData(['dashboard', repoPath, username, updated.id], updated)
      if (updated.id !== dashboardId) {
        navigate({ to: '/dashboard', search: { projectId, dashboardId: updated.id }, replace: true })
      }
    },
    onError: (err) => setScopeError(err instanceof Error ? err.message : 'Impossible de changer la portée.'),
  })

  const addWidgetMutation = useMutation({
    mutationFn: (dto: WidgetConfigResult) => api.dashboards.addWidget(repoPath, username, dashboardId!, dto),
    onSuccess: () => {
      invalidateDashboard()
      setShowAddWidget(false)
    },
  })

  const updateWidgetMutation = useMutation({
    mutationFn: (dto: WidgetConfigResult) =>
      api.dashboards.updateWidget(repoPath, username, dashboardId!, editingWidget!.id, dto),
    onSuccess: () => {
      invalidateDashboard()
      setEditingWidget(null)
    },
  })

  const reorderMutation = useMutation({
    mutationFn: (order: string[]) => api.dashboards.setWidgetOrder(repoPath, username, dashboardId!, order),
    onSuccess: invalidateDashboard,
  })

  const deleteWidgetMutation = useMutation({
    mutationFn: (widgetId: string) => api.dashboards.deleteWidget(repoPath, username, dashboardId!, widgetId),
    onSuccess: invalidateDashboard,
  })

  if (!projectId) return <p className="text-sm text-ink-3 p-4">Projet non chargé.</p>

  if (!dashboardId) {
    // Deux cas rendent le même "Chargement…" : la résolution des requêtes n'est pas
    // terminée, ou elle l'est et un premier dashboard existe — l'effet ci-dessus est
    // en train de rediriger. Le message d'invite ne s'affiche que si on sait déjà,
    // de façon certaine, qu'aucun dashboard n'existe.
    if (resolvingFirstDashboard || firstDashboardId) return <p className="text-sm text-ink-3 p-4">Chargement…</p>
    return (
      <div className="max-w-5xl p-6">
        <p className="text-sm text-ink-3">
          Sélectionnez un dashboard dans le panneau latéral, ou créez-en un avec le bouton "+".
        </p>
      </div>
    )
  }

  if (isLoading) return <p className="text-sm text-ink-3 p-4">Chargement…</p>
  if (!dashboard) return <p className="text-sm text-ink-3 p-4">Dashboard introuvable.</p>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViewHeader
        currentProjectId={projectId}
        title={
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              const trimmed = titleDraft.trim()
              if (trimmed && trimmed !== dashboard.title) renameMutation.mutate(trimmed)
              else setTitleDraft(dashboard.title)
            }}
            className="text-sm font-semibold text-ink bg-transparent border-0 outline-none focus:ring-2 focus:ring-blue-400/30 rounded px-1 -mx-1 w-full"
          />
        }
        actions={
          <>
            <div className="flex rounded-lg border border-edge overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => scopeMutation.mutate('private')}
                disabled={scopeMutation.isPending}
                className={`px-3 py-1.5 flex items-center gap-1.5 ${dashboard.scope === 'private' ? 'bg-blue-600 text-white' : 'text-ink-2 hover:bg-hover'}`}
              >
                <Lock size={11} /> Privé
              </button>
              <button
                type="button"
                onClick={() => scopeMutation.mutate('shared')}
                disabled={scopeMutation.isPending}
                className={`px-3 py-1.5 flex items-center gap-1.5 ${dashboard.scope === 'shared' ? 'bg-blue-600 text-white' : 'text-ink-2 hover:bg-hover'}`}
              >
                <Users2 size={11} /> Partagé
              </button>
            </div>
            <button type="button" onClick={() => setShowAddWidget(true)} className="btn-primary text-xs flex items-center gap-1.5">
              <Plus size={12} />
              Ajouter un widget
            </button>
            <ExportButton
              kind="dashboard"
              formats={['docx', 'pdf']}
              repoPath={repoPath}
              getSuggestedBaseName={() => dashboardExportBaseName(dashboard.title)}
              getPayload={async () => {
                // `qc.fetchQuery` + `widgetQueryOptions` (même queryKey que `DashboardGrid`/
                // `useQueryResult`) plutôt que ré-exécuter chaque requête à la main : réutilise le
                // cache déjà chaud si le dashboard vient d'être affiché, au lieu de refaire N
                // appels IPC redondants et de risquer un résultat différent de ce qui est
                // actuellement visible à l'écran (constat de revue de code).
                //
                // Chaque widget est indépendant (`try/catch` par widget, pas de `Promise.all` qui
                // ferait échouer tout l'export sur un seul widget cassé) — cohérent avec le
                // comportement déjà à l'écran (`DashboardGrid` affiche un widget en erreur sans
                // faire planter les autres, cf. specs/T43-tests.md "widget en erreur") et avec
                // `dashboard.docx.ts`, qui affiche "Aucune donnée." pour un widget absent du payload.
                const widgetResults: Record<string, QueryResult> = {}
                await Promise.all(dashboard.widgets.map(async (w) => {
                  const q = savedQueries.find(sq => sq.id === w.queryId)
                  if (!q) return
                  try {
                    widgetResults[w.id] = await qc.fetchQuery(widgetQueryOptions(repoPath, workspaceDir, q))
                  } catch {
                    // Widget en erreur (ex. requête invalide, type d'objet supprimé) — omis du
                    // payload plutôt que de faire échouer tout l'export.
                  }
                }))
                return { dashboard, widgetResults }
              }}
              getPrintParams={() => ({ repoPath, workspaceDir, username, dashboardId: dashboardId! })}
            />
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl p-6 pb-16 space-y-5">
      {scopeError && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/60 rounded px-3 py-2">
          {scopeError}
        </p>
      )}

      <DashboardGrid
        dashboard={dashboard}
        savedQueries={savedQueries}
        repoPath={repoPath}
        workspaceDir={workspaceDir}
        onReorder={(order) => reorderMutation.mutate(order)}
        onDeleteWidget={(widgetId) => deleteWidgetMutation.mutate(widgetId)}
        onEditWidget={(widget) => setEditingWidget(widget)}
      />

      {showAddWidget && (
        <WidgetConfigModal
          dashboardScope={dashboard.scope}
          savedQueries={savedQueries}
          repoPath={repoPath}
          workspaceDir={workspaceDir}
          onSave={(dto) => addWidgetMutation.mutate(dto)}
          onClose={() => setShowAddWidget(false)}
          saving={addWidgetMutation.isPending}
          error={addWidgetMutation.error instanceof Error ? addWidgetMutation.error.message : null}
        />
      )}

      {editingWidget && (
        <WidgetConfigModal
          dashboardScope={dashboard.scope}
          savedQueries={savedQueries}
          repoPath={repoPath}
          workspaceDir={workspaceDir}
          initialWidget={editingWidget}
          onSave={(dto) => updateWidgetMutation.mutate(dto)}
          onClose={() => setEditingWidget(null)}
          saving={updateWidgetMutation.isPending}
          error={updateWidgetMutation.error instanceof Error ? updateWidgetMutation.error.message : null}
        />
      )}
      </div>
      </div>
    </div>
  )
}
