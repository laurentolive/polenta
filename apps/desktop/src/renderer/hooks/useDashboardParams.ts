import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Dashboard, DashboardSelector, GraphParamValue, QueryParameterDef, SavedQuery, Widget, WidgetParamValues } from '@polenta/types'
import { labelText, paramsForQuery, paramValueText, widgetSelectors } from '@polenta/types'
import { api } from '../api'
import { useCampaignOptions, useSuiviObjectTypes } from './useSuiviCatalog'
import { differsFromDefault, effectiveValues, missingRequired, optionTitle, storedChoices } from '../lib/suiviParamValues'
import type { ParamOptions } from '../lib/suiviParamValues'

/** Paramètres d'un widget : sélecteurs de son en-tête, valeurs appliquées, actions. */
export interface WidgetParams {
  selectors: DashboardSelector[]
  /** Valeur appliquée par sélecteur (clé `name:kind`). */
  values: Record<string, GraphParamValue>
  /** Valeurs choisies devenues introuvables (clé → valeur brute). */
  invalid: Record<string, string>
  /** Valeurs passées à la requête du widget. */
  params: Record<string, GraphParamValue>
  /** Paramètres obligatoires sans valeur : le widget attend un choix au lieu de s'exécuter. */
  missing: string[]
  /** D1 — « Réinitialiser » proposé (une valeur hors défaut, ou introuvable). */
  canReset: boolean
  setValue: (key: string, value: GraphParamValue) => void
  reset: () => void
  /** Valeurs lisibles (impression, export docx). */
  describe: () => { label: string; value: string }[]
}

/**
 * GH125 — paramètres choisis à l'affichage, **par widget** : un sélecteur par paramètre déclaré par
 * la requête du widget, valeurs propres au widget mémorisées par l'utilisateur (`.pref`, canaux
 * `dashboards:param-values-*`, clé dashboard + widget). Plus de regroupement entre widgets (GH93).
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
  const kinds = useMemo(() => {
    const out = new Set<string>()
    for (const w of dashboard?.widgets ?? []) for (const d of declsOf(w.queryId) ?? []) out.add(d.kind)
    return out
  }, [dashboard, declsOf])
  const hasParams = kinds.size > 0

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

  // Une seule lecture pour tout le dashboard : `ready` global, une exécution par widget au chargement.
  const storedKey = ['dashboard-param-values', repoPath, username, dashboardId]
  const stored = useQuery({
    queryKey: storedKey,
    queryFn: () => api.dashboards.getParamValues(repoPath, username, dashboardId),
    enabled: !!repoPath && !!username && !!dashboardId && hasParams,
  })
  const storedAll = useMemo<WidgetParamValues>(() => stored.data ?? {}, [stored.data])

  /** Choix et listes d'options lus (sinon les widgets s'exécuteraient deux fois : défauts ou valeur
   *  devenue introuvable, puis valeurs effectives). Une liste en erreur ne bloque pas. */
  const settled = (q: { isSuccess: boolean; isError: boolean }) => q.isSuccess || q.isError
  const ready = !hasParams || (settled(stored) && (!needsCampaigns || settled(campaignsQuery)) && (!needsTypes || settled(typesQuery)))

  const write = (widgetId: string, next: Record<string, GraphParamValue> | null) => {
    qc.setQueryData<WidgetParamValues>(storedKey, (prev) => {
      const all = { ...(prev ?? {}) }
      if (next && Object.keys(next).length) all[widgetId] = next
      else delete all[widgetId]
      return all
    })
    api.dashboards.setParamValues(repoPath, username, dashboardId, widgetId, next)
      .catch(() => qc.invalidateQueries({ queryKey: storedKey }))
  }

  const computeWidget = (widget: Pick<Widget, 'id' | 'queryId'>): WidgetParams => {
    const decls = declsOf(widget.queryId)
    const selectors = widgetSelectors(widget.id, decls)
    const own = storedAll[widget.id] ?? {}
    const eff = effectiveValues(selectors, own, options)
    return {
      selectors,
      values: eff.values,
      invalid: eff.invalid,
      params: paramsForQuery(decls, eff.values),
      missing: missingRequired(decls, eff.values, locale),
      canReset: selectors.length > 0 && differsFromDefault(selectors, eff, options),
      setValue: (key, value) => write(widget.id, storedChoices(own, key, value)),
      // Valeurs des paramètres déclarés seulement : celles d'un `name:kind` que la requête ne déclare
      // plus restent mémorisées (elles reprennent effet si la déclaration revient).
      reset: () => {
        const kept = Object.fromEntries(Object.entries(own).filter(([k]) => !selectors.some((s) => s.key === k)))
        write(widget.id, Object.keys(kept).length ? kept : null)
      },
      describe: () => selectors.map((s) => ({
        label: labelText(s.label, locale),
        value: paramValueText(s, eff.values[s.key] ?? null, locale, (kind, v) => optionTitle(options, kind, v)),
      })),
    }
  }

  // Un calcul par widget et par changement de données (pas un par appel : grille, export, aperçu).
  const byWidget = useMemo(() => {
    const out = new Map<string, WidgetParams>()
    for (const w of dashboard?.widgets ?? []) out.set(w.id, computeWidget(w))
    return out
  }, [dashboard, declsOf, storedAll, options, locale, repoPath, username, dashboardId])
  const forWidget = (widget: Pick<Widget, 'id' | 'queryId'>): WidgetParams => {
    const cached = byWidget.get(widget.id)
    // Requête différente de celle du widget enregistré (aperçu de la modale) : calcul à la demande.
    return cached && dashboard?.widgets.find((w) => w.id === widget.id)?.queryId === widget.queryId ? cached : computeWidget(widget)
  }

  return {
    options,
    ready,
    forWidget,
    /** Valeurs passées à la requête d'un widget. */
    paramsFor: (widget: Pick<Widget, 'id' | 'queryId'>) => forWidget(widget).params,
    /** Paramètres obligatoires sans valeur d'un widget. */
    missingFor: (widget: Pick<Widget, 'id' | 'queryId'>) => forWidget(widget).missing,
    /** Aperçu de `WidgetConfigModal` : valeurs du widget modifié pour la requête choisie dans la
     *  modale ; nouveau widget → `{}` (défauts appliqués par le main). */
    paramsForEdit: (widgetId: string | undefined, queryId: string) => (widgetId ? forWidget({ id: widgetId, queryId }).params : {}),
    /** Export docx : valeurs lisibles de chaque widget paramétré. */
    describeAll: () => {
      const out: Record<string, { label: string; value: string }[]> = {}
      for (const w of dashboard?.widgets ?? []) {
        const d = forWidget(w).describe()
        if (d.length) out[w.id] = d
      }
      return out
    },
  }
}

export type DashboardParams = ReturnType<typeof useDashboardParams>
