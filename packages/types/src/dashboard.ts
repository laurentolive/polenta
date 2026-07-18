// ─── Query engine & saved queries (T77 sprint 1) ─────────────────────────────
//
// Dashboards personnalisables par requêtes façon SQL. Ce fichier définit les
// types partagés entre le moteur de requête (main process, AlaSQL sur l'index
// en mémoire), le stockage des requêtes sauvegardées/historique, et les
// widgets/dashboards (sprint 2 — déclarés ici par anticipation, non câblés
// tant que dashboards.service.ts n'existe pas).

export type QueryScope = 'private' | 'shared'
export type QueryMode = 'builder' | 'sql'

export interface BuilderCondition {
  field: string
  operator: '=' | '!=' | '>' | '<' | 'contains' | 'in'
  value: unknown
}

// objectTypeRef format : "nodeName::objectTypeName", résolu contre le schéma LOCAL
// du composant (cf. Requirement/TestCase — chaque repo composant est autonome,
// CLAUDE.md). La table AlaSQL interrogée (requirements | tests) est déduite du
// type au moment de l'exécution (query-engine.service.ts), pas stockée ici.
export interface BuilderConfig {
  objectTypeRef: string
  /**
   * Nom du mount workspace (tree.yaml) du composant auquel `objectTypeRef` fait
   * référence — absent pour un type du repo courant/racine (comportement
   * historique, pré-T93). Nécessaire car `objectTypeRef` seul n'est pas unique
   * entre composants (chacun nomme son propre nœud local "root").
   */
  component?: string
  conditions: BuilderCondition[]
  combinator: 'AND' | 'OR'
  groupBy?: string[]
}

/** Une requête prête à exécuter — builder OU sql, jamais les deux à la fois. */
export interface QueryDefinition {
  mode: QueryMode
  builderConfig?: BuilderConfig
  sqlText?: string
}

export interface SavedQuery {
  id: string
  title: string
  mode: QueryMode
  builderConfig?: BuilderConfig   // requis si mode === 'builder'
  sqlText?: string                // requis si mode === 'sql'
  scope: QueryScope
  createdBy: string
  createdAt: string
}

// Toujours privé — jamais partageable, même si la requête source est partagée.
export interface QueryHistoryEntry {
  id: string
  mode: QueryMode
  builderConfig?: BuilderConfig
  sqlText?: string
  executedAt: string
}

export interface QueryResultColumn {
  name: string
  type: 'string' | 'number' | 'date' | 'boolean'
}

export interface QueryResult {
  columns: QueryResultColumn[]
  rows: Record<string, unknown>[]
}

// ─── Widgets & dashboards ─────────────────────────────────────────────────────
// T77 sprint 2 — types déclarés dès sprint 1 par anticipation (cf. T77-design.md
// § "Découpage en sprints"), mais NON câblés à un service/UI avant le sprint 2.

export type WidgetType = 'bar' | 'pie' | 'line' | 'kpi' | 'table'
export type WidgetSize = 'sm' | 'md' | 'lg'

export interface WidgetFieldMapping {
  category?: string   // bar/pie/line
  measure?: string     // bar/pie/line/kpi
  series?: string      // line (multi-série), optionnel
  columns?: string[]   // table
}

export interface Widget {
  id: string
  title: string
  queryId: string
  type: WidgetType
  fieldMapping: WidgetFieldMapping
  size: WidgetSize
}

export interface Dashboard {
  id: string
  title: string
  scope: QueryScope
  widgetOrder: string[]
  widgets: Widget[]
  createdBy: string
  createdAt: string
}
