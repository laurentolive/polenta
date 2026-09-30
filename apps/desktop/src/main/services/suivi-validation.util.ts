import type { BuilderConfig, QueryMode, QueryScope, WidgetFieldMapping } from '@polenta/types'

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
