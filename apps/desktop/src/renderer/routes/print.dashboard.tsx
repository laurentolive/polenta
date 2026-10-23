import { useCallback, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { DashboardGrid } from '../components/dashboard/DashboardGrid'
import { ParamBar } from '../components/dashboard/ParamBar'
import { useDashboardParams } from '../hooks/useDashboardParams'
import { useNotifyPrintReady } from '../lib/useNotifyPrintReady'

const NOOP = () => {}

/** Route imprimable — dashboard (T43 sprint 3 ; GH74 : rendu Vega en SVG). Réutilise `DashboardGrid`
 *  en `printMode`. Prêt à imprimer quand chaque widget dont la requête existe a signalé la fin de son
 *  rendu (`onWidgetRendered` : graphe Vega dessiné, vue native, état vide ou erreur) ; un widget sans
 *  requête affiche « Requête introuvable » de façon synchrone et n'est pas attendu. */
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
  const { t, i18n } = useTranslation()
  const { repoPath, workspaceDir, username, dashboardId } = Route.useSearch()
  const [rendered, setRendered] = useState<ReadonlySet<string>>(new Set())
  const onWidgetRendered = useCallback((id: string) => {
    setRendered((prev) => (prev.has(id) ? prev : new Set([...prev, id])))
  }, [])

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

  // GH93 — valeurs choisies par l'utilisateur dans la barre (lues dans son .pref).
  const params = useDashboardParams({
    repoPath, workspaceDir, username, dashboard, savedQueries, locale: i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'fr',
  })

  const awaited = (dashboard?.widgets ?? []).filter((w) => savedQueries.some((q) => q.id === w.queryId))
  useNotifyPrintReady(dashboardLoaded && queriesLoaded && awaited.every((w) => rendered.has(w.id)))

  if (!dashboard) return <div className="p-10 bg-print-bg min-h-screen" />

  return (
    <div className="p-10 bg-print-bg text-print-ink text-sm min-h-screen">
      <h1 className="text-xl font-semibold mb-4">{t('printDashboardPage.title', { title: dashboard.title })}</h1>
      <ParamBar selectors={params.selectors} values={params.values} options={params.options} onChange={NOOP} printMode />
      <DashboardGrid
        dashboard={dashboard}
        savedQueries={savedQueries}
        repoPath={repoPath}
        workspaceDir={workspaceDir}
        username={username}
        onReorder={NOOP}
        onDeleteWidget={NOOP}
        onEditWidget={NOOP}
        printMode
        onWidgetRendered={onWidgetRendered}
        paramsFor={params.paramsFor}
        missingFor={params.missingFor}
        paramsReady={params.ready}
      />
    </div>
  )
}
