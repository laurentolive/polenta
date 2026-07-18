import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueries } from '@tanstack/react-query'
import { api } from '../api'
import { widgetQueryOptions } from '../hooks/useQueryResult'
import { DashboardGrid } from '../components/dashboard/DashboardGrid'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'

const NOOP = () => {}

/** Route imprimable — dashboard (T43 sprint 3). Réutilise `DashboardGrid` en `printMode` (garde le
 *  rendu réel des widgets, y compris les graphiques Recharts, plutôt que de le reconstruire — même
 *  décision structurante que les autres routes `/print/*`). La difficulté propre à cette route :
 *  savoir quand TOUS les widgets ont fini de charger avant d'imprimer, alors que chaque widget
 *  exécute sa propre requête en interne (`DashboardGrid`/`useQueryResult`) sans remonter d'état de
 *  chargement global au parent. Résolu en exécutant ici, en parallèle, les mêmes requêtes via
 *  `useQueries` + `widgetQueryOptions` (même `queryKey` que `useQueryResult` → react-query
 *  dédoublonne l'appel réseau/IPC, pas de double exécution) uniquement pour observer leur état. */
export const Route = createFileRoute('/print/dashboard')({
  component: PrintDashboardPage,
  validateSearch: (s: Record<string, unknown>) => ({
    repoPath: (s['repoPath'] as string) ?? '',
    workspaceDir: (s['workspaceDir'] as string) ?? '',
    username: (s['username'] as string) ?? 'local',
    dashboardId: (s['dashboardId'] as string) ?? '',
  }),
})

function PrintDashboardPage() {
  const { repoPath, workspaceDir, username, dashboardId } = Route.useSearch()

  const { data: dashboard, isSuccess: dashboardLoaded } = useQuery({
    queryKey: ['print-dashboard', repoPath, username, dashboardId],
    queryFn: () => api.dashboards.get(repoPath, username, dashboardId),
    enabled: !!repoPath && !!username && !!dashboardId,
  })
  const { data: savedQueries = [], isSuccess: queriesLoaded } = useQuery({
    queryKey: ['print-queries', repoPath, username],
    queryFn: () => api.queries.list(repoPath, username),
    enabled: !!repoPath && !!username,
  })

  // Seulement les widgets dont la `SavedQuery` existe encore : `widgetQueryOptions` désactive la
  // requête (`enabled: false`) quand `query` est introuvable (référence supprimée), et une requête
  // react-query désactivée reste indéfiniment `status: 'pending'` — ni `isSuccess` ni `isError`,
  // donc jamais "réglée". Un widget sans `SavedQuery` associée se rend de façon synchrone
  // (`DashboardGrid` affiche directement "Requête introuvable"), inutile de l'attendre ici (bug
  // trouvé en revue de code : sans ce filtre, un seul widget cassé bloquait l'export PDF jusqu'au
  // timeout de 20s).
  const resolvableWidgets = (dashboard?.widgets ?? []).filter(w => savedQueries.some(q => q.id === w.queryId))
  const widgetQueries = useQueries({
    queries: resolvableWidgets.map(w =>
      widgetQueryOptions(repoPath, workspaceDir, savedQueries.find(q => q.id === w.queryId)),
    ),
  })
  const widgetsSettled = widgetQueries.every(q => q.isSuccess || q.isError)

  useNotifyPrintReady(dashboardLoaded && queriesLoaded && widgetsSettled)

  if (!dashboard) return <div className="p-10 bg-white min-h-screen" />

  return (
    <div className="p-10 bg-white text-slate-900 text-sm min-h-screen">
      <h1 className="text-xl font-semibold mb-4">Dashboard — {dashboard.title}</h1>
      <DashboardGrid
        dashboard={dashboard}
        savedQueries={savedQueries}
        repoPath={repoPath}
        workspaceDir={workspaceDir}
        onReorder={NOOP}
        onDeleteWidget={NOOP}
        onEditWidget={NOOP}
        printMode
      />
    </div>
  )
}
