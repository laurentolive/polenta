import type { SchemaFieldType } from './schema'
import type { TestCase } from './test'
import type { TestCampaign, CampaignTestRun } from './campaign'
import type { QueryResult, Dashboard } from './dashboard'
import type { ImpactAnalysis } from './impact-analysis'

export type ExportFormat = 'xlsx' | 'docx' | 'pdf'

// Vocabulaire partagé T43 — chaque kind n'est pas forcément implémenté dans tous les formats,
// cf. mapping formats/type de specs/T43.md §2 (ex. `dashboard` n'a pas de variante xlsx).
export type ExportKind =
  | 'requirements'
  | 'tests'
  | 'campaign-plan'
  | 'campaign-report'
  | 'impact-analysis'
  | 'query-result'
  | 'dashboard'

export type ExportResult =
  | { status: 'ok'; filePath: string }
  | { status: 'canceled' }
  | { status: 'error'; message: string }

// xlsx/docx uniquement — le pdf ne transite pas par un payload, cf. specs/T43-design.md
// (la route imprimable recharge ses propres données à partir de `printParams`).
//
// `columns`/`rows` (pas `items: Requirement[]`) — correctif post-validation : la première version
// exportait un jeu de colonnes fixe (ID/Titre/Type/Statut/Énoncé), qui ne correspondait pas à la
// configuration réelle de `ExcelView`/`WordView` (colonnes visibles configurables par type/projet
// via `visibleFieldsExcel`/`visibleFieldsWord`, cf. `SystemView.tsx` — "Section" dérivée de la
// position dans l'arbre, "Version" en système, champs personnalisés du schéma, "Type" absent des
// colonnes par défaut). L'export doit refléter EXACTEMENT ce que l'utilisateur voit, donc les
// colonnes/valeurs sont désormais résolues côté renderer (qui a accès à cette configuration et à
// l'arbre) et envoyées déjà résolues sous forme générique `{key,label}`/`Record<key,valeur>`.
export interface RequirementsExportPayload {
  componentLabel: string
  columns: ExportColumn[]
  rows: Record<string, string>[]
  /** GH34 — fourni seulement pour un export à partir d'un gabarit (ignoré par le rendu Standard). */
  outline?: TemplateOutlineEntry[]
}

export interface TestsExportPayload {
  componentLabel: string
  columns: ExportColumn[]
  rows: Record<string, string>[]
  /** GH34 — cf. `RequirementsExportPayload.outline`. */
  outline?: TemplateOutlineEntry[]
}

/** `type` (GH34) : type du champ de schéma quand la colonne en est un — `richtext` est converti
 *  (texte simple au sprint 1, mise en forme Word ensuite) par l'export à partir d'un gabarit. */
export interface ExportColumn {
  key: string
  label: string
  type?: SchemaFieldType
}

/** GH34 — entrée de l'arbre (dossier ou élément) dans l'ordre visuel, pour les gabarits d'export :
 *  mêmes clés/valeurs que `rows` (paramètres déjà substitués), plus les dossiers et le détail des
 *  étapes de test que `rows` ne porte pas. */
export interface TemplateOutlineEntry {
  kind: 'folder' | 'item'
  /** Profondeur dans l'arbre, 1 = racine. */
  level: number
  section: string
  name: string
  values: Record<string, string>
  /** Libellé du statut tel que défini dans le schéma (ex. « Approuvé » pour `approved`). */
  statusLabel?: string
  steps?: { order: number; action: string; expectedResult: string; notes: string }[]
}

/** GH34 — formats pour lesquels un gabarit client peut remplacer le rendu Standard. */
export type TemplateExportFormat = 'docx' | 'xlsx'

/** GH34 — clé d'un gabarit par défaut dans `schema.preferences.exportTemplates`. */
export type ExportTemplateKey = `${ExportKind}:${TemplateExportFormat}`

export interface ExportTemplateInfo {
  /** Chemin relatif à la bibliothèque, séparateurs `/` — identifiant du gabarit. */
  relPath: string
}

export interface ExportTemplateListResult {
  /** Préférence application renseignée. */
  dirConfigured: boolean
  /** Dossier présent et lisible. */
  dirExists: boolean
  templates: ExportTemplateInfo[]
}

// Même forme pour 'campaign-plan' et 'campaign-report' (T43 sprint 2) — seul le générateur appelé
// diffère (plan : sans statut d'exécution ; rapport : avec statut par test, cf. `campaign.docx.ts`)
// donc pas de duplication de type pour une différence purement comportementale.
//
// `entries` (pas `tests: TestCase[]`, T49) — porte la paire `{run, test}` plutôt qu'une simple
// liste de tests résolus par `testCaseId` : un même test peut être inclus plusieurs fois dans la
// campagne (instances paramétrées, T97 sprint 2), donc résoudre séparément puis rechercher le
// `run` correspondant par `testCaseId` désigne toujours la même (première) instance — `entries`
// élimine ce risque en gardant l'association 1:1 telle que résolue par `resolveCampaignRuns()`.
export interface CampaignExportPayload {
  campaign: TestCampaign
  entries: { run: CampaignTestRun; test: TestCase }[]
}

// `query-result` (T43 sprint 3) : le `QueryResult` d'une requête ad hoc n'est pas forcément
// persisté (une requête non sauvegardée n'a pas d'ID stable) — contrairement aux autres kinds, le
// pdf ne peut donc pas "recharger ses données" depuis un identifiant ; `queryName` sert uniquement
// au nom de fichier par défaut (`request-{name}.{ext}`, cf. specs/T43.md §4).
export interface QueryResultExportPayload {
  queryName: string
  result: QueryResult
}

// `impact-analysis` (T43 sprint 3) : contrairement à query-result, une analyse d'impact est un
// objet persisté avec un ID stable — le pdf peut suivre le pattern standard (route imprimable qui
// recharge via `analysisId`), seul xlsx transite par ce payload complet.
export interface ImpactAnalysisExportPayload {
  analysis: ImpactAnalysis
}

// `dashboard` (T43 sprint 3, docx uniquement — pas de xlsx, cf. specs/T43.md §2) : les résultats de
// chaque widget sont exécutés côté renderer (comme le fait déjà `DashboardGrid`/`useQueryResult`)
// et envoyés dans le payload plutôt que recalculés côté main process, qui n'a pas accès aux mêmes
// primitives d'exécution de requête sans dupliquer `QueryEngineService`/`SavedQueriesService`.
export interface DashboardExportPayload {
  dashboard: Dashboard
  widgetResults: Record<string, QueryResult>
}
