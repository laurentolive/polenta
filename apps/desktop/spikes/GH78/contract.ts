/**
 * GH78 — contrat de données du graphe Polenta, version majeure 1 (PROTOTYPE).
 *
 * C'est la seule chose qu'un script de widget voit : `export default function (data, polenta) { … }`
 * reçoit `data: PolentaGraph` et `polenta: PolentaHost`, et renvoie un tableau de lignes
 * (`Row[]`) qui alimente une spec Vega-Lite (`data: { name: "rows" }`).
 *
 * Principe (#74) : DONNÉES BRUTES. Le graphe contient les objets tels qu'ils sont stockés
 * (statuts, champs, historique, liens, campagnes → entrées, exécutions), plus les seuls
 * indicateurs que Polenta calcule pour ses propres fonctions (`coverageStatus`,
 * `needsRevalidation`, `isApproval` dans le schéma). Aucun indicateur de suivi (maturité,
 * avancement…) : ceux-là sont écrits dans la bibliothèque du projet (`dashboards/lib/*.js`),
 * importable depuis un script par `import { … } from "lib/<module>.js"`.
 *
 * Dates : chaînes ISO 8601 UTC (`2026-09-02T08:10:00Z`) — comparables par ordre lexical.
 * Identifiants : uniques sur tout le projet (préfixe par type).
 */

export const CONTRACT_VERSION = 1

// ─── Racine ──────────────────────────────────────────────────────────────────

export interface PolentaGraph {
  /** Version majeure du contrat (dans une majeure, on ne fait qu'ajouter). */
  contractVersion: 1
  /** Instant de construction du graphe. */
  generatedAt: string
  /** Repos du projet : le repo produit et ses composants (submodules). */
  repos: GraphRepo[]
  /** Modèle de données de tous les repos, aplati par type d'objet. */
  schema: GraphSchema
  requirements: GraphRequirement[]
  tests: GraphTest[]
  /** Liens entre objets (exigence ↔ exigence, test ↔ exigence…). Le sens n'a pas de valeur
   *  pour la couverture test ↔ exigence : `sourceId` peut être le test ou l'exigence. */
  links: GraphLink[]
  campaigns: GraphCampaign[]
  /** Toutes les exécutions de test enregistrées (fichiers `test-runs/`), campagne ou non. */
  runs: GraphTestRun[]
}

export interface GraphRepo {
  /** Nom du repo (ex. `ll800-produit`, `comp-moteur`). */
  name: string
  label: string
  /** Vrai pour le repo ouvert (produit). */
  isRoot: boolean
}

// ─── Schéma ──────────────────────────────────────────────────────────────────

export interface GraphSchema {
  objectTypes: GraphObjectType[]
  linkTypes: GraphLinkType[]
}

export type ObjectCategory = 'requirement' | 'test' | 'campaign'

/** Un type se retrouve par le couple (`repo`, `ref`) : chaque repo a son propre schéma et
 *  `root::…` désigne le nœud racine DU repo, donc une même `ref` peut exister dans deux repos. */
export interface GraphObjectType {
  /** Repo dont le schéma déclare le type. */
  repo: string
  /** `<nœud>::<type>` — la valeur de `objectTypeRef` des objets de ce type, dans ce repo. */
  ref: string
  /** Composant qui déclare le type : nom du repo pour `root`, sinon nom du nœud local. */
  component: string
  label: string
  prefix: string | null
  category: ObjectCategory
  fields: GraphFieldDef[]
  /** Statuts dans l'ordre de déclaration. Vide pour une campagne (statuts fixes, cf. `CampaignStatus`). */
  statuses: GraphStatusDef[]
}

export interface GraphStatusDef {
  name: string
  label: string
  /** Statut d'approbation du type (au plus un par type). */
  isApproval: boolean
  /** Statut terminal (ex. obsolète), masqué des listes par défaut dans Polenta. */
  isTerminal: boolean
}

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'enum' | 'multi_enum' | 'boolean' | 'date' | 'datetime'
  | 'richtext' | 'user' | 'drawio'

export interface GraphFieldDef {
  name: string
  label: string
  type: FieldType
  /** Valeurs possibles (enum, multi_enum), dans l'ordre de déclaration. */
  values?: string[]
  required: boolean
  /** Vrai si l'historique de ce champ est conservé dans `history[<name>]`. */
  trackHistory: boolean
}

export interface GraphLinkType {
  name: string
  labelSourceToTarget: string
  labelTargetToSource: string
}

// ─── Historique (GH77) ───────────────────────────────────────────────────────

export interface HistoryEntry {
  /** Valeur posée (clé technique : nom de statut, valeur d'enum…). Absente pour un champ
   *  « événement seul » (richtext, textarea, drawio) : seule la date du changement est connue. */
  value?: unknown
  /** Instant du changement. */
  at: string
  /** Login de l'auteur. */
  by?: string
  /** Origine ; absente = saisie dans l'application. `git` = reprise approximative depuis git. */
  source?: 'mcp' | 'git' | 'schema'
  /** Valeur constatée dont la date réelle est inconnue (datée par le dernier commit du fichier). */
  implicit?: true
}

/** Une liste par champ suivi, triée par `at` croissant : `status` pour le statut, sinon le nom
 *  du champ de `fields`. La dernière entrée d'une liste est la valeur courante. */
export type ObjectHistory = Record<string, HistoryEntry[]>

// ─── Objets ──────────────────────────────────────────────────────────────────

interface GraphObjectBase {
  id: string
  /** Repo où l'objet est stocké ; avec `objectTypeRef`, désigne son type. */
  repo: string
  /** Composant de l'objet : nœud local du schéma (ex. `hydraulique`) ou, à défaut, le repo. */
  component: string
  objectTypeRef: string
  title: string
  /** Nom technique du statut (cf. `GraphObjectType.statuses`). */
  status: string
  version: number | null
  /** Champs personnalisés, tels que stockés. `multi_enum` : chaîne CSV « a, b ». */
  fields: Record<string, unknown>
  /** Historique des champs suivis ; `{}` si aucun. */
  history: ObjectHistory
  /** Indicateur Polenta (T172) : un objet lié a quitté l'approbation, impact à vérifier. */
  needsRevalidation: boolean
  /** Dérivés du git log du fichier ; `null` si jamais commité. */
  createdAt: string | null
  createdBy: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export type CoverageStatus = 'not_covered' | 'covered' | 'validated' | 'failing' | 'needs_revalidation'

export interface GraphRequirement extends GraphObjectBase {
  /** Indicateur Polenta (matrice de traçabilité) :
   *  - not_covered : aucun test lié ;
   *  - covered : au moins un test lié, au moins un jamais exécuté ;
   *  - validated : tous les tests liés ont une exécution PASS ;
   *  - failing : dernière exécution d'un test lié FAIL ou BLOCKED ;
   *  - needs_revalidation : l'exigence ou un test lié est marqué `needsRevalidation`. */
  coverageStatus: CoverageStatus
}

export interface GraphTestStep {
  order: number
  action: string
  expectedResult: string
  notes: string | null
}

export interface GraphTest extends GraphObjectBase {
  preconditions: string
  postconditions: string
  steps: GraphTestStep[]
}

export interface GraphLink {
  id: string
  /** Nom du type de lien (cf. `GraphSchema.linkTypes`). */
  type: string
  sourceId: string
  targetId: string
  /** Repo où le lien est stocké. */
  repo: string
  createdAt: string
  createdBy: string
}

// ─── Campagnes ───────────────────────────────────────────────────────────────

export type CampaignStatus = 'planned' | 'in_progress' | 'completed' | 'abandoned'
export type EntryStatus = 'pending' | 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE'
export type RunResult = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE'

export interface GraphCampaign {
  id: string
  repo: string
  component: string
  objectTypeRef: string | null
  title: string
  status: CampaignStatus
  fields: Record<string, unknown>
  /** Historique du statut et des champs suivis (GH77). */
  history: ObjectHistory
  /** Tag git de la baseline visée, si renseigné. */
  baselineRef: string | null
  createdAt: string
  completedAt: string | null
  /** Entrées actives, dans l'ordre de la campagne. */
  entries: GraphCampaignEntry[]
  /** Entrées retirées de la campagne (GH73), avec `removedAt`. */
  removedEntries: GraphCampaignEntry[]
}

export interface GraphCampaignEntry {
  /** Unique dans la campagne (ex. `TSYS-0002-1`) ; un test peut avoir plusieurs entrées. */
  entryId: string
  testCaseId: string
  /** Exigence pour laquelle l'instance a été générée (tests paramétrés par exigence), sinon null. */
  requirementId: string | null
  /** Dernier verdict saisi ; `pending` = jamais exécutée. */
  status: EntryStatus
  /** Exécution qui a donné ce verdict (cf. `GraphTestRun.id`), sinon null. */
  runId: string | null
  executedAt: string | null
  executedBy: string | null
  /** Ajout à la campagne (GH73) ; null pour les entrées antérieures (repli : `campaign.createdAt`). */
  addedAt: string | null
  /** Retrait (seulement dans `removedEntries`). */
  removedAt: string | null
  /** Copie du test figée à l'inclusion (null si absente). Statut et version du test à ce moment. */
  snapshot: { status: string; version: number | null; title: string } | null
}

export interface GraphTestRun {
  id: string
  /** Repo du test exécuté (où le fichier de run est stocké). */
  repo: string
  testCaseId: string
  /** Entrée de campagne qui a lancé l'exécution (GH73) ; null pour une exécution isolée ou
   *  antérieure à GH73. */
  campaignEntry: { campaignId: string; entryId: string } | null
  requirementId: string | null
  result: RunResult
  executedAt: string
  executedBy: string
  /** Durée en secondes. */
  duration: number
}

// ─── Hôte et sortie ──────────────────────────────────────────────────────────

export interface PolentaHost {
  /** Version du contrat servie par l'application. */
  contractVersion: 1
  /** Instant de l'exécution (à utiliser à la place de `Date.now()` pour des sorties reproductibles). */
  now: string
  /** Paramètres du widget (ex. `{ campaignId: "CAMP-0002" }`), définis dans le fichier du dashboard. */
  params: Record<string, unknown>
}

/**
 * Une ligne de sortie : valeurs scalaires (chaîne, nombre, booléen, null) uniquement, plus
 * `_ids` : identifiants des objets dont la ligne est issue (drill-down : un clic sur la marque
 * ouvre la liste de ces objets). Obligatoire, éventuellement vide.
 */
export type Row = { _ids: string[] } & Record<string, string | number | boolean | null | string[]>

/** Signature d'un script de widget (module ES, export par défaut, SYNCHRONE). Pas d'accès au
 *  réseau, aux fichiers ni aux timers (`fetch`, `require`, `process`, `setTimeout` n'existent
 *  pas) : seules `data`, `polenta` et la bibliothèque projet sont disponibles. Utiliser
 *  `polenta.now` plutôt que `Date.now()` (sortie reproductible). `data` est en lecture seule
 *  (gelé). Limite de temps et de mémoire appliquées. */
export type WidgetScript = (data: PolentaGraph, polenta: PolentaHost) => Row[]
