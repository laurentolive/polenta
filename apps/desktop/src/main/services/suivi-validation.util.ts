import type { BuilderConfig, QueryMode, QueryScope, Widget, WidgetFieldMapping, WidgetType } from '@polenta/types'

/**
 * Validation pure des tools MCP de la vue Suivi (GH18 — specs/GH18-design.md §5) : aucune
 * I/O, les tools font les lectures (services existants) et appellent ces fonctions.
 */

export type SuiviErrorCode =
  | 'INVALID_INPUT'
  | 'PRIVATE_SCOPE_UNAVAILABLE'
  | 'READONLY_BRANCH'
  | 'INVALID_QUERY_DEFINITION'
  | 'FORBIDDEN_SQL'
  | 'INVALID_BUILDER_CONFIG'
  | 'QUERY_EXECUTION_ERROR'
  | 'QUERY_NOT_FOUND'
  | 'QUERY_IN_USE'
  | 'DASHBOARD_NOT_FOUND'
  | 'WIDGET_NOT_FOUND'
  | 'DUPLICATE_TITLE'
  | 'PRIVATE_QUERY_IN_SHARED_DASHBOARD'
  | 'MISSING_MAPPING'
  | 'INVALID_MAPPING'
  | 'UNKNOWN_COLUMN'
  | 'DUPLICATE_WIDGET'
  | 'INVALID_ORDER'

export type SuiviWarningCode = 'COLUMNS_UNVERIFIED' | 'WIDGET_MAPPING_BROKEN'

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

export interface QueryDefinitionInput {
  mode: QueryMode
  sqlText?: string
  builderConfig?: BuilderConfig
}

/** Exclusivité sqlText / builderConfig selon `mode` (une SavedQuery ne porte jamais les deux). */
export function validateQueryDefinitionShape(def: QueryDefinitionInput): SuiviIssue | null {
  const invalid = (reason: string): SuiviIssue => ({ code: 'INVALID_QUERY_DEFINITION', reason })
  if (def.mode === 'sql') {
    if (def.builderConfig !== undefined) return invalid('mode "sql" : builderConfig interdit (fournir sqlText seul).')
    if (typeof def.sqlText !== 'string' || def.sqlText.trim() === '') return invalid('mode "sql" : sqlText requis et non vide.')
    return null
  }
  if (def.sqlText !== undefined) return invalid('mode "builder" : sqlText interdit (fournir builderConfig seul).')
  const b = def.builderConfig
  if (!b) return invalid('mode "builder" : builderConfig requis.')
  if (typeof b.objectTypeRef !== 'string' || b.objectTypeRef.trim() === '') return invalid('builderConfig.objectTypeRef requis.')
  if (!Array.isArray(b.conditions)) return invalid('builderConfig.conditions doit être un tableau.')
  if (b.combinator !== 'AND' && b.combinator !== 'OR') return invalid('builderConfig.combinator doit valoir "AND" ou "OR".')
  return null
}

/** Champs d'un builderConfig hors allowlist du type ciblé (conditions + groupBy). */
export function unknownBuilderFields(config: BuilderConfig, allowedFields: readonly string[]): string[] {
  const allowed = new Set(allowedFields)
  const used = [...config.conditions.map((c) => c.field), ...(config.groupBy ?? [])]
  return [...new Set(used.filter((f) => !allowed.has(f)))]
}

/** Colonnes de résultat citées par un mapping de widget. */
export function mappingColumns(m: WidgetFieldMapping): string[] {
  const cols = [m.category, m.measure, m.series, ...(m.columns ?? [])]
  return [...new Set(cols.filter((c): c is string => typeof c === 'string' && c !== ''))]
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

// ─── Widgets (sprint 2) ─────────────────────────────────────────────────────────

type MappingKey = keyof WidgetFieldMapping

/** Mapping requis / autorisé par type de widget (GH18-design §5). */
const MAPPING_RULES: Record<WidgetType, { required: MappingKey[]; allowed: MappingKey[] }> = {
  bar: { required: ['category', 'measure'], allowed: ['category', 'measure', 'series', 'stacked'] },
  line: { required: ['category', 'measure'], allowed: ['category', 'measure', 'series'] },
  pie: { required: ['category', 'measure'], allowed: ['category', 'measure'] },
  kpi: { required: ['measure'], allowed: ['measure'] },
  table: { required: [], allowed: ['columns'] },
}

function isSet(m: WidgetFieldMapping, key: MappingKey): boolean {
  const v = m[key]
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  // `stacked: false` ≡ absent (valeur par défaut, laissée par l'éditeur de l'app).
  if (typeof v === 'boolean') return v
  return true
}

/**
 * Mapping réduit aux clés applicables à `type` (et sans `stacked` sans `series`). Sert à
 * `update_widget` quand le type change sans nouveau mapping : l'éditeur de l'app
 * (`WidgetConfigModal`) conserve les clés d'un ancien type, qu'on retire plutôt que de
 * refuser la modification.
 */
export function pruneMapping(type: WidgetType, m: WidgetFieldMapping): WidgetFieldMapping {
  const out: WidgetFieldMapping = {}
  for (const key of MAPPING_RULES[type].allowed) {
    if (isSet(m, key)) (out as Record<string, unknown>)[key] = m[key]
  }
  if (out.stacked && !isSet(out, 'series')) delete out.stacked
  return out
}

/** Forme canonique d'un mapping pour comparer deux widgets (stacked absent ≡ false). */
function canonicalMapping(type: WidgetType, m: WidgetFieldMapping): string {
  const out: Record<string, unknown> = {}
  for (const key of MAPPING_RULES[type].allowed) {
    if (key === 'stacked') out.stacked = m.stacked === true
    else if (isSet(m, key)) out[key] = m[key]
  }
  return JSON.stringify(out, Object.keys(out).sort())
}

export interface WidgetCandidate {
  id?: string
  type: WidgetType
  queryId: string
  fieldMapping: WidgetFieldMapping
}

/**
 * Règles 5 à 7 d'`add_widget` (spec GH18 §3) : mapping requis, mapping autorisé, colonnes
 * existantes dans le résultat, pas de doublon. `resultColumns = null` (résultat vide,
 * colonnes indéterminables) → contrôle des colonnes sauté + `COLUMNS_UNVERIFIED`.
 * `siblings` = autres widgets du dashboard (le widget modifié lui-même exclu).
 */
export function validateWidget(
  widget: WidgetCandidate,
  resultColumns: string[] | null,
  siblings: readonly Widget[],
): { issue: SuiviIssue | null; warnings: SuiviWarning[] } {
  const m = widget.fieldMapping ?? {}
  const rules = MAPPING_RULES[widget.type]
  const fail = (code: SuiviErrorCode, reason: string) => ({ issue: { code, reason }, warnings: [] })

  const missing = rules.required.filter((k) => !isSet(m, k))
  if (missing.length > 0) {
    return fail('MISSING_MAPPING', `Widget "${widget.type}" : fieldMapping.${missing.join(', fieldMapping.')} requis.`)
  }
  const forbidden = (Object.keys(m) as MappingKey[]).filter((k) => isSet(m, k) && !rules.allowed.includes(k))
  if (forbidden.length > 0) {
    return fail('INVALID_MAPPING', `Widget "${widget.type}" : fieldMapping.${forbidden.join(', fieldMapping.')} non applicable à ce type.`)
  }
  if (widget.type === 'bar' && m.stacked === true && !isSet(m, 'series')) {
    return fail('INVALID_MAPPING', 'Widget "bar" : stacked exige une series.')
  }

  const warnings: SuiviWarning[] = []
  if (resultColumns === null) {
    warnings.push({ code: 'COLUMNS_UNVERIFIED', reason: 'Résultat de la requête vide : colonnes du mapping non vérifiables.' })
  } else {
    const available = new Set(resultColumns)
    const unknown = mappingColumns(m).filter((col) => !available.has(col))
    if (unknown.length > 0) {
      return fail('UNKNOWN_COLUMN', `Colonne(s) absente(s) du résultat : ${unknown.join(', ')}. Colonnes disponibles : ${resultColumns.join(', ')}.`)
    }
  }

  const key = canonicalMapping(widget.type, m)
  const dup = siblings.find(
    (w) => w.id !== widget.id && w.queryId === widget.queryId && w.type === widget.type && canonicalMapping(w.type, w.fieldMapping ?? {}) === key,
  )
  if (dup) return fail('DUPLICATE_WIDGET', `Widget identique déjà présent : ${dup.id} "${dup.title}".`)

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
