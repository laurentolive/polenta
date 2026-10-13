import * as path from 'path'
import type alasqlDefault from 'alasql'
import type { Requirement, TestCase, ObjectLink, TestRun, ProjectSchema, TestCampaign, CampaignTestRun } from '@polenta/types'
import { TEST_RUN_STATUS_LABELS, entryProgress, isApprovalStatus, isProgressKey, prepStatusOf, prepStatusOrder, progressRank, progressSubject } from '@polenta/types'
import type {
  BuilderConfig,
  BuilderCondition,
  DrillDownResult,
  DrillDownSelection,
  QueryDefinition,
  RowTarget,
  QueryResult,
  QueryResultColumn,
} from '@polenta/types'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import type { TraceabilityService } from './traceability.service'
import { mergeRunsMaps } from './traceability.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { CampaignsService } from './campaigns.service'
import { CAMPAIGN_ENTRY_FIELDS, CAMPAIGN_FIELD_PREFIX, findObjectTypeDef, resolveObjectTypeLocation, SYSTEM_QUERY_FIELDS } from './schema-lookup.util'
import type { ObjectTypeLocation } from './schema-lookup.util'
import { computeMaturity, REQUIREMENT_DERIVED_FIELDS } from './maturity.util'

type FlatRow = Record<string, unknown>

interface QueryDataset {
  requirements: FlatRow[]
  tests: FlatRow[]
  links: FlatRow[]
  /** GH65 — une ligne par entrée de campagne (`CampaignTestRun`). */
  campaign_entries: FlatRow[]
}

export type QueryTable = 'requirements' | 'tests' | 'campaign_entries'

interface TableInfo {
  table: QueryTable
  /** Champs autorisés en SQL généré par le builder pour ce type — allowlist, pas une
   *  simple protection cosmétique : elle empêche un `BuilderCondition.field` corrompu
   *  (fichier YAML partagé édité à la main, ou payload IPC malformé) de s'échapper des
   *  crochets `[...]` et d'injecter du SQL arbitraire dans la requête générée. */
  allowedFields: Set<string>
}

// Garde-fou mode SQL avancé (T77 §"Moteur de requête"). AlaSQL exécute uniquement sur
// des tableaux JS en mémoire — pas de moteur de stockage, pas de fichiers applicatifs
// exposés par défaut — MAIS il implémente `SELECT ... INTO CSV/JSON/TXT/XLS/XLSX/SQL(path)`,
// qui écrit un fichier arbitraire depuis le process principal Electron. Le garde-fou doit
// donc couvrir l'écriture de fichiers (INTO), pas seulement les mutations de données
// (INSERT/UPDATE/DELETE/DROP/CREATE/ALTER/TRUNCATE/ATTACH). Appliqué à la SQL FINALE,
// que sa source soit le mode SQL brut ou la traduction du builder (défense en profondeur).
const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|ATTACH|INTO)\b/i

/** Enlève le contenu des littéraux `'...'` (guillemets doublés gérés) avant de tester
 *  FORBIDDEN_SQL, pour ne pas rejeter une requête légitime dont un littéral contient
 *  accidentellement un des mots-clés (ex: `WHERE title LIKE '%please update%'`). */
function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''")
}

/** Vrai si `sql` ne contient aucune instruction d'écriture — exporté pour que les tools
 *  MCP (GH18) classent ce refus (`FORBIDDEN_SQL`) avant toute exécution. */
export function isReadOnlySql(sql: string): boolean {
  return !FORBIDDEN_SQL.test(stripStringLiterals(sql))
}

function assertReadOnlySql(sql: string): void {
  if (!isReadOnlySql(sql)) {
    throw new Error(
      'Requête refusée : les instructions INSERT / UPDATE / DELETE / DROP / CREATE / ALTER / TRUNCATE / ATTACH / INTO ne sont pas autorisées (lecture seule).',
    )
  }
}

function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return `'${String(v).replace(/'/g, "''")}'`
}

// `alasql` (~380ms d'exceljs mis à part, alasql seul pèse encore une soixantaine de ms à
// charger) est importé dynamiquement au premier `execute()`/`builderToSql()` plutôt que
// statiquement en haut de fichier (T141) : `QueryEngineService` est construit dans
// `container.ts` dès le boot de l'app, avant qu'aucune requête n'ait été lancée — un
// import statique paierait ce coût à CHAQUE démarrage, pas seulement pour les projets qui
// utilisent l'onglet requêtes. `alasqlPromise` mémoïse le chargement + l'enregistrement de
// l'UDF ci-dessous pour qu'ils ne s'exécutent qu'une seule fois par process.
let alasqlPromise: Promise<typeof alasqlDefault> | undefined

async function getAlasql(): Promise<typeof alasqlDefault> {
  if (!alasqlPromise) {
    alasqlPromise = import('alasql').then((mod) => {
      const alasql = mod.default
      // AlaSQL's LIKE is a thin wrapper that does `pattern.replace(/%/g, '.*')` and feeds
      // the result straight into `new RegExp(...)` (see alasql/dist/alasql.js) — it does
      // NOT implement `_`/`[...]` escaping like real T-SQL, so there is no way to search
      // for a literal `%` via LIKE (any `%` in the value is always turned into a wildcard,
      // even one meant literally). A UDF sidesteps this entirely: plain JS substring
      // match, no wildcard semantics at all, registered once on the shared AlaSQL instance.
      alasql.fn.POLENTA_CONTAINS = (haystack: unknown, needle: unknown): boolean =>
        typeof haystack === 'string' && haystack.toLowerCase().includes(String(needle ?? '').toLowerCase())
      return alasql
    })
  }
  return alasqlPromise
}

const OPERATOR_SQL: Record<BuilderCondition['operator'], (field: string, value: unknown) => string> = {
  '=': (f, v) => `[${f}] = ${sqlValue(v)}`,
  '!=': (f, v) => `[${f}] != ${sqlValue(v)}`,
  '>': (f, v) => `[${f}] > ${sqlValue(v)}`,
  '<': (f, v) => `[${f}] < ${sqlValue(v)}`,
  contains: (f, v) => `POLENTA_CONTAINS([${f}], ${sqlValue(v)}) = true`,
  in: (f, v) => {
    // Le builder propose "in" comme une liste séparée par des virgules dans un champ
    // texte unique (cf. QueryBuilder.tsx) — on la découpe ici si ce n'est pas déjà un
    // tableau, plutôt que d'envoyer la chaîne entière comme unique valeur IN (bug sinon:
    // `status IN ('approved,review')` ne matche jamais rien).
    const list = Array.isArray(v)
      ? v
      : String(v).split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    return `[${f}] IN (${list.map(sqlValue).join(', ')})`
  },
}

/** GH65 — condition d'égalité du drill-down ; `null`/`undefined` (barre « — ») → IS NULL. */
function equalsClause(column: string, value: unknown): string {
  return value === null || value === undefined ? `[${column}] IS NULL` : `[${column}] = ${sqlValue(value)}`
}

/** Valeur filtrable en SQL par égalité (pas un tableau/objet — ex. champ `tags`). */
function isScalar(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== 'object'
}

/** GH65 — même égalité, en JS (repli `result`) : `null` ≡ `undefined`, tableaux/objets par contenu. */
function sameValue(a: unknown, b: unknown): boolean {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  if (!isScalar(a) || !isScalar(b)) return JSON.stringify(a) === JSON.stringify(b)
  return Object.is(a, b)
}

const DATASET_TABLES = new Set(['requirements', 'tests', 'links', 'campaign_entries'])
const ENTRY_STATUSES = new Set<string>(Object.keys(TEST_RUN_STATUS_LABELS))

/** AST AlaSQL minimal utilisé par la réécriture du drill-down (cf. `drillDownStatement`). */
interface AlaColumn { columnid?: string; as?: string; tableid?: string }
interface AlaExpression { expression: unknown }
interface AlaSelect {
  columns?: AlaColumn[]
  from?: Array<{ tableid?: string }>
  where?: AlaExpression
  execute(databaseid: string, params: unknown[]): unknown
  [key: string]: unknown
}

/** Clés d'un SELECT qui rendent la réécriture non représentative (ou dangereuse) → repli. */
const DRILLDOWN_BLOCKING_KEYS = ['joins', 'union', 'unionall', 'except', 'intersect', 'top', 'limit', 'offset', 'fetch', 'into']

/**
 * GH65 — lignes SOURCES d'un élément d'un widget SQL : l'AST de la requête d'origine est modifié
 * (`SELECT *`, sans GROUP BY / HAVING / ORDER BY / DISTINCT, WHERE d'origine `AND` valeurs
 * cliquées) puis EXÉCUTÉ tel quel — jamais re-sérialisé : le `toString()` d'AlaSQL n'échappe pas
 * les apostrophes des littéraux (`'l''eau'` → `'l'eau'`), ce qui changerait le sens du WHERE.
 * Uniquement pour une sélection sur UNE table du dataset (alias conservé), sans jointure, union,
 * sous-requête en FROM, TOP / LIMIT / OFFSET ni INTO, dont chaque colonne cliquée est une colonne
 * simple (directe ou aliasée) et chaque valeur un scalaire — sinon `null` (repli `result`).
 */
function drillDownStatement(alasql: typeof alasqlDefault, sql: string, values: Record<string, unknown>): AlaSelect | null {
  // Classes de l'AST comparées par `instanceof` (jamais par `constructor.name` : le bundle du
  // serveur web est minifié, les noms de classes n'y survivent pas).
  const yy = (alasql as unknown as { yy: Record<string, new (arg: Record<string, unknown>) => unknown> }).yy
  let stmts: AlaSelect[]
  try {
    stmts = (alasql.parse(sql) as unknown as { statements: AlaSelect[] }).statements
  } catch {
    return null
  }
  if (stmts.length !== 1) return null
  const s = stmts[0]
  if (!(s instanceof yy.Select)) return null
  if (DRILLDOWN_BLOCKING_KEYS.some((k) => s[k] !== undefined && s[k] !== null)) return null
  if (!s.from || s.from.length !== 1 || !(s.from[0] instanceof yy.Table)) return null
  const table = s.from[0].tableid
  if (!table || !DATASET_TABLES.has(table)) return null

  const columns = s.columns ?? []
  const isColumn = (c: AlaColumn) => c instanceof yy.Column
  const hasStar = columns.some((c) => isColumn(c) && c.columnid === '*')
  const clauses: string[] = []
  for (const [name, value] of Object.entries(values)) {
    if (!isScalar(value)) return null
    const col = columns.find((c) => (c.as ?? c.columnid) === name)
    let source: string | undefined
    if (col) source = isColumn(col) ? col.columnid : undefined
    else if (hasStar) source = name
    if (!source || source === '*' || source.includes(']')) return null
    clauses.push(equalsClause(source, value))
  }

  // Conditions cliquées : analysées depuis un SQL que nous générons (valeurs échappées par sqlValue).
  let ours: unknown = null
  if (clauses.length) {
    try {
      const parsed = (alasql.parse(`SELECT * FROM t WHERE ${clauses.join(' AND ')}`) as unknown as { statements: AlaSelect[] }).statements[0]
      ours = parsed.where?.expression ?? null
    } catch {
      return null
    }
  }
  s.columns = [new yy.Column({ columnid: '*' }) as AlaColumn]
  for (const k of ['group', 'having', 'order', 'distinct']) delete s[k]
  if (ours) {
    s.where = (s.where
      ? new yy.Expression({ expression: new yy.Op({ left: s.where.expression, op: 'AND', right: ours }) })
      : new yy.Expression({ expression: ours })) as AlaExpression
  }
  return s
}

function inferColumns(rows: FlatRow[]): QueryResultColumn[] {
  if (rows.length === 0) return []
  return Object.keys(rows[0]).map((name) => {
    const v = rows[0][name]
    let type: QueryResultColumn['type'] = 'string'
    if (typeof v === 'number') type = 'number'
    else if (typeof v === 'boolean') type = 'boolean'
    else if (v instanceof Date) type = 'date'
    return { name, type }
  })
}

// ─── Flattening helpers ────────────────────────────────────────────────────────
// Les champs custom (`fields{}`) sont étalés au premier niveau de chaque ligne pour
// être directement filtrables/groupables en SQL (`WHERE priority = 'high'`), sans
// syntaxe d'accès imbriqué. Les champs système sont posés APRÈS le spread pour
// toujours l'emporter en cas de collision de nom avec un champ custom.

/**
 * `derived` (coverageStatus + the 5 maturity columns, T77 sprint 3) is spread AFTER
 * the system fields, following the same "always wins on name collision" convention
 * already used for `r.fields` vs. the system columns above it — see
 * maturity.util.ts's MaturityColumns doc comment.
 */
function flattenRequirement(r: Requirement, component: string, derived: FlatRow): FlatRow {
  return {
    ...r.fields,
    id: r.id,
    objectTypeRef: r.objectTypeRef,
    title: r.title,
    status: r.status,
    version: r.version,
    needsRevalidation: !!r.needsRevalidation,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
    component,
    ...derived,
  }
}

function flattenTestCase(tc: TestCase, component: string, latestRun: TestRun | undefined): FlatRow {
  return {
    ...tc.fields,
    id: tc.id,
    objectTypeRef: tc.objectTypeRef,
    title: tc.title,
    status: tc.status,
    needsRevalidation: !!tc.needsRevalidation,
    createdAt: tc.createdAt,
    createdBy: tc.createdBy,
    updatedAt: tc.updatedAt,
    updatedBy: tc.updatedBy,
    component,
    latestRunResult: latestRun?.result ?? null,
    latestRunDate: latestRun?.executedAt ?? null,
  }
}

/**
 * `component` on a dataset row must break out each of a repo's own local components
 * (T123: `SystemNode.children`, nested arbitrarily under `root`) individually, not just
 * the repo/submodule they all happen to live in — otherwise several local components
 * sharing one repo collapse into a single `component` value (the repo/mount tag alone),
 * which is what `resolveRepos()` produces. Prefers the ref's own resolved `nodeName`
 * (recursed to any depth by `resolveObjectTypeLocation`) over the repo-level tag; falls
 * back to it when the ref resolves to `root` (the repo's own default/sole node — the
 * pre-T123 case, kept unchanged for the many projects that never add local components)
 * or can't be resolved at all (cross-component ref, hand-edited YAML, deleted type).
 */
function rowComponentFor(location: ObjectTypeLocation | null | 'unresolvable', repoComponent: string): string {
  if (location && location !== 'unresolvable' && location.nodeName !== 'root') return location.nodeName
  return repoComponent
}

function flattenLink(l: ObjectLink, component: string): FlatRow {
  return {
    id: l.id,
    type: l.type,
    sourceId: l.sourceId,
    targetId: l.targetId,
    coverageType: l.coverageType ?? null,
    createdAt: l.createdAt,
    createdBy: l.createdBy,
    component,
  }
}

/**
 * GH65 — une entrée de campagne, dans son dernier état. Les champs personnalisés de la campagne
 * sont préfixés `campaign_` (une campagne a souvent son propre `status`/`title`, qui écraserait
 * les colonnes de l'entrée) et posés AVANT les colonnes système, comme ailleurs. `objectTypeRef`
 * doublonne `campaignObjectTypeRef` : le builder filtre toujours sur `[objectTypeRef]`.
 */
function flattenCampaignEntry(
  c: TestCampaign,
  run: CampaignTestRun,
  component: string,
  testTitle: string | null,
  progress: CampaignEntryProgress,
): FlatRow {
  const custom: FlatRow = {}
  for (const [k, v] of Object.entries(c.fields ?? {})) custom[CAMPAIGN_FIELD_PREFIX + k] = v
  return {
    ...custom,
    campaignId: c.id,
    campaignTitle: c.title,
    campaignStatus: c.status,
    objectTypeRef: c.objectTypeRef ?? null,
    campaignObjectTypeRef: c.objectTypeRef ?? null,
    baselineRef: c.baselineRef ?? null,
    // GH69 — ordre chronologique des colonnes du widget matrice (`ORDER BY campaignCreatedAt`).
    campaignCreatedAt: c.createdAt ?? null,
    level: c.level ?? null,
    campaignComponent: c.component ?? null,
    component,
    entryId: run.entryId,
    testCaseId: run.testCaseId,
    requirementId: run.requirementId ?? null,
    testTitle,
    status: run.status,
    executed: run.status !== 'pending',
    executedAt: run.executedAt ?? null,
    // Préfixe date de l'ISO stocké (UTC) — regroupement jour par jour sans dépendre du fuseau.
    executedDay: run.executedAt ? run.executedAt.slice(0, 10) : null,
    executedBy: run.executedBy ?? null,
    runId: run.runId ?? null,
    progress: progress.progress,
    progressRank: progress.progressRank,
    testStatus: progress.testStatus,
  }
}

interface CampaignEntryProgress {
  progress: string
  progressRank: number
  testStatus: string | null
}

/** Rang des statuts de préparation par schéma (calculé une fois par dataset et par schéma). */
const prepOrderCache = new WeakMap<ProjectSchema, Map<string, number>>()
function prepOrderOf(schema: ProjectSchema | null): Map<string, number> {
  if (!schema) return new Map()
  let order = prepOrderCache.get(schema)
  if (!order) prepOrderCache.set(schema, (order = prepStatusOrder(schema)))
  return order
}

/**
 * GH71 — étape d'avancement d'une entrée (`campaign-progress.ts`). Statut d'approbation jugé dans le
 * type du test, contre le schéma du repo où vit le test (`schema`) — à défaut (test supprimé), celui
 * de la campagne. Rang : même ordre que le renderer (`prepStatusOrder`, plus petite position d'un
 * statut parmi les types de test du schéma), pour qu'une même étape ait toujours le même rang.
 */
function campaignEntryProgress(
  c: TestCampaign,
  run: CampaignTestRun,
  live: TestCase | undefined,
  schema: ProjectSchema | null,
): CampaignEntryProgress {
  const typeDefOf = (ref: string) => {
    const found = schema ? findObjectTypeDef(schema, ref) : null
    return found && found !== 'unresolvable' ? found : null
  }
  const isApproved = (t: TestCase) => isApprovalStatus(typeDefOf(t.objectTypeRef), t.status)
  const subject = progressSubject(run, live, c.status === 'planned' || c.status === 'in_progress', isApproved)
  const progress = entryProgress(run, subject, isApproved)
  const status = prepStatusOf(progress)
  const statusIndex = status !== null ? prepOrderOf(schema).get(status) : undefined
  return { progress, progressRank: progressRank(progress, statusIndex), testStatus: subject?.status ?? null }
}

/**
 * QueryEngineService — T77 sprint 1, étendu sprint 3 (coverageStatus + critères de
 * maturité, cf. maturity.util.ts).
 *
 * Construit un dataset agrégé (repo courant + composants submodules) à partir des
 * services d'index déjà en mémoire (RequirementsIndexService, TestsIndexService),
 * et exécute une requête (builder ou SQL brut) via AlaSQL. Le dataset n'est JAMAIS
 * persisté sur disque ni mis en cache : il est reconstruit à chaque exécution,
 * cohérent avec l'esprit "index en mémoire reconstruit depuis le working tree"
 * (SPEC.md §5).
 */
export class QueryEngineService {
  constructor(
    private readonly reqIndex: RequirementsIndexService,
    private readonly testsIndex: TestsIndexService,
    private readonly schema: SchemaService,
    private readonly traceability: TraceabilityService,
    private readonly workspaceTree?: WorkspaceTreeService,
    /** GH65 — source de `campaign_entries` ; absent : table vide. */
    private readonly campaigns?: CampaignsService,
  ) {}

  /**
   * Resolve every (repoPath, component) pair in scope: the current repo plus every
   * submodule component from the workspace tree cache when a workspaceDir is given.
   * Mono-repo projects (no workspaceDir / no cached tree yet) just get the current
   * repo, tagged with its own directory name as `component` — no regression for
   * projects without submodules (T77-tests.md cas limite).
   */
  private async resolveRepos(repoPath: string, workspaceDir?: string): Promise<{ repoPath: string; component: string }[]> {
    if (workspaceDir && this.workspaceTree) {
      const tree = await this.workspaceTree.readCache(workspaceDir)
      if (tree) {
        const byPath = new Map<string, string>()
        for (const node of tree.nodes) {
          if (node.repoPath) byPath.set(node.repoPath, node.name)
        }
        if (!byPath.has(repoPath)) byPath.set(repoPath, path.basename(repoPath))
        return Array.from(byPath, ([rp, component]) => ({ repoPath: rp, component }))
      }
    }
    return [{ repoPath, component: path.basename(repoPath) }]
  }

  /** Raw (unflattened) per-repo fetch — requirements/tests/links/schema for one
   *  component, tagged with its name. Kept separate from flattening/derived-column
   *  computation because coverage/revalidation (below) must be computed over the
   *  FULL cross-component graph, not repo-by-repo — see `buildDataset()`. */
  private async fetchRepoRaw(rp: string, component: string) {
    const [requirements, testCases, latestRunMap, links, schema, runsMap, campaigns] = await Promise.all([
      this.reqIndex.findAll(rp, {}),
      this.testsIndex.findAll(rp),
      this.testsIndex.getLatestRunMap(rp),
      this.reqIndex.findAllLinks(rp),
      this.schema.get(rp),
      this.testsIndex.getRunsMap(rp),
      this.listCampaigns(rp),
    ])
    return { component, requirements, testCases, latestRunMap, links, schema, runsMap, campaigns }
  }

  /**
   * GH65 — campagnes d'un repo pour `campaign_entries`. Un fichier campagne illisible (YAML abîmé à
   * la main ou par un merge) ne doit pas casser TOUTES les requêtes — y compris celles qui ne lisent
   * que `requirements` : la table reste vide pour ce repo, avertissement journalisé.
   */
  private async listCampaigns(rp: string): Promise<TestCampaign[]> {
    if (!this.campaigns) return []
    try {
      return await this.campaigns.list(rp)
    } catch (err) {
      console.warn(`[query-engine] campagnes ignorées pour ${rp} :`, err instanceof Error ? err.message : String(err))
      return []
    }
  }

  /**
   * GH65 — constructions en cours, par (repo, workspace) : les widgets d'un dashboard se
   * rafraîchissent ensemble (un résultat saisi invalide tous les widgets ouverts) et partagent
   * ainsi UNE construction du dataset. Rien n'est conservé une fois la promesse résolue — le
   * dataset reste reconstruit à chaque exécution (SPEC-DASHBOARDS §2).
   */
  private readonly inFlightDatasets = new Map<string, Promise<QueryDataset>>()

  async buildDataset(repoPath: string, workspaceDir?: string): Promise<QueryDataset> {
    const key = `${repoPath}\u0000${workspaceDir ?? ''}`
    const pending = this.inFlightDatasets.get(key)
    if (pending) return pending
    const build = this.doBuildDataset(repoPath, workspaceDir).finally(() => this.inFlightDatasets.delete(key))
    this.inFlightDatasets.set(key, build)
    return build
  }

  private async doBuildDataset(repoPath: string, workspaceDir?: string): Promise<QueryDataset> {
    const repos = await this.resolveRepos(repoPath, workspaceDir)
    const perRepo = await Promise.all(repos.map(({ repoPath: rp, component }) => this.fetchRepoRaw(rp, component)))

    // Coverage (T77 sprint 3 derived column) must be computed
    // over the FULL cross-component link graph, not per repo in isolation: a
    // verification link relevant to a requirement in one component's repo can be
    // stored in — or reference a test case living in — a different component's repo
    // (T69/T70 cross-component links; IDs are globally unique per CLAUDE.md's prefix
    // convention, so this is a real, reachable case, not a hypothetical one).
    // `traceability.service.ts`'s `getMatrix()` aggregates the exact same way
    // (`resolveRepoPaths`) before calling `computeCoverage()` — computing per-repo
    // here would silently disagree with the Matrice de traçabilité for any such
    // cross-component link (found in T77 sprint 3 review, fixed before this was ever
    // shipped).
    const allRequirements = perRepo.flatMap((r) => r.requirements)
    const allTestCases = perRepo.flatMap((r) => r.testCases)
    const allLinks = perRepo.flatMap((r) => r.links)
    const tcMap = new Map(allTestCases.map((tc) => [tc.id, tc]))
    // GH71 — schéma du repo où vit chaque test (étape d'avancement jugée dans son type).
    const tcSchemas = new Map(perRepo.flatMap(({ testCases, schema }) => testCases.map((tc) => [tc.id, schema] as const)))
    const latestRunMap = new Map<string, TestRun>()
    for (const r of perRepo) for (const [id, run] of r.latestRunMap) latestRunMap.set(id, run)

    // Reuses TraceabilityService's own T63-fixed aggregation (see its doc comment) —
    // no re-derivation of the test↔requirement link matching here.
    const runsMap = mergeRunsMaps(perRepo.map((r) => r.runsMap))
    const coverage = this.traceability.computeCoverage(allRequirements, allLinks, tcMap, latestRunMap, runsMap)

    // Schema resolution stays PER REPO (unlike coverage above): a requirement's
    // `objectTypeRef` is only meaningful against its OWN component's local
    // schema.yaml (each component repo is schema-autonomous per CLAUDE.md — a
    // submodule node's `objectTypes` aren't necessarily mirrored in the product's
    // schema). `resolveLocation` is memoized per repo (a handful of distinct
    // objectTypeRefs shared by potentially thousands of requirements) rather than
    // calling `resolveObjectTypeLocation` once per requirement.
    const requirementRows = perRepo.flatMap(({ component, requirements, schema }) => {
      const locationCache = new Map<string, ObjectTypeLocation | null | 'unresolvable'>()
      const resolveLocation = (ref: string) => {
        const cached = locationCache.get(ref)
        if (cached !== undefined) return cached
        const found = resolveObjectTypeLocation(schema as ProjectSchema, ref)
        locationCache.set(ref, found)
        return found
      }
      return requirements.map((r) => {
        const coverageStatus = coverage.get(r.id)?.coverageStatus ?? 'not_covered'
        const location = resolveLocation(r.objectTypeRef)
        const typeDef = location && location !== 'unresolvable' ? location.typeDef : null
        const rowComponent = rowComponentFor(location, component)
        const maturity = computeMaturity(r, typeDef, coverageStatus, !!r.needsRevalidation)
        return flattenRequirement(r, rowComponent, { coverageStatus, ...maturity })
      })
    })

    return {
      requirements: requirementRows,
      tests: perRepo.flatMap(({ component, testCases, latestRunMap, schema }) => {
        const locationCache = new Map<string, ObjectTypeLocation | null | 'unresolvable'>()
        return testCases.map((tc) => {
          let location = locationCache.get(tc.objectTypeRef)
          if (location === undefined) {
            location = resolveObjectTypeLocation(schema as ProjectSchema, tc.objectTypeRef)
            locationCache.set(tc.objectTypeRef, location)
          }
          return flattenTestCase(tc, rowComponentFor(location, component), latestRunMap.get(tc.id))
        })
      }),
      links: perRepo.flatMap(({ component, links }) => links.map((l) => flattenLink(l, component))),
      campaign_entries: perRepo.flatMap(({ component, campaigns, schema }) =>
        campaigns.flatMap((c) => {
          const location = c.objectTypeRef ? resolveObjectTypeLocation(schema as ProjectSchema, c.objectTypeRef) : null
          const rowComponent = rowComponentFor(location, component)
          return (c.runs ?? []).map((run) => {
            const live = tcMap.get(run.testCaseId)
            const testSchema = (tcSchemas.get(run.testCaseId) ?? schema ?? null) as ProjectSchema | null
            return flattenCampaignEntry(
              c, run, rowComponent, run.testSnapshot?.title ?? live?.title ?? null,
              campaignEntryProgress(c, run, live, testSchema),
            )
          })
        }),
      ),
    }
  }

  /**
   * Translate a BuilderConfig into the SQL that would actually run — exposed standalone
   * so the renderer can pre-fill the advanced SQL editor when the user switches mode
   * (T77-tests.md scenario 2 : "le SQL généré équivalent est pré-rempli et modifiable").
   */
  async builderToSql(repoPath: string, config: BuilderConfig, workspaceDir?: string): Promise<string> {
    const info = await this.resolveTableInfo(repoPath, config.objectTypeRef, config.component, workspaceDir)
    const sql = this.buildSql(config, info)
    assertReadOnlySql(sql)
    return sql
  }

  async execute(repoPath: string, queryDef: QueryDefinition, workspaceDir?: string): Promise<QueryResult> {
    const dataset = await this.buildDataset(repoPath, workspaceDir)

    let sql: string
    if (queryDef.mode === 'sql') {
      sql = (queryDef.sqlText ?? '').trim()
      if (!sql) throw new Error('Requête SQL vide.')
    } else {
      if (!queryDef.builderConfig) throw new Error('builderConfig requis en mode builder.')
      const info = await this.resolveTableInfo(repoPath, queryDef.builderConfig.objectTypeRef, queryDef.builderConfig.component, workspaceDir)
      sql = this.buildSql(queryDef.builderConfig, info)
    }

    return this.runSql(dataset, sql)
  }

  /** Exécute `sql` (garde-fou lecture seule compris) sur un dataset déjà construit. */
  private async runSql(dataset: QueryDataset, sql: string): Promise<QueryResult> {
    // Vérifié pour les deux modes (pas seulement le SQL brut) — défense en profondeur :
    // si buildSql() est un jour étendu et laisse passer un nom de champ non allowlisté,
    // ce garde-fou reste la dernière barrière avant exécution.
    assertReadOnlySql(sql)

    return this.runOnDataset(dataset, (alasql) => alasql(sql))
  }

  /** Lie les tables du dataset puis exécute `run` — sans `await` entre les deux (voir ci-dessous). */
  private async runOnDataset(dataset: QueryDataset, run: (alasql: typeof alasqlDefault) => unknown): Promise<QueryResult> {
    const alasql = await getAlasql()

    // Les tables sont réassignées juste avant l'exécution synchrone d'AlaSQL — aucun
    // `await` n'intervient entre l'assignation et l'exec, donc pas de risque de course
    // avec une autre requête concurrente qui écraserait les tables entre-temps.
    alasql.tables.requirements = { data: dataset.requirements }
    alasql.tables.tests = { data: dataset.tests }
    alasql.tables.links = { data: dataset.links }
    alasql.tables.campaign_entries = { data: dataset.campaign_entries }

    let rows: FlatRow[]
    try {
      rows = run(alasql) as FlatRow[]
      if (!Array.isArray(rows)) rows = []
    } catch (err) {
      throw new Error(`Requête invalide : ${err instanceof Error ? err.message : String(err)}`)
    }

    return { columns: inferColumns(rows), rows }
  }

  /** Repli du drill-down : lignes du résultat d'origine portant les valeurs cliquées. */
  private async filteredResult(dataset: QueryDataset, sql: string, values: Record<string, unknown>): Promise<DrillDownResult> {
    const result = await this.runSql(dataset, sql)
    const rows = result.rows.filter((row) => Object.entries(values).every(([name, value]) => sameValue(row[name], value)))
    return { mode: 'result', columns: result.columns, rows }
  }

  /**
   * GH65 — lignes qui composent l'élément cliqué d'un widget (barre, segment, part, point, KPI).
   * Builder : `groupBy` retiré, valeurs cliquées ajoutées en `AND` aux conditions de l'utilisateur
   * (quel que soit leur combinator) ; une colonne hors allowlist (ex. `count`) est ignorée. SQL :
   * réécriture (`rewriteSqlForDrillDown`) ou, à défaut, lignes du résultat d'origine filtrées.
   */
  async drillDown(repoPath: string, queryDef: QueryDefinition, selection: DrillDownSelection, workspaceDir?: string): Promise<DrillDownResult> {
    const values = selection?.values ?? {}
    const dataset = await this.buildDataset(repoPath, workspaceDir)

    if (queryDef.mode === 'builder') {
      if (!queryDef.builderConfig) throw new Error('builderConfig requis en mode builder.')
      const config = queryDef.builderConfig
      const info = await this.resolveTableInfo(repoPath, config.objectTypeRef, config.component, workspaceDir)
      // Colonne cliquée hors allowlist (ex. `count`) ou valeur non scalaire : le filtre ne peut pas
      // être appliqué aux lignes sources — repli explicite plutôt que des lignes non filtrées.
      const filterable = Object.entries(values).every(([name, value]) => info.allowedFields.has(name) && isScalar(value))
      if (!filterable) return this.filteredResult(dataset, this.buildSql(config, info), values)
      const extra = Object.entries(values).map(([name, value]) => equalsClause(name, value))
      const sql = this.buildSql({ ...config, groupBy: undefined }, info, extra)
      return { mode: 'source', ...(await this.runSql(dataset, sql)) }
    }

    const sql = (queryDef.sqlText ?? '').trim()
    if (!sql) throw new Error('Requête SQL vide.')
    assertReadOnlySql(sql)
    const alasql = await getAlasql()
    const stmt = drillDownStatement(alasql, sql, values)
    if (stmt) {
      try {
        return { mode: 'source', ...(await this.runOnDataset(dataset, (a) => stmt.execute(a.useid, []))) }
      } catch {
        // Requête modifiée refusée à l'exécution : repli sur le résultat.
      }
    }
    return this.filteredResult(dataset, sql, values)
  }

  /** GH71 — étape d'avancement d'une entrée : test cherché dans les repos du périmètre, jugé dans
   *  le schéma de son repo (à défaut, celui de la campagne). */
  private async entryProgressFor(
    campaign: TestCampaign,
    run: CampaignTestRun,
    campaignRepo: string,
    repos: { repoPath: string }[],
  ): Promise<string> {
    let live: TestCase | undefined
    let testRepo = campaignRepo
    for (const { repoPath: rp } of repos) {
      const found = await this.testsIndex.findById(rp, run.testCaseId)
      if (found) { live = found; testRepo = rp; break }
    }
    const schema = await this.schema.get(testRepo).catch(() => null)
    return campaignEntryProgress(campaign, run, live, schema).progress
  }

  /**
   * GH65 — objet à ouvrir pour une ligne de résultat (widget table, popup de détail), retrouvé dans
   * les repos du périmètre — la ligne ne porte jamais de chemin. Ordre : entrée de campagne
   * (`campaignId` + `entryId`), campagne (`campaignId`), puis `id` (exigence, test, campagne).
   */
  async resolveRowTarget(repoPath: string, row: Record<string, unknown>, workspaceDir?: string): Promise<RowTarget | null> {
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const repos = await this.resolveRepos(repoPath, workspaceDir)
    const findCampaign = async (id: string) => {
      for (const { repoPath: rp } of repos) {
        const c = (await this.listCampaigns(rp)).find((x) => x.id === id)
        if (c) return { campaign: c, repoPath: rp }
      }
      return null
    }

    const campaignId = str(row.campaignId)
    if (campaignId) {
      const found = await findCampaign(campaignId)
      if (!found) return null
      const entryId = str(row.entryId)
      const entry = entryId ? found.campaign.runs?.find((r) => r.entryId === entryId) : undefined
      if (entry) {
        if (entry.status !== 'pending') return { kind: 'campaign-run', campaignId, entryId: entry.entryId, repoPath: found.repoPath }
        // GH71 — page de la campagne filtrée sur l'étape d'avancement de l'entrée : celle de la ligne
        // (même valeur que le widget), sinon recalculée.
        const rowProgress = str(row.progress)
        const progress = rowProgress && isProgressKey(rowProgress)
          ? rowProgress
          : await this.entryProgressFor(found.campaign, entry, found.repoPath, repos).catch(() => null)
        return progress
          ? { kind: 'campaign', id: campaignId, repoPath: found.repoPath, progress }
          : { kind: 'campaign', id: campaignId, repoPath: found.repoPath, status: 'pending' }
      }
      const status = str(row.status)
      const progress = str(row.progress)
      return {
        kind: 'campaign', id: campaignId, repoPath: found.repoPath,
        ...(status && ENTRY_STATUSES.has(status) ? { status } : {}),
        ...(progress && isProgressKey(progress) ? { progress } : {}),
      }
    }

    const id = str(row.id)
    if (!id) return null
    for (const { repoPath: rp } of repos) {
      if (await this.reqIndex.findById(rp, id)) return { kind: 'requirement', id, repoPath: rp }
      if (await this.testsIndex.findById(rp, id)) return { kind: 'test', id, repoPath: rp }
    }
    const campaign = await findCampaign(id)
    return campaign ? { kind: 'campaign', id, repoPath: campaign.repoPath } : null
  }

  /** `extra` (GH65, drill-down) : clauses ajoutées en `AND`, après les conditions de l'utilisateur. */
  private buildSql(config: BuilderConfig, info: TableInfo, extra: string[] = []): string {
    const assertField = (f: string): string => {
      if (!info.allowedFields.has(f)) {
        throw new Error(`Champ inconnu pour ce type d'objet : ${f}`)
      }
      return f
    }

    // `objectTypeRef` seul n'est pas unique projet-wide : chaque composant nomme son
    // propre nœud local "root" (CLAUDE.md), donc deux composants peuvent tous les deux
    // avoir un type "root::exigence-fw". `component` (tag posé par `flattenRequirement`/
    // `flattenTestCase` à partir du mount name workspace) lève l'ambiguïté quand le type
    // sélectionné appartient à un composant submodule — absent pour un type du repo
    // courant/racine, où `objectTypeRef` seul suffisait déjà (T93).
    const scopeClauses = [`[objectTypeRef] = ${sqlValue(config.objectTypeRef)}`]
    if (config.component) scopeClauses.push(`[component] = ${sqlValue(config.component)}`)
    const scope = scopeClauses.join(' AND ')
    const condClauses = config.conditions.map((c) => {
      const fn = OPERATOR_SQL[c.operator]
      if (!fn) throw new Error(`Opérateur non supporté : ${c.operator}`)
      return fn(assertField(c.field), c.value)
    })
    const condPart = (condClauses.length ? ` AND (${condClauses.join(` ${config.combinator} `)})` : '')
      + extra.map((clause) => ` AND ${clause}`).join('')
    const groupBy = config.groupBy?.length ? config.groupBy.map((f) => `[${assertField(f)}]`) : []
    const select = groupBy.length ? `${groupBy.join(', ')}, COUNT(*) AS [count]` : '*'
    const groupByClause = groupBy.length ? ` GROUP BY ${groupBy.join(', ')}` : ''
    return `SELECT ${select} FROM [${info.table}] WHERE ${scope}${condPart}${groupByClause}`
  }

  /**
   * Resolve which dataset table (requirements | tests) an objectTypeRef maps to, and
   * the set of field names the builder is allowed to reference for it (system columns
   * + this type's own custom fields). An unresolvable ref (cross-component, or deleted
   * from the schema) falls back to `requirements` with only system fields allowed —
   * never trusts an unverifiable type with arbitrary custom field names.
   *
   * When `component` is set, `objectTypeRef` is resolved against THAT component's own
   * schema.yaml (mount name looked up in the workspace tree cache), not `repoPath`'s —
   * mirroring how `objectTypeRef` is only ever meaningful against its own component's
   * local schema (see `buildDataset()`'s per-repo schema comment). Falls back to
   * `repoPath` itself if the component can't be resolved (no workspace tree, unknown
   * mount name) — same "unresolvable → system fields only" safety net as before (T93).
   */
  private async resolveTableInfo(
    repoPath: string,
    objectTypeRef: string,
    component: string | undefined,
    workspaceDir: string | undefined,
  ): Promise<TableInfo & { resolved: boolean }> {
    const targetRepo = component ? (await this.resolveComponentPath(component, workspaceDir)) ?? repoPath : repoPath
    const schema = await this.schema.get(targetRepo)
    const found = findObjectTypeDef(schema, objectTypeRef)
    const resolved = found && found !== 'unresolvable' ? found : null

    // GH65 — un type de campagne se requête sur ses entrées : colonnes propres, champs préfixés.
    if (resolved?.category === 'campaign') {
      const campaignFields = resolved.fields.map((f) => CAMPAIGN_FIELD_PREFIX + f.name)
      return { table: 'campaign_entries', allowedFields: new Set([...CAMPAIGN_ENTRY_FIELDS, ...campaignFields]), resolved: true }
    }
    const table: QueryTable = resolved?.category === 'test' ? 'tests' : 'requirements'
    const extra: readonly string[] = table === 'tests' ? ['latestRunResult', 'latestRunDate'] : REQUIREMENT_DERIVED_FIELDS
    const typeFields = resolved?.fields.map((f) => f.name) ?? []
    return { table, allowedFields: new Set([...SYSTEM_QUERY_FIELDS, ...extra, ...typeFields]), resolved: !!resolved }
  }

  /**
   * GH18 — cible d'un builderConfig SANS repli silencieux, pour la validation stricte des
   * tools MCP : `resolved: false` si le type est introuvable dans le schéma du composant.
   * L'exécution (`execute`/`builderToSql`) garde le repli historique de
   * `resolveTableInfo` (type supprimé du schéma → requête toujours exécutable côté UI).
   */
  async inspectBuilderTarget(
    repoPath: string,
    objectTypeRef: string,
    component: string | undefined,
    workspaceDir?: string,
  ): Promise<{ resolved: boolean; table: QueryTable; allowedFields: string[] }> {
    // Composant nommé mais introuvable : resolveTableInfo retomberait sur repoPath et
    // pourrait y résoudre un type homonyme — refusé ici (faute de frappe sur `component`).
    const componentMissing = !!component && !(await this.resolveComponentPath(component, workspaceDir))
    const info = await this.resolveTableInfo(repoPath, objectTypeRef, component, workspaceDir)
    return { resolved: info.resolved && !componentMissing, table: info.table, allowedFields: [...info.allowedFields] }
  }

  /** Look up a workspace component's repo path by its mount name (tree.yaml), same
   *  lookup `resolveRepos()` above already does per-node — factored out here since
   *  `resolveTableInfo` needs it standalone, keyed by name rather than iterating. */
  private async resolveComponentPath(component: string, workspaceDir?: string): Promise<string | null> {
    if (!workspaceDir || !this.workspaceTree) return null
    const tree = await this.workspaceTree.readCache(workspaceDir)
    return tree?.nodes.find((n) => n.name === component)?.repoPath ?? null
  }
}
