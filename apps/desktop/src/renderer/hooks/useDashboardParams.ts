import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Dashboard, DashboardSelector, GraphParamValue, QueryParameterDef, SavedQuery, Widget } from '@polenta/types'
import { dashboardSelectors, labelText, paramsForQuery, paramValueText } from '@polenta/types'
import { api } from '../api'
import { orderItems } from '../components/sidebar/ReorderableSidebarSection'
import { useCampaignOptions, useSuiviObjectTypes } from './useSuiviCatalog'
import { effectiveValues, missingRequired, optionTitle, storedChoices } from '../lib/suiviParamValues'
import type { ParamOptions } from '../lib/suiviParamValues'

/**
 * GH93 — barre de paramètres d'un dashboard : sélecteurs (regroupés par `name:kind` sur les requêtes
 * des widgets), valeurs choisies par l'utilisateur (`.pref`, canaux `dashboards:param-values-*`),
 * valeurs effectives et valeurs à passer à chaque widget.
 */
export function useDashboardParams(args: {
  repoPath: string
  workspaceDir: string
  username: string
  dashboard: Dashboard | null | undefined
  savedQueries: SavedQuery[]
  locale: 'fr' | 'en'
}) {
  const { repoPath, workspaceDir, username, dashboard, savedQueries, locale } = args
  const qc = useQueryClient()
  const dashboardId = dashboard?.id ?? ''

  const declsOf = useCallback(
    (queryId: string): QueryParameterDef[] | undefined => savedQueries.find((q) => q.id === queryId)?.parameters,
    [savedQueries],
  )
  const selectors = useMemo<DashboardSelector[]>(
    () => (dashboard ? dashboardSelectors(orderItems(dashboard.widgets, dashboard.widgetOrder), declsOf) : []),
    [dashboard, declsOf],
  )
  const kinds = new Set(selectors.map((s) => s.kind))

  // Options : chargées seulement si un sélecteur en a besoin.
  const needsCampaigns = kinds.has('campaign')
  const needsTypes = kinds.has('component') || kinds.has('objectType')
  const campaignsQuery = useCampaignOptions(needsCampaigns ? repoPath : '')
  const typesQuery = useSuiviObjectTypes(needsTypes ? repoPath : '', workspaceDir)
  const campaigns = campaignsQuery.data
  const objectTypes = typesQuery.data
  const options = useMemo<ParamOptions>(() => ({
    campaigns,
    components: objectTypes ? [...new Set(objectTypes.map((t) => t.component))].sort() : undefined,
    objectTypes,
  }), [campaigns, objectTypes])

  const storedKey = ['dashboard-param-values', repoPath, username, dashboardId]
  const stored = useQuery({
    queryKey: storedKey,
    queryFn: () => api.dashboards.getParamValues(repoPath, username, dashboardId),
    enabled: !!repoPath && !!username && !!dashboardId && selectors.length > 0,
  })
  const storedValues = useMemo(() => stored.data ?? {}, [stored.data])
  const { values, invalid } = useMemo(() => effectiveValues(selectors, storedValues, options), [selectors, storedValues, options])

  /** Choix et listes d'options lus (sinon les widgets s'exécuteraient deux fois : défauts ou valeur
   *  devenue introuvable, puis valeurs effectives). Une liste en erreur ne bloque pas. */
  const settled = (q: { isSuccess: boolean; isError: boolean }) => q.isSuccess || q.isError
  const ready = selectors.length === 0 || (settled(stored) && (!needsCampaigns || settled(campaignsQuery)) && (!needsTypes || settled(typesQuery)))

  const write = (next: Record<string, GraphParamValue> | null) => {
    qc.setQueryData(storedKey, next ?? {})
    api.dashboards.setParamValues(repoPath, username, dashboardId, next)
      .catch(() => qc.invalidateQueries({ queryKey: storedKey }))
  }

  return {
    selectors,
    values,
    invalid,
    options,
    ready,
    /** Valeurs passées à la requête d'un widget. */
    paramsFor: (widget: Pick<Widget, 'queryId'>) => paramsForQuery(declsOf(widget.queryId), values),
    /** Paramètres obligatoires sans valeur : le widget attend un choix au lieu de s'exécuter. */
    missingFor: (widget: Pick<Widget, 'queryId'>) => missingRequired(declsOf(widget.queryId), values, locale),
    setValue: (key: string, value: GraphParamValue) => write(storedChoices(selectors, storedValues, key, value)),
    reset: () => write(null),
    /** Valeurs lisibles (impression, export docx). */
    describe: () => selectors.map((s) => ({
      label: labelText(s.label, locale),
      value: paramValueText(s, values[s.key] ?? null, locale, (kind, v) => optionTitle(options, kind, v)),
    })),
  }
}

export type DashboardParams = ReturnType<typeof useDashboardParams>
