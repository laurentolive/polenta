// Généré par Polenta — ne pas modifier : remplacé par les mises à jour de la bibliothèque.
// Types du graphe de données (contrat v1) pour la vérification des scripts (`checkJs`).

/**
 * GH74 — Graphe de données Polenta, contrat v1.
 *
 * C'est tout ce qu'un script de données voit :
 *
 * ```js
 * // @polenta contract 1
 * import { campaignsTimeline } from 'lib/campaign.js'
 * export default function (data, polenta) { return [ ... lignes ... ] }
 * ```
 *
 * - `data` : {@link PolentaGraph}, en lecture seule (gelé).
 * - `polenta` : {@link PolentaHost}.
 * - Valeur renvoyée : tableau de {@link GraphRow}, **synchrone** (pas de `async`, pas de promesse).
 *
 * Une transformation de widget a la même forme mais reçoit les lignes du script de données :
 * `export default function (rows, polenta) { return rows2 }`.
 *
 * Principe : **données brutes**. Le graphe contient les objets tels qu'ils sont stockés, plus les
 * seuls indicateurs que Polenta calcule pour ses propres fonctions (`coverageStatus`,
 * `needsRevalidation`, `resyncable`, `isApproval` dans le schéma). Les indicateurs de suivi
 * (maturité, étapes d'avancement, état d'une campagne à une date…) sont écrits dans la
 * bibliothèque du projet (`dashboards/lib/*.js`).
 *
 * Conventions :
 * - **Dates** : instants ISO 8601 UTC (`2026-09-02T08:10:00Z`), comparables par ordre lexical. Le
 *   découpage en jours se fait dans le fuseau `polenta.timezone`.
 * - **Identifiants** uniques sur tout le projet. Une entrée de campagne s'identifie par
 *   `<campaignId>/<entryId>` (ex. `CAMP-0002/TSYS-0004-1`).
 * - **Types d'objet** : un type se désigne par le couple (`repo`, `objectTypeRef`) — `root::…`
 *   désigne le nœud racine *de chaque repo* et n'est pas unique entre repos.
 * - **Drill-down** : une ligne porte dans `_ids` les identifiants des objets dont elle provient ;
 *   un clic sur la marque ouvre ces objets. Pour une série longue, laisser `_ids` absent et les
 *   calculer quand `polenta.drill` est renseigné (relance au clic sur la ligne correspondante).
 * - **Agrégation en JS, jamais dans la spec Vega-Lite** : un `aggregate` Vega-Lite perd `_ids`.
 *   Regrouper dans le script ou dans la transformation du widget, en faisant l'union des `_ids`.
 * - **Couleurs** dans les specs : jetons du thème `"var(--status-success-solid)"`,
 *   `"var(--chart-series-1)"`… résolus par l'application selon le thème clair / sombre.
 *
 * Versionnement : dans une version majeure, on ne fait qu'ajouter. Un champ renommé ou retiré
 * impose une nouvelle majeure ; l'ancien reste présent et marqué `@deprecated` un temps.
 */

/** Version majeure du contrat servie par cette version de Polenta. */
export declare const GRAPH_CONTRACT_VERSION: 1

// ─── Racine ──────────────────────────────────────────────────────────────────

export interface PolentaGraph {
  /** Version majeure du contrat. */
  contractVersion: 1
  /** Instant de construction du graphe. */
  generatedAt: string
  /** Repos du projet : le repo ouvert (produit) et ses composants. */
  repos: GraphRepo[]
  /** Composants : nœuds locaux des schémas et repos composants, avec leur libellé. */
  components: GraphComponent[]
  /** Modèle de données de tous les repos. */
  schema: GraphSchema
  requirements: GraphRequirement[]
  tests: GraphTest[]
  /** Liens entre objets. Pour la couverture test ↔ exigence, le sens n'a pas de valeur :
   *  `sourceId` peut être le test ou l'exigence. */
  links: GraphLink[]
  campaigns: GraphCampaign[]
  /** Toutes les exécutions de test enregistrées (fichiers `test-runs/`), campagne ou non. */
  runs: GraphTestRun[]
  /** GH198 — changes de tous les repos (`changes/`). */
  changes: GraphChange[]
}

/** GH198 — change : modification pilotée d'un composant, ses éléments à modifier et impactés. */
export interface GraphChange extends GraphObjectBase {
  /** Composant concerné (nœud du schéma). */
  component: string
  mode: 'request' | 'range'
  toModify: { id: string; state: 'planned' | 'modified' }[]
  /** Statut d'impact : les 8 valeurs de l'analyse d'impact entre baselines. */
  impacted: { id: string; status: string; comment: string | null; source: 'declared' | 'computed' }[]
  origin: { runs: string[]; decisions: { conformityId: string; objectId: string }[] }
  integratedIn: string | null
  campaigns: string[]
}

export interface GraphRepo {
  /** Nom du repo dans le workspace (ex. `ll800-produit`, `comp-moteur`). */
  name: string
  label: string
  /** Vrai pour le repo ouvert. */
  isRoot: boolean
}

export interface GraphComponent {
  /** Nom du composant : nom du nœud local, ou nom du repo pour le nœud racine d'un repo. */
  name: string
  label: string
  /** Repo qui déclare le composant. */
  repo: string
}

// ─── Schéma ──────────────────────────────────────────────────────────────────

export interface GraphSchema {
  objectTypes: GraphObjectType[]
  linkTypes: GraphLinkType[]
  /** Statuts d'une entrée de campagne (fixes), dans l'ordre d'affichage. */
  entryStatuses: GraphFixedStatus[]
  /** Statuts d'une campagne (fixes), dans l'ordre du cycle de vie. */
  campaignStatuses: GraphFixedStatus[]
}

export type GraphObjectCategory = 'requirement' | 'test' | 'campaign' | 'change'

export interface GraphObjectType {
  /** Repo dont le schéma déclare le type. */
  repo: string
  /** `<nœud>::<type>` — valeur de `objectTypeRef` des objets de ce type, dans ce repo. */
  ref: string
  /** Composant qui déclare le type. */
  component: string
  label: string
  prefix: string | null
  category: GraphObjectCategory
  fields: GraphFieldDef[]
  /** Statuts dans l'ordre de déclaration ; vide pour une campagne (cf. `campaignStatuses`). */
  statuses: GraphStatusDef[]
  /** GH196 — types de test : champs saisis à chaque exécution (`GraphTestRun.fields`) ; vide sinon. */
  runFields: GraphFieldDef[]
  /** GH196 — types de test : champs saisis à chaque étape exécutée (`GraphStepResult.fields`) ; vide sinon. */
  stepFields: GraphFieldDef[]
}

export interface GraphStatusDef {
  name: string
  label: string
  /** Statut d'approbation du type (au plus un par type). Aucun : `approved` fait foi. */
  isApproval: boolean
  /** Statut terminal (ex. obsolète), masqué des listes par défaut dans Polenta. À inclure ou non
   *  dans un indicateur : au choix du script. */
  isTerminal: boolean
}

export interface GraphFixedStatus {
  name: string
  /** Libellé dans la langue de l'utilisateur. */
  label: string
  /** Position d'affichage (0 = premier). */
  order: number
  /** Entrées seulement : gravité, la plus haute l'emporte pour un « pire statut »
   *  (`FAIL` 4 > `BLOCKED` 3 > `INCOMPLETE` 2 > `pending` 1 > `PASS` 0). */
  severity?: number
}

export type GraphFieldType =
  | 'text' | 'textarea' | 'number' | 'enum' | 'multi_enum' | 'boolean' | 'date' | 'datetime'
  | 'richtext' | 'user' | 'drawio' | 'link'

/**
 * GH195 — valeur d'un champ `link` dans `fields` : un lien, ou une liste si le champ est
 * `multiple`. `label` est absent quand il est vide (afficher alors l'URL). Un fichier édité à la
 * main peut encore porter une chaîne `libellé | URL` : la lire avec prudence.
 */
export interface GraphLinkValue {
  label?: string
  url: string
}

export interface GraphFieldDef {
  name: string
  label: string
  type: GraphFieldType
  /** Valeurs possibles (enum, multi_enum), dans l'ordre de déclaration. */
  values?: string[]
  required: boolean
  /** Validateur déclaré (ex. `EARS`). */
  validator?: string
  /** Vrai si l'historique du champ est conservé dans `history[<name>]`. */
  trackHistory: boolean
  /** GH195 — champ `link` : valeur liste ({@link GraphLinkValue}[]) au lieu d'un seul lien. */
  multiple?: boolean
  /** GH195 — obligation conditionnelle, telle que déclarée dans le schéma. */
  requiredWhen?: Record<string, unknown[]>
}

export interface GraphLinkType {
  name: string
  labelSourceToTarget: string
  labelTargetToSource: string
}

// ─── Objets ──────────────────────────────────────────────────────────────────

export interface GraphObjectBase {
  id: string
  /** Repo où l'objet est stocké ; avec `objectTypeRef`, désigne son type. */
  repo: string
  /** Composant de l'objet : nœud local du schéma ou, à défaut, le repo. */
  component: string
  objectTypeRef: string
  title: string
  /** Nom technique du statut (cf. `GraphObjectType.statuses`). */
  status: string
  version: number | null
  /** Champs personnalisés, tels que stockés. `multi_enum` : chaîne « a, b ». */
  fields: Record<string, unknown>
  /** Historique des champs suivis (`status` et champs `trackHistory`), une liste par champ triée
   *  par date. La dernière entrée est la valeur courante. Une entrée `implicit: true` signale une
   *  valeur dont la date réelle est inconnue (datée par le dernier commit). `{}` si aucun. */
  history: ObjectHistory
  /** Indicateur Polenta : un objet lié a quitté l'approbation, impact à vérifier. */
  needsRevalidation: boolean
  /** Dérivés du git log du fichier ; `null` si jamais commité. */
  createdAt: string | null
  createdBy: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export type GraphCoverageStatus = 'not_covered' | 'covered' | 'validated' | 'failing' | 'needs_revalidation'

export interface GraphRequirement extends GraphObjectBase {
  /** Indicateur Polenta (matrice de traçabilité). */
  coverageStatus: GraphCoverageStatus
}

/** Test : pas de pas de test (`steps`) ni de pré / postconditions dans le contrat v1. */
export type GraphTest = GraphObjectBase

export interface GraphLink {
  id: string
  /** Nom du type de lien (cf. `GraphSchema.linkTypes`). */
  type: string
  sourceId: string
  targetId: string
  /** Repo où le lien est stocké. */
  repo: string
  createdAt: string | null
  createdBy: string | null
}

// ─── Campagnes ───────────────────────────────────────────────────────────────

export type GraphCampaignStatus = 'planned' | 'in_progress' | 'completed' | 'abandoned'
export type GraphEntryStatus = 'pending' | 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE'
export type GraphRunResult = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE'

export interface GraphCampaign {
  id: string
  repo: string
  component: string
  objectTypeRef: string | null
  title: string
  status: GraphCampaignStatus
  fields: Record<string, unknown>
  /** Historique du statut et des champs suivis. */
  history: ObjectHistory
  /** Tag git de la baseline visée, si renseigné. */
  baselineRef: string | null
  /** Composant ciblé par la campagne, si renseigné. */
  targetComponent: string | null
  level: string | null
  createdAt: string
  /** Instant de clôture (`completed` ou `abandoned`), `null` tant qu'elle est ouverte. */
  completedAt: string | null
  /** Entrées actives, dans l'ordre de la campagne. */
  entries: GraphEntry[]
  /** Entrées retirées (depuis GH73), avec `removedAt`. Les entrées retirées avant ne sont pas
   *  connues. */
  removedEntries: GraphRemovedEntry[]
}

export interface GraphEntry {
  /** Unique dans la campagne (ex. `TSYS-0002-1`) ; un test peut avoir plusieurs entrées. */
  entryId: string
  testCaseId: string
  /** Exigence pour laquelle l'instance a été générée, sinon `null`. */
  requirementId: string | null
  /** Dernier verdict ; `pending` = jamais exécutée. */
  status: GraphEntryStatus
  /** Ajout à la campagne ; `null` pour une entrée antérieure à GH73 (repli : `createdAt` de la
   *  campagne). */
  addedAt: string | null
  /** Run du dernier verdict (cf. `GraphTestRun.id`), sinon `null`. */
  runId: string | null
  executedAt: string | null
  executedBy: string | null
  /** Entrée d'une autre campagne dont l'instance a été reportée, sinon `null`. */
  carriedFrom: { campaignId: string; entryId: string } | null
  /** Copie du test figée dans la campagne (titre, statut et version à ce moment), `null` si absente. */
  snapshot: { title: string; status: string; version: number | null } | null
  /** Indicateur Polenta (GH68) : la copie suit encore le test vivant (campagne ouverte, entrée
   *  `pending`, copie non approuvée). Vrai : l'état à considérer est celui du test vivant. */
  resyncable: boolean
}

export interface GraphRemovedEntry extends GraphEntry {
  removedAt: string
}

export interface GraphTestRun {
  id: string
  /** Repo du test exécuté (où le fichier de run est stocké). */
  repo: string
  testCaseId: string
  /** Entrée de campagne qui a lancé l'exécution ; `null` pour une exécution isolée ou antérieure
   *  à GH73. Depuis GH73, tout verdict d'entrée a son run. */
  campaignEntry: { campaignId: string; entryId: string } | null
  requirementId: string | null
  result: GraphRunResult
  executedAt: string
  executedBy: string
  /** Durée en secondes. */
  duration: number
  /** `excel-import` : résultat importé du classeur d'exécution ; `null` : saisi dans l'outil. */
  origin: string | null
  /** GH196 — valeurs des champs d'exécution du type de test (`{}` si aucun) ; un champ retiré du
   *  schéma garde sa valeur (pas de réécriture d'un run). */
  fields: Record<string, unknown>
  /** GH196 — notes globales du testeur (Markdown), `''` si vides. */
  notes: string
  /** GH196 — verdicts d'étape, commentaires et champs d'étape, par ordre d'étape. */
  stepResults: GraphStepResult[]
}

/** GH196 — résultat d'une étape d'un run. */
export interface GraphStepResult {
  order: number
  result: GraphStepResultValue
  /** Commentaire du testeur (Markdown), `''` si vide. */
  comment: string
  fields: Record<string, unknown>
}

export type GraphStepResultValue = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP' | 'NOT_EXECUTED'

// ─── Hôte et sortie ──────────────────────────────────────────────────────────

export type GraphDrillValue = string | number | boolean | null

export interface PolentaHost {
  /** Version majeure du contrat servie par l'application. */
  contractVersion: number
  /** Langue de l'utilisateur. */
  locale: 'fr' | 'en'
  /** Fuseau IANA de l'utilisateur (ex. `Europe/Paris`), pour découper par jour. */
  timezone: string
  /** Décalages de ce fuseau par rapport à UTC, en minutes, avec l'instant à partir duquel chacun
   *  s'applique (trié, couvre les dix dernières années et les deux prochaines). Le moteur n'a pas
   *  `Intl`, et l'heure locale de `Date` (`getHours()`, `getDate()`…) est celle du serveur : pour
   *  découper par jour, utiliser `lib/time.js` (`dayOf`, `dayEnd`), qui lit ce tableau. */
  timezoneOffsets: { from: string; offsetMinutes: number }[]
  /** Date du jour `AAAA-MM-JJ` dans ce fuseau. */
  today: string
  /** Instant de l'exécution (à préférer à `Date.now()` : sortie reproductible). */
  now: string
  /** `null` en exécution normale. Renseigné lors d'un clic sur une marque sans `_ids` : colonnes
   *  de la ligne cliquée ; renvoyer alors cette ou ces lignes **avec** `_ids`. */
  drill: Record<string, GraphDrillValue> | null
  /** Paramètres déclarés par la requête, valeurs choisies à l'affichage (barre du dashboard, GH93) :
   *  une clé par paramètre déclaré, `null` sans valeur (« Tous / Toutes »). Toujours présent (`{}`
   *  si la requête ne déclare rien), non modifiable. Campagne, composant, type d'objet
   *  (`objectTypeRef`), valeur d'énumération, texte : chaîne ; période : `{ from, to }` (jours
   *  `AAAA-MM-JJ`, chacun facultatif). */
  params: Readonly<Record<string, GraphParamValue>>
}

/** Valeur d'un paramètre choisi à l'affichage (GH93). */
export type GraphParamValue = string | { readonly from: string | null; readonly to: string | null } | null

/** Une ligne : valeurs scalaires, plus `_ids` (identifiants des objets d'origine, facultatif). */
export type GraphRow = { _ids?: string[] } & { [column: string]: GraphDrillValue | string[] | undefined }

/** Signature d'un script de données. */
export type DataScript = (data: PolentaGraph, polenta: PolentaHost) => GraphRow[]
/** Signature d'une transformation de widget. */
export type WidgetTransform = (rows: readonly GraphRow[], polenta: PolentaHost) => GraphRow[]

// ─── Historique ──────────────────────────────────────────────────────────────

/** Origine d'une entrée ; absente = saisie dans l'application. */
export type HistorySource = 'mcp' | 'git' | 'schema'

export interface HistoryEntry {
  /** Clé technique (statut, valeur d'enum, valeur brute) ; absente pour un champ « événement seul ». */
  value?: unknown
  /** ISO 8601 UTC à la seconde. */
  at: string
  /** Login ; absent seulement pour une entrée implicite d'un fichier jamais commité. */
  by?: string
  source?: HistorySource
  /** GH163 — commentaire de modification saisi avec le changement (statut, MCP) ; absent si aucun. */
  comment?: string
  /** Lecture seulement (spec §7) : valeur constatée dont la date de changement est inconnue. Jamais écrit. */
  implicit?: true
}

/** Une liste par champ suivi : `status` pour le statut, le nom du champ pour un champ de `fields`. */
export type ObjectHistory = Record<string, HistoryEntry[]>

// ─── Alias courts ────────────────────────────────────────────────────────────

export type Row = GraphRow
export type EntryStatus = GraphEntryStatus
export type RunResult = GraphRunResult
