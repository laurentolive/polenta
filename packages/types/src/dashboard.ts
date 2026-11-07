// ─── Vue Suivi : requêtes (scripts de données) et dashboards (GH74) ──────────
//
// Une requête est un script de données JS (`export default (data, polenta) => rows`) exécuté
// dans le bac à sable du main ; un widget porte une transformation JS facultative et une spec
// Vega-Lite. Les deux peuvent venir d'un modèle (`TemplateRef`, cf. suivi-templates.ts).
// Format sur disque versionné (`formatVersion`) : migrations à la lecture (suivi-format.ts).

import type { TemplateRef } from './suivi-templates'
import type { TestRunStatus } from './campaign'
import type { QueryParameterDef } from './suivi-params'
import type { QueryColumnDef } from './suivi-columns'

export type QueryScope = 'private' | 'shared'

/** Préfixe des ids des objets privés (`.{user}.pref`) ; un objet partagé a un id à compteur
 *  (`QUERY-0001`, `DASHBOARD-0001`). La portée se lit donc sur l'id seul. */
export const PRIVATE_SCOPE_ID_PREFIX = 'local-'

export function isPrivateScopeId(id: string): boolean {
  return id.startsWith(PRIVATE_SCOPE_ID_PREFIX)
}

// ─── Changement de portée (GH67) ─────────────────────────────────────────────

/** Widget qui référence une requête. */
export interface ScopeWidgetRef {
  dashboardId: string
  dashboardTitle: string
  dashboardScope: QueryScope
  widgetId: string
  widgetTitle: string
}

/** Ce qui empêche un changement de portée de requête. */
export type QueryScopeBlocker =
  | { kind: 'read-only'; reason: 'legacy-sql' | 'newer-format' }
  | { kind: 'params'; message: string }
  /** Rétrogradation : requête encore utilisée par des widgets. */
  | { kind: 'dependents'; widgets: ScopeWidgetRef[] }

/** Aperçu d'un changement de portée de requête (rien n'est écrit). */
export interface QueryScopePreview {
  queryId: string
  title: string
  from: QueryScope
  to: QueryScope
  blockers: QueryScopeBlocker[]
  /** Promotion : widgets des dashboards privés de l'utilisateur qui suivront le nouvel id. */
  remapped: ScopeWidgetRef[]
  /** Promotion : ids des requêtes partagées au même titre (casse et espaces de bord ignorés). */
  titleTakenBy: string[]
  /** Rétrogradation : libellé de la colonne calculée retirée (GH70), sinon `null`. */
  columnRemoved: QueryColumnDef['label'] | null
}

/** Requête privée d'un dashboard à partager : `widgets` = ceux de ce dashboard, `remapped` = ceux
 *  des autres dashboards privés. */
export interface DashboardShareQuery extends QueryScopePreview {
  widgets: { widgetId: string; widgetTitle: string }[]
}

/** Aperçu du partage d'un dashboard privé avec ses requêtes privées. */
export interface DashboardSharePreview {
  dashboardId: string
  /** Une entrée par requête privée, dans l'ordre des widgets. */
  queries: DashboardShareQuery[]
  /** Widgets dont la requête privée n'existe plus. */
  missing: { widgetId: string; widgetTitle: string; queryId: string }[]
}

/** Version du format des fichiers `queries/` et `dashboards/` (et des entrées du `.pref`). */
export const SUIVI_FORMAT_VERSION = 1

/** État calculé à la lecture, jamais stocké. */
export interface SuiviObjectState {
  /** `newer-format` : fichier d'une version plus récente de Polenta ; `legacy-sql` : requête SQL
   *  d'avant GH74, non convertible. Dans les deux cas l'objet n'est jamais réécrit. */
  readOnly?: 'newer-format' | 'legacy-sql'
  /** Code différent de celui généré par son modèle (ou objet sans modèle). */
  customized: boolean
  /** Version plus récente du modèle disponible (régénérée à l'enregistrement). */
  templateUpdate?: number
  /** Lu dans le format d'avant GH74 : converti en mémoire, réécrit au format v1 à l'enregistrement. */
  legacyFormat?: boolean
}

export interface SavedQuery {
  id: string
  title: string
  scope: QueryScope
  formatVersion: number
  /** Script de données (module ES). Vide pour une requête `legacy-sql`. */
  script: string
  template?: TemplateRef
  /** GH93 — paramètres choisis à l'affichage (`[]` si aucun, ou si la déclaration est invalide). */
  parameters: QueryParameterDef[]
  /** GH93 — déclaration lue invalide (fichier modifié à la main) : exécution refusée (`format`). */
  parametersError?: string
  /** GH70 — déclaration de colonne calculée de la Vue Système (requête partagée), sinon `null`. */
  column: QueryColumnDef | null
  /** GH70 — déclaration lue invalide (fichier modifié à la main, ou portée privée) : non proposée. */
  columnError?: string
  createdBy: string
  createdAt: string
  /** Requête SQL d'avant GH74 : texte conservé pour l'affichage, plus exécutable. */
  legacySql?: string
  state: SuiviObjectState
}

/** Historique d'exécution de la vue Requêtes — toujours privé. */
export interface QueryHistoryEntry {
  id: string
  script: string
  executedAt: string
}

export type WidgetSize = 'sm' | 'md' | 'lg'

export interface Widget {
  id: string
  title: string
  queryId: string
  size: WidgetSize
  /** Transformation JS facultative (`export default (rows, polenta) => rows`). */
  transform?: string
  /** Spec Vega-Lite (texte JSON, conservé tel quel). */
  spec: string
  template?: TemplateRef
  state: SuiviObjectState
}

export interface Dashboard {
  id: string
  title: string
  scope: QueryScope
  formatVersion: number
  widgetOrder: string[]
  widgets: Widget[]
  createdBy: string
  createdAt: string
  state: SuiviObjectState
}

// ─── Résultat d'exécution (exports, impression) ──────────────────────────────

export interface QueryResultColumn {
  name: string
  type: 'string' | 'number' | 'date' | 'boolean'
}

/** Lignes produites par un script (ou un widget : script + transformation). Une ligne peut porter
 *  `_ids` (identifiants des objets d'origine). */
export interface QueryResult {
  columns: QueryResultColumn[]
  rows: Record<string, unknown>[]
}

// ─── Drill-down ──────────────────────────────────────────────────────────────

/** Objet désigné par un identifiant `_ids` (popup « Détail »). */
export interface DescribedObject {
  id: string
  kind: 'requirement' | 'test' | 'issue' | 'campaign' | 'campaign-entry' | 'run' | 'unknown'
  title: string | null
  status: string | null
  typeLabel: string | null
}

/** Objet à ouvrir pour un identifiant (repo où il vit, résolu côté main). */
export type RowTarget =
  | { kind: 'requirement' | 'test' | 'campaign'; id: string; repoPath: string }
  /** GH244 — ouverte dans les vues système : composant et type. */
  | { kind: 'issue'; id: string; repoPath: string; repoName: string; objectTypeRef: string }
  | { kind: 'campaign-entry'; campaignId: string; entryId: string; executed: boolean; status: TestRunStatus; repoPath: string }

// ─── Bandeau des mises à jour (GH74 §6.3) ────────────────────────────────────

/**
 * Proposition du bandeau de la vue Suivi :
 * - `library` : fichier de la bibliothèque de départ (`dashboards/lib/`, `jsconfig.json`) resté à une
 *   version livrée antérieure, ou nouveau fichier livré ;
 * - `seed-widget` : widget ajouté au seed « Campagnes » depuis sa création ;
 * - `template` : objet d'un seed (non personnalisé) dont le modèle a une version plus récente.
 */
export interface SuiviUpdate {
  /** Identifiant stable (`library:<chemin>`, `seed-widget:<clé>`, `template:query:<id>`, `template:widget:<dashboard>/<widget>`). */
  id: string
  kind: 'library' | 'seed-widget' | 'template'
  /** Fichier, widget ou requête concerné. */
  title: string
  /** Absent : nouveau (fichier ou widget). */
  fromVersion?: number
  toVersion: number
  summary: { fr: string; en: string }
  /** Écriture dans le repo (à publier) ; sinon dans les préférences de l'utilisateur. */
  shared: boolean
}

export interface SuiviUpdatesList {
  updates: SuiviUpdate[]
  /** Branche en lecture seule : bandeau affiché sans « Appliquer ». */
  readOnly: boolean
}
