import * as path from 'path'
import type alasqlDefault from 'alasql'
import type { Requirement, TestCase, ObjectLink, TestRun, ProjectSchema } from '@polenta/types'
import type {
  BuilderConfig,
  BuilderCondition,
  QueryDefinition,
  QueryResult,
  QueryResultColumn,
} from '@polenta/types'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import type { TraceabilityService } from './traceability.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import { findObjectTypeDef, resolveObjectTypeLocation, SYSTEM_QUERY_FIELDS } from './schema-lookup.util'
import type { ObjectTypeLocation } from './schema-lookup.util'
import { computeMaturity, REQUIREMENT_DERIVED_FIELDS } from './maturity.util'

type FlatRow = Record<string, unknown>

interface QueryDataset {
  requirements: FlatRow[]
  tests: FlatRow[]
  links: FlatRow[]
}

type QueryTable = 'requirements' | 'tests'

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

function assertReadOnlySql(sql: string): void {
  if (FORBIDDEN_SQL.test(stripStringLiterals(sql))) {
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
    needsRevalidation: l.needsRevalidation,
    coverageType: l.coverageType ?? null,
    createdAt: l.createdAt,
    createdBy: l.createdBy,
    component,
  }
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
    const [requirements, testCases, latestRunMap, links, schema] = await Promise.all([
      this.reqIndex.findAll(rp, {}),
      this.testsIndex.findAll(rp),
      this.testsIndex.getLatestRunMap(rp),
      this.reqIndex.findAllLinks(rp),
      this.schema.get(rp),
    ])
    return { component, requirements, testCases, latestRunMap, links, schema }
  }

  async buildDataset(repoPath: string, workspaceDir?: string): Promise<QueryDataset> {
    const repos = await this.resolveRepos(repoPath, workspaceDir)
    const perRepo = await Promise.all(repos.map(({ repoPath: rp, component }) => this.fetchRepoRaw(rp, component)))

    // Coverage and needsRevalidation (T77 sprint 3 derived columns) must be computed
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
    const latestRunMap = new Map<string, TestRun>()
    for (const r of perRepo) for (const [id, run] of r.latestRunMap) latestRunMap.set(id, run)

    // Reuses TraceabilityService's own T63-fixed aggregation (see its doc comment) —
    // no re-derivation of the test↔requirement link matching here.
    const coverage = this.traceability.computeCoverage(allRequirements, allLinks, tcMap, latestRunMap)
    const revalidationReqIds = this.traceability.computeRevalidationReqIds(allLinks)

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
        const maturity = computeMaturity(r, typeDef, coverageStatus, revalidationReqIds.has(r.id))
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

    // Vérifié pour les deux modes (pas seulement le SQL brut) — défense en profondeur :
    // si buildSql() est un jour étendu et laisse passer un nom de champ non allowlisté,
    // ce garde-fou reste la dernière barrière avant exécution.
    assertReadOnlySql(sql)

    const alasql = await getAlasql()

    // Les tables sont réassignées juste avant l'exécution synchrone d'AlaSQL — aucun
    // `await` n'intervient entre l'assignation et l'exec, donc pas de risque de course
    // avec une autre requête concurrente qui écraserait les tables entre-temps.
    alasql.tables.requirements = { data: dataset.requirements }
    alasql.tables.tests = { data: dataset.tests }
    alasql.tables.links = { data: dataset.links }

    let rows: FlatRow[]
    try {
      rows = alasql(sql) as FlatRow[]
      if (!Array.isArray(rows)) rows = []
    } catch (err) {
      throw new Error(`Requête invalide : ${err instanceof Error ? err.message : String(err)}`)
    }

    return { columns: inferColumns(rows), rows }
  }

  private buildSql(config: BuilderConfig, info: TableInfo): string {
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
    const condPart = condClauses.length ? ` AND (${condClauses.join(` ${config.combinator} `)})` : ''
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
  ): Promise<TableInfo> {
    const targetRepo = component ? (await this.resolveComponentPath(component, workspaceDir)) ?? repoPath : repoPath
    const schema = await this.schema.get(targetRepo)
    const found = findObjectTypeDef(schema, objectTypeRef)
    const resolved = found && found !== 'unresolvable' ? found : null

    const table: QueryTable = resolved?.category === 'test' ? 'tests' : 'requirements'
    const extra: readonly string[] = table === 'tests' ? ['latestRunResult', 'latestRunDate'] : REQUIREMENT_DERIVED_FIELDS
    const typeFields = resolved?.fields.map((f) => f.name) ?? []
    return { table, allowedFields: new Set([...SYSTEM_QUERY_FIELDS, ...extra, ...typeFields]) }
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
