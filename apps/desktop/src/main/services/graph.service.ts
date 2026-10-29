import * as fsP from 'fs/promises'
import * as path from 'path'
import type {
  CampaignTestRun, DescribedObject, GraphCampaign, GraphComponent, GraphEntry, GraphFieldDef, GraphFixedStatus, GraphLink,
  GraphObjectBase, GraphObjectType, GraphRemovedEntry, GraphRepo, GraphRequirement, GraphTest, GraphTestRun,
  HistoryCarrier, HistoryFallback, ObjectHistory, ObjectLink, ObjectTypeDefinition, PolentaGraph, ProjectSchema, SchemaField,
  Requirement, RowTarget, TestCampaign, TestCase, TestRun, TestRunStatus,
} from '@polenta/types'
import {
  RUN_STATUS_ORDER, RUN_STATUS_SEVERITY, effectiveHistory, flattenSystemNodes, hasHistoryGap, historyTimestamp,
  isApprovalStatus,
} from '@polenta/types'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import type { TraceabilityService } from './traceability.service'
import { mergeRunsMaps } from './traceability.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { CampaignsService } from './campaigns.service'
import { isResyncable } from './campaigns.service'
import type { GitService } from './git.service'
import { findObjectTypeDef, resolveObjectTypeLocation } from './schema-lookup.util'

// GH74 — graphe de données JSON (contrat v1, `@polenta/types/graph.ts`) construit à partir des
// index en mémoire, sur le périmètre repo ouvert + composants du workspace. Données brutes, plus
// les seuls indicateurs que Polenta calcule pour ses propres fonctions (couverture,
// `needsRevalidation`, `resyncable`, `isApproval`). Cf. specs/GH74.md §1, GH74-design.md §2.1.

export interface BuiltGraph {
  graph: PolentaGraph
  /** Graphe sérialisé une fois (transmis tel quel au bac à sable). */
  json: string
  /** Version croissante : change à chaque reconstruction. */
  version: number
  /** Repos du périmètre : nom → chemin. */
  repoPaths: Map<string, string>
}

export interface GraphServiceOptions {
  /** Faux (serveur MCP, sans surveillance des fichiers) : graphe reconstruit à chaque appel. */
  cache?: boolean
  now?: () => Date
}

const ENTRY_LABELS: Record<'fr' | 'en', Record<TestRunStatus, string>> = {
  fr: { pending: 'En attente', INCOMPLETE: 'Incomplet', BLOCKED: 'Bloqué', FAIL: 'Échoué', PASS: 'Passé' },
  en: { pending: 'Pending', INCOMPLETE: 'Incomplete', BLOCKED: 'Blocked', FAIL: 'Failed', PASS: 'Passed' },
}
const CAMPAIGN_STATUSES = ['planned', 'in_progress', 'completed', 'abandoned'] as const
const CAMPAIGN_LABELS: Record<'fr' | 'en', Record<(typeof CAMPAIGN_STATUSES)[number], string>> = {
  fr: { planned: 'Planifiée', in_progress: 'En cours', completed: 'Terminée', abandoned: 'Abandonnée' },
  en: { planned: 'Planned', in_progress: 'In progress', completed: 'Completed', abandoned: 'Abandoned' },
}

interface RawRepo {
  name: string
  repoPath: string
  label: string
  requirements: Requirement[]
  testCases: TestCase[]
  latestRunMap: Map<string, TestRun>
  runsMap: Map<string, TestRun[]>
  links: ObjectLink[]
  schema: ProjectSchema | null
  campaigns: TestCampaign[]
}

/**
 * Empreinte de l'arbre du workspace (date de `.polenta/tree.cache.yaml`) : un composant ajouté ou
 * retiré change le périmètre du graphe et de la bibliothèque sans toucher aux repos surveillés.
 */
export async function workspaceStamp(workspaceDir: string | undefined): Promise<string> {
  if (!workspaceDir) return ''
  const st = await fsP.stat(path.join(workspaceDir, '.polenta', 'tree.cache.yaml')).catch(() => null)
  return st ? String(st.mtimeMs) : ''
}

interface CacheEntry {
  promise: Promise<BuiltGraph>
  /** Repos du périmètre (renseignés une fois la construction finie) : invalidation par repo. */
  repoPaths: Set<string>
  locale: 'fr' | 'en'
}

export class GraphService {
  private readonly cacheEnabled: boolean
  private readonly now: () => Date
  private readonly entries = new Map<string, CacheEntry>()
  private version = 0

  constructor(
    private readonly reqIndex: RequirementsIndexService,
    private readonly testsIndex: TestsIndexService,
    private readonly schema: SchemaService,
    private readonly traceability: TraceabilityService,
    private readonly git: GitService,
    private readonly workspaceTree?: WorkspaceTreeService,
    private readonly campaigns?: CampaignsService,
    options: GraphServiceOptions = {},
  ) {
    this.cacheEnabled = options.cache !== false
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Graphe du périmètre (repo ouvert + composants). En cache par (repo, workspace, langue, arbre du
   * workspace) : les constructions simultanées sont partagées, et le résultat est gardé jusqu'à
   * `invalidate` d'un repo du périmètre.
   */
  async build(repoPath: string, workspaceDir?: string, locale: 'fr' | 'en' = 'fr'): Promise<BuiltGraph> {
    const stamp = await workspaceStamp(workspaceDir)
    const key = `${path.resolve(repoPath)}\u0000${workspaceDir ? path.resolve(workspaceDir) : ''}\u0000${locale}\u0000${stamp}`
    const cached = this.entries.get(key)
    if (cached) return cached.promise
    const entry: CacheEntry = { promise: Promise.resolve(null as unknown as BuiltGraph), repoPaths: new Set(), locale }
    entry.promise = this.doBuild(repoPath, workspaceDir, locale).then(
      (built) => {
        for (const p of built.repoPaths.values()) entry.repoPaths.add(path.resolve(p))
        if (!this.cacheEnabled && this.entries.get(key) === entry) this.entries.delete(key)
        return built
      },
      (err) => {
        if (this.entries.get(key) === entry) this.entries.delete(key)
        throw err
      },
    )
    this.entries.set(key, entry)
    return entry.promise
  }

  /** Oublie tout graphe dont le périmètre contient `repoPath` (et les constructions en cours, dont
   *  le résultat pourrait précéder le changement). */
  invalidate(repoPath: string): void {
    const target = path.resolve(repoPath)
    for (const [key, entry] of this.entries) {
      if (entry.repoPaths.size === 0 || entry.repoPaths.has(target)) this.entries.delete(key)
    }
  }

  /** Description des objets désignés par `ids`, dans l'ordre reçu (inconnus : `kind: 'unknown'`). */
  async describeIds(repoPath: string, ids: readonly string[], workspaceDir?: string, locale: 'fr' | 'en' = 'fr'): Promise<DescribedObject[]> {
    const { graph } = await this.build(repoPath, workspaceDir, locale)
    const index = objectIndex(graph)
    return ids.map((id) => index.describe(id))
  }

  /** Objet à ouvrir pour un identifiant, ou `null` s'il n'existe pas. */
  async resolveTarget(repoPath: string, id: string, workspaceDir?: string): Promise<RowTarget | null> {
    const { graph, repoPaths } = await this.build(repoPath, workspaceDir)
    const repoOf = (name: string) => repoPaths.get(name) ?? null
    const slash = id.indexOf('/')
    if (slash > 0) {
      const campaign = graph.campaigns.find((c) => c.id === id.slice(0, slash))
      const entry = campaign?.entries.find((e) => e.entryId === id.slice(slash + 1))
      const rp = campaign && repoOf(campaign.repo)
      if (!campaign || !entry || !rp) return null
      return { kind: 'campaign-entry', campaignId: campaign.id, entryId: entry.entryId, executed: entry.status !== 'pending', status: entry.status, repoPath: rp }
    }
    const found: [RowTarget['kind'], { repo: string } | undefined][] = [
      ['requirement', graph.requirements.find((r) => r.id === id)],
      ['test', graph.tests.find((t) => t.id === id)],
      ['campaign', graph.campaigns.find((c) => c.id === id)],
    ]
    for (const [kind, obj] of found) {
      const rp = obj && repoOf(obj.repo)
      if (rp) return { kind, id, repoPath: rp } as RowTarget
    }
    return null
  }

  // ─── Construction ──────────────────────────────────────────────────────────

  /** Repos du périmètre. Les chemins sont transmis tels quels aux services (index en cache par
   *  chemin) ; seule la comparaison est normalisée. */
  private async resolveRepos(repoPath: string, workspaceDir?: string): Promise<{ repoPath: string; name: string; label: string }[]> {
    const own = path.resolve(repoPath)
    if (workspaceDir && this.workspaceTree) {
      const tree = await this.workspaceTree.readCache(workspaceDir)
      if (tree) {
        const byPath = new Map<string, { repoPath: string; name: string; label: string }>()
        for (const node of tree.nodes) {
          if (node.repoPath) byPath.set(path.resolve(node.repoPath), { repoPath: node.repoPath, name: node.name, label: node.label ?? node.name })
        }
        if (!byPath.has(own)) byPath.set(own, { repoPath, name: path.basename(repoPath), label: path.basename(repoPath) })
        return [...byPath.values()]
      }
    }
    return [{ repoPath, name: path.basename(repoPath), label: path.basename(repoPath) }]
  }

  private async fetchRepo(repo: { repoPath: string; name: string; label: string }): Promise<RawRepo> {
    const rp = repo.repoPath
    const [requirements, testCases, latestRunMap, runsMap, links, schema, campaigns] = await Promise.all([
      this.reqIndex.findAll(rp, {}),
      this.testsIndex.findAll(rp),
      this.testsIndex.getLatestRunMap(rp),
      this.testsIndex.getRunsMap(rp),
      this.reqIndex.findAllLinks(rp),
      this.schema.get(rp).catch(() => null),
      this.listCampaigns(rp),
    ])
    return { ...repo, requirements, testCases, latestRunMap, runsMap, links, schema: schema as ProjectSchema | null, campaigns }
  }

  /** Un fichier campagne illisible ne casse pas tout le graphe : campagnes du repo ignorées. */
  private async listCampaigns(rp: string): Promise<TestCampaign[]> {
    if (!this.campaigns) return []
    try {
      return await this.campaigns.list(rp)
    } catch (err) {
      console.warn(`[graph] campagnes ignorées pour ${rp} :`, err instanceof Error ? err.message : String(err))
      return []
    }
  }

  private async doBuild(repoPath: string, workspaceDir: string | undefined, locale: 'fr' | 'en'): Promise<BuiltGraph> {
    const repos = await this.resolveRepos(repoPath, workspaceDir)
    const perRepo = await Promise.all(repos.map((r) => this.fetchRepo(r)))
    const rootPath = path.resolve(repoPath)
    const now = this.now()

    // Couverture sur le graphe de liens agrégé de tous les repos (comme la matrice de traçabilité).
    const allRequirements = perRepo.flatMap((r) => r.requirements)
    const allTests = perRepo.flatMap((r) => r.testCases)
    const tcMap = new Map(allTests.map((tc) => [tc.id, tc]))
    const latest = new Map<string, TestRun>()
    for (const r of perRepo) for (const [id, run] of r.latestRunMap) latest.set(id, run)
    const coverage = this.traceability.computeCoverage(
      allRequirements, perRepo.flatMap((r) => r.links), tcMap, latest, mergeRunsMaps(perRepo.map((r) => r.runsMap)),
    )

    const repoList: GraphRepo[] = perRepo.map((r) => ({ name: r.name, label: r.label, isRoot: path.resolve(r.repoPath) === rootPath }))
    const components: GraphComponent[] = []
    const seenComponents = new Set<string>()
    const objectTypes: GraphObjectType[] = []
    const linkTypes = new Map<string, PolentaGraph['schema']['linkTypes'][number]>()
    for (const r of perRepo) {
      if (!seenComponents.has(r.name)) {
        seenComponents.add(r.name)
        components.push({ name: r.name, label: r.label, repo: r.name })
      }
      for (const { node } of flattenSystemNodes(r.schema?.nodes ?? [])) {
        const componentName = node.name === 'root' ? r.name : node.name
        if (node.name !== 'root' && !seenComponents.has(componentName) && !perRepo.some((p) => p.name === componentName)) {
          seenComponents.add(componentName)
          components.push({ name: componentName, label: node.label ?? node.name, repo: r.name })
        }
        for (const t of node.objectTypes ?? []) objectTypes.push(toGraphType(t, r.name, node.name, componentName))
      }
      for (const lt of r.schema?.linkTypes ?? []) {
        if (!linkTypes.has(lt.name)) linkTypes.set(lt.name, { name: lt.name, labelSourceToTarget: lt.labelSourceToTarget, labelTargetToSource: lt.labelTargetToSource })
      }
    }

    const requirements: GraphRequirement[] = []
    const tests: GraphTest[] = []
    const links: GraphLink[] = []
    const campaigns: GraphCampaign[] = []
    const runs: GraphTestRun[] = []
    for (const r of perRepo) {
      const types = typeResolver(r.schema)
      for (const q of r.requirements) {
        requirements.push({
          ...objectBase(q, r.name, types, now),
          coverageStatus: coverage.get(q.id)?.coverageStatus ?? 'not_covered',
        })
      }
      for (const tc of r.testCases) tests.push(objectBase(tc, r.name, types, now))
      for (const l of r.links) {
        links.push({ id: l.id, type: l.type, sourceId: l.sourceId, targetId: l.targetId, repo: r.name, createdAt: l.createdAt ?? null, createdBy: l.createdBy ?? null })
      }
      for (const runList of r.runsMap.values()) for (const run of runList) runs.push(toGraphRun(run, r.name))
      const isApproved = (test: TestCase) => {
        const typeDef = r.schema ? findObjectTypeDef(r.schema, test.objectTypeRef, 'test') : null
        return isApprovalStatus(typeDef && typeDef !== 'unresolvable' ? typeDef : null, test.status)
      }
      campaigns.push(...await Promise.all(r.campaigns.map((c) => this.toGraphCampaign(c, r, types, isApproved, now))))
    }

    const graph: PolentaGraph = {
      contractVersion: 1,
      generatedAt: historyTimestamp(now),
      repos: repoList,
      components,
      schema: {
        objectTypes,
        linkTypes: [...linkTypes.values()],
        entryStatuses: RUN_STATUS_ORDER.map((name, order): GraphFixedStatus => ({
          name, label: ENTRY_LABELS[locale][name], order, severity: RUN_STATUS_SEVERITY[name],
        })),
        campaignStatuses: CAMPAIGN_STATUSES.map((name, order): GraphFixedStatus => ({ name, label: CAMPAIGN_LABELS[locale][name], order })),
      },
      requirements,
      tests,
      links,
      campaigns,
      runs,
    }
    return {
      graph,
      json: JSON.stringify(graph),
      version: ++this.version,
      repoPaths: new Map(perRepo.map((r) => [r.name, r.repoPath])),
    }
  }

  private async toGraphCampaign(
    c: TestCampaign,
    r: RawRepo,
    types: TypeResolver,
    isApproved: (test: TestCase) => boolean,
    now: Date,
  ): Promise<GraphCampaign> {
    const typeDef = c.objectTypeRef ? types(c.objectTypeRef).typeDef : null
    let fallback: HistoryFallback = { at: null, by: null }
    const carrier: HistoryCarrier = { status: c.status, fields: c.fields ?? {}, history: c.history }
    if (hasHistoryGap(carrier, typeDef)) {
      const dates = await this.git.fileHistory(r.repoPath, `campaigns/${c.id}.yaml`).catch(() => null)
      fallback = { at: dates?.updatedAt ? historyTimestamp(new Date(dates.updatedAt)) : null, by: dates?.updatedBy ?? null }
    }
    const entry = (e: CampaignTestRun): GraphEntry => ({
      entryId: e.entryId,
      testCaseId: e.testCaseId,
      requirementId: e.requirementId ?? null,
      status: e.status,
      addedAt: e.addedAt ?? null,
      runId: e.runId ?? null,
      executedAt: e.executedAt ?? null,
      executedBy: e.executedBy ?? null,
      carriedFrom: e.carriedFrom ? { campaignId: e.carriedFrom.campaignId, entryId: e.carriedFrom.entryId } : null,
      snapshot: e.testSnapshot ? { title: e.testSnapshot.title, status: e.testSnapshot.status, version: e.testSnapshot.version ?? null } : null,
      resyncable: isResyncable(c, e, isApproved),
    })
    return {
      id: c.id,
      repo: r.name,
      component: c.objectTypeRef ? types(c.objectTypeRef).component ?? r.name : r.name,
      objectTypeRef: c.objectTypeRef ?? null,
      title: c.title,
      status: c.status,
      fields: c.fields ?? {},
      history: effectiveHistory(carrier, typeDef, fallback, now),
      baselineRef: c.baselineRef ?? null,
      targetComponent: c.component ?? null,
      level: c.level ?? null,
      createdAt: c.createdAt,
      completedAt: c.completedAt ?? null,
      entries: (c.runs ?? []).map(entry),
      removedEntries: (c.removedRuns ?? []).map((e): GraphRemovedEntry => ({ ...entry(e), removedAt: e.removedAt })),
    }
  }
}

// ─── Conversions ─────────────────────────────────────────────────────────────

type TypeResolver = (ref: string) => { typeDef: ObjectTypeDefinition | null; component: string | null }

/** Type et composant d'un `objectTypeRef` dans le schéma de son repo (mémoïsé). */
function typeResolver(schema: ProjectSchema | null): TypeResolver {
  const cache = new Map<string, ReturnType<TypeResolver>>()
  return (ref) => {
    const known = cache.get(ref)
    if (known) return known
    const loc = schema && typeof ref === 'string' && ref ? resolveObjectTypeLocation(schema, ref) : null
    const found = loc && loc !== 'unresolvable'
      ? { typeDef: loc.typeDef, component: loc.nodeName !== 'root' ? loc.nodeName : null }
      : { typeDef: null, component: null }
    cache.set(ref, found)
    return found
  }
}

function toGraphFieldDef(f: SchemaField): GraphFieldDef {
  return {
    name: f.name,
    label: f.label ?? f.name,
    type: f.type,
    ...(f.values ? { values: [...f.values] } : {}),
    required: !!f.required,
    ...(f.validator ? { validator: f.validator } : {}),
    trackHistory: !!f.trackHistory,
    ...(f.multiple ? { multiple: true } : {}),
    ...(f.requiredWhen ? { requiredWhen: f.requiredWhen } : {}),
  }
}

function toGraphType(t: ObjectTypeDefinition, repo: string, nodeName: string, component: string): GraphObjectType {
  return {
    repo,
    ref: `${nodeName}::${t.name}`,
    component,
    label: t.label ?? t.name,
    prefix: t.prefix ?? null,
    category: t.category,
    fields: (t.fields ?? []).map(toGraphFieldDef),
    statuses: t.category === 'campaign' ? [] : (t.statuses ?? []).map((s) => ({
      name: s.name, label: s.label ?? s.name, isApproval: !!s.isApproval, isTerminal: !!s.isTerminal,
    })),
    runFields: t.category === 'test' ? (t.runFields ?? []).map(toGraphFieldDef) : [],
    stepFields: t.category === 'test' ? (t.stepFields ?? []).map(toGraphFieldDef) : [],
  }
}

function objectBase(o: Requirement | TestCase, repo: string, types: TypeResolver, now: Date): GraphObjectBase {
  const { typeDef, component } = types(o.objectTypeRef)
  const fields = o.fields ?? {}
  const audit = o as { updatedAt?: string | null; updatedBy?: string | null; createdAt?: string | null; createdBy?: string | null }
  const fallback: HistoryFallback = {
    at: audit.updatedAt ? historyTimestamp(new Date(audit.updatedAt)) : null,
    by: audit.updatedBy ?? null,
  }
  const history: ObjectHistory = effectiveHistory({ status: o.status, fields, history: o.history }, typeDef, fallback, now)
  return {
    id: o.id,
    repo,
    component: component ?? repo,
    objectTypeRef: o.objectTypeRef,
    title: o.title,
    status: o.status,
    version: typeof o.version === 'number' ? o.version : null,
    fields,
    history,
    needsRevalidation: !!o.needsRevalidation,
    createdAt: audit.createdAt ?? null,
    createdBy: audit.createdBy ?? null,
    updatedAt: audit.updatedAt ?? null,
    updatedBy: audit.updatedBy ?? null,
  }
}

function toGraphRun(run: TestRun, repo: string): GraphTestRun {
  return {
    id: run.id,
    repo,
    testCaseId: run.testCaseId,
    campaignEntry: run.campaignEntry ? { campaignId: run.campaignEntry.campaignId, entryId: run.campaignEntry.entryId } : null,
    requirementId: run.requirementId ?? null,
    result: run.result,
    executedAt: run.executedAt,
    executedBy: run.executedBy,
    duration: typeof run.duration === 'number' ? run.duration : 0,
    origin: run.origin ?? null,
    fields: { ...(run.fields ?? {}) },
    notes: typeof run.notes === 'string' ? run.notes : '',
    stepResults: (run.stepResults ?? []).map((sr) => ({
      order: sr.order,
      result: sr.result,
      comment: typeof sr.comment === 'string' ? sr.comment : '',
      fields: { ...(sr.fields ?? {}) },
    })),
  }
}

/** Index des objets d'un graphe pour le drill-down. */
function objectIndex(graph: PolentaGraph) {
  const typeLabel = new Map(graph.schema.objectTypes.map((t) => [`${t.repo}\u0000${t.ref}`, t]))
  const statusLabel = (o: GraphObjectBase) => {
    const t = typeLabel.get(`${o.repo}\u0000${o.objectTypeRef}`)
    return { label: t?.label ?? null, status: t?.statuses.find((s) => s.name === o.status)?.label ?? o.status }
  }
  const byId = new Map<string, DescribedObject>()
  for (const [kind, list] of [['requirement', graph.requirements], ['test', graph.tests]] as const) {
    for (const o of list) {
      const { label, status } = statusLabel(o)
      byId.set(o.id, { id: o.id, kind, title: o.title, status, typeLabel: label })
    }
  }
  const tests = new Map(graph.tests.map((t) => [t.id, t]))
  const entryLabel = new Map(graph.schema.entryStatuses.map((s) => [s.name, s.label]))
  const campaignLabel = new Map(graph.schema.campaignStatuses.map((s) => [s.name, s.label]))
  for (const c of graph.campaigns) {
    byId.set(c.id, { id: c.id, kind: 'campaign', title: c.title, status: campaignLabel.get(c.status) ?? c.status, typeLabel: null })
    for (const e of [...c.entries, ...c.removedEntries]) {
      const id = `${c.id}/${e.entryId}`
      const title = e.snapshot?.title ?? tests.get(e.testCaseId)?.title ?? e.testCaseId
      byId.set(id, { id, kind: 'campaign-entry', title: e.requirementId ? `${title} — ${e.requirementId}` : title, status: entryLabel.get(e.status) ?? e.status, typeLabel: c.title })
    }
  }
  for (const run of graph.runs) {
    if (!byId.has(run.id)) byId.set(run.id, { id: run.id, kind: 'run', title: tests.get(run.testCaseId)?.title ?? run.testCaseId, status: entryLabel.get(run.result) ?? run.result, typeLabel: null })
  }
  return {
    describe: (id: string): DescribedObject => byId.get(id) ?? { id, kind: 'unknown', title: null, status: null, typeLabel: null },
  }
}
