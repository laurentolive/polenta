import type { QueryScope, Widget } from '@polenta/types'
import { findQueryTemplate, findWidgetTemplate } from '@polenta/types'

/**
 * Validation pure des tools MCP de la vue Suivi (GH18 — specs/GH18-design.md §5 ; GH74 : scripts,
 * transformations et specs Vega-Lite) : aucune I/O, les tools font les lectures et appellent ces
 * fonctions.
 */

export type SuiviErrorCode =
  | 'INVALID_INPUT'
  | 'PRIVATE_SCOPE_UNAVAILABLE'
  | 'READONLY_BRANCH'
  | 'QUERY_NOT_FOUND'
  | 'QUERY_IN_USE'
  | 'DASHBOARD_NOT_FOUND'
  | 'WIDGET_NOT_FOUND'
  | 'DUPLICATE_TITLE'
  | 'PRIVATE_QUERY_IN_SHARED_DASHBOARD'
  | 'INVALID_ORDER'
  // GH74 — scripts de données, modèles, specs, bibliothèque projet.
  | 'SCRIPT_ERROR'
  | 'INVALID_TEMPLATE'
  | 'SPEC_INVALID'
  | 'SUIVI_READ_ONLY'
  | 'LIBRARY_PATH_INVALID'
  | 'LIBRARY_MODULE_NOT_FOUND'
  // GH93 — déclaration de paramètres choisis à l'affichage invalide.
  | 'PARAMS_INVALID'
  // GH70 — déclaration de colonne calculée invalide, ou portée privée.
  | 'COLUMN_INVALID'
  | 'COLUMN_PRIVATE'

export type SuiviWarningCode = 'SCRIPT_ERROR' | 'SPEC_AGGREGATE' | 'SPEC_UNCHECKED'

export interface SuiviIssue {
  code: SuiviErrorCode
  reason: string
}

export interface SuiviWarning {
  code: SuiviWarningCode
  reason: string
  dashboardId?: string
  widgetId?: string
}

export function normalizeTitle(title: string): string {
  return title.trim().toLocaleLowerCase()
}

/** Premier objet du même scope portant le même titre (casse et espaces de bord ignorés). */
export function findDuplicateTitle<T extends { id: string; title: string; scope: QueryScope }>(
  items: readonly T[],
  title: string,
  scope: QueryScope,
  excludeId?: string,
): T | null {
  const wanted = normalizeTitle(title)
  return items.find((i) => i.id !== excludeId && i.scope === scope && normalizeTitle(i.title) === wanted) ?? null
}

/** Modèle connu et paramètres requis renseignés. */
export function validateTemplateInput(kind: 'query' | 'widget', input: { id: string; params: Record<string, unknown> }): SuiviIssue | null {
  const tpl = kind === 'query' ? findQueryTemplate(input.id) : findWidgetTemplate(input.id)
  if (!tpl) return { code: 'INVALID_TEMPLATE', reason: `Modèle ${kind === 'query' ? 'de requête' : 'de widget'} inconnu : ${input.id} (cf. list_templates).` }
  const missing = tpl.params.filter((p) => p.required && (input.params[p.name] === undefined || input.params[p.name] === null || input.params[p.name] === ''))
  if (missing.length) return { code: 'INVALID_TEMPLATE', reason: `Modèle ${input.id} : paramètre(s) requis manquant(s) — ${missing.map((p) => p.name).join(', ')}.` }
  if (kind === 'query' && input.id === 'filtered-list' && !input.params.objectTypeRef && !input.params.category) {
    return { code: 'INVALID_TEMPLATE', reason: 'Modèle filtered-list : objectTypeRef ou category requis.' }
  }
  return null
}

/** Encodages agrégeants d'une spec Vega-Lite (perdent `_ids`), cherchés à toute profondeur. */
function findAggregate(node: unknown, path: string): string | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const hit = findAggregate(node[i], `${path}[${i}]`)
      if (hit) return hit
    }
    return null
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'aggregate' || (k === 'transform' && Array.isArray(v) && v.some((t) => t && typeof t === 'object' && 'aggregate' in t))) return `${path}.${k}`
    const hit = findAggregate(v, `${path}.${k}`)
    if (hit) return hit
  }
  return null
}

/**
 * Contrôles de forme d'une spec Vega-Lite (specs/GH74.md §3) : JSON objet, source de données
 * nommée `rows`, pas de données externes (`url`, `datasets`). Un `aggregate` donne un
 * avertissement (rendu, mais drill-down indisponible sur ces marques).
 */
export function checkSpec(text: string): { issue: SuiviIssue | null; warnings: SuiviWarning[] } {
  let spec: unknown
  try {
    spec = JSON.parse(text)
  } catch (err) {
    return { issue: { code: 'SPEC_INVALID', reason: `Spec : JSON invalide — ${err instanceof Error ? err.message : String(err)}.` }, warnings: [] }
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { issue: { code: 'SPEC_INVALID', reason: 'Spec : objet JSON attendu.' }, warnings: [] }
  const s = spec as Record<string, unknown>
  const data = s.data as { name?: unknown; url?: unknown; values?: unknown } | undefined
  if (!data || data.name !== 'rows') return { issue: { code: 'SPEC_INVALID', reason: 'Spec : la source de données doit être "data": { "name": "rows" } (lignes du script).' }, warnings: [] }
  const json = JSON.stringify(spec)
  if (/"url"\s*:/.test(json) || 'datasets' in s) {
    return { issue: { code: 'SPEC_INVALID', reason: 'Spec : données externes interdites (url, datasets) — seules les lignes du script sont disponibles.' }, warnings: [] }
  }
  const warnings: SuiviWarning[] = []
  const agg = findAggregate(spec, 'spec')
  if (agg) warnings.push({ code: 'SPEC_AGGREGATE', reason: `Spec : agrégation Vega-Lite (${agg}) — les _ids sont perdus, le drill-down ne fonctionnera pas sur ces marques. Agréger dans la transformation.` })
  return { issue: null, warnings }
}

/** `order` doit être une permutation exacte de `current`. */
export function validateOrder(current: readonly string[], order: readonly string[]): SuiviIssue | null {
  const known = new Set(current)
  const seen = new Set<string>()
  const dupes = order.filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
  const unknown = order.filter((id) => !known.has(id))
  const missing = current.filter((id) => !seen.has(id))
  if (dupes.length === 0 && unknown.length === 0 && missing.length === 0) return null
  const parts = [
    unknown.length ? `inconnu(s) : ${unknown.join(', ')}` : '',
    missing.length ? `manquant(s) : ${missing.join(', ')}` : '',
    dupes.length ? `en double : ${[...new Set(dupes)].join(', ')}` : '',
  ].filter(Boolean)
  return { code: 'INVALID_ORDER', reason: `order doit contenir exactement les ids des widgets du dashboard — ${parts.join(' ; ')}.` }
}

/** Widgets dans l'ordre d'affichage (`widgetOrder`, puis les ids hors ordre). */
export function orderedWidgets(d: { widgets: Widget[]; widgetOrder: string[] }): Widget[] {
  const byId = new Map(d.widgets.map((w) => [w.id, w]))
  const ordered = d.widgetOrder.map((id) => byId.get(id)).filter((w): w is Widget => !!w)
  const placed = new Set(ordered.map((w) => w.id))
  return [...ordered, ...d.widgets.filter((w) => !placed.has(w.id))]
}
