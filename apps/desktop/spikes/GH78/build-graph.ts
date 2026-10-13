/**
 * GH78 — construction du graphe JSON (contrat v1) à partir des services de production, SANS
 * aplatissement. Lecture seule : réutilise `createMcpContainer` (même graphe de services que
 * le serveur MCP) et les étapes privées `resolveRepos` / `fetchRepoRaw` de `QueryEngineService`
 * (accès par cast, aucun service de production modifié), plus `computeCoverage`.
 */
import * as path from 'node:path'
import type { ProjectSchema, SystemNode, Requirement, TestCase, ObjectLink, TestRun, TestCampaign, CampaignTestRun } from '@polenta/types'
import { mergeRunsMaps } from '../../src/main/services/traceability.service'
import { resolveObjectTypeLocation } from '../../src/main/services/schema-lookup.util'
import { createMcpContainer } from '../../src/mcp-server/container'
import type {
  PolentaGraph, GraphObjectType, GraphRequirement, GraphTest, GraphLink, GraphCampaign, GraphCampaignEntry,
  GraphTestRun, GraphRepo, ObjectHistory, CampaignStatus,
} from './contract'

type RawRepo = {
  component: string
  requirements: Requirement[]
  testCases: TestCase[]
  latestRunMap: Map<string, TestRun>
  links: ObjectLink[]
  schema: ProjectSchema | null
  runsMap: Map<string, TestRun[]>
  campaigns: TestCampaign[]
}

interface EnginePrivate {
  resolveRepos(repoPath: string, workspaceDir?: string): Promise<{ repoPath: string; component: string }[]>
  fetchRepoRaw(rp: string, component: string): Promise<RawRepo>
}

export interface BuildTimings {
  /** Lecture des fichiers via les index (froid : premier appel ; chaud : index en mémoire). */
  fetchMs: number
  /** Couverture + assemblage du graphe. */
  assembleMs: number
}

export interface GraphSource {
  build(opts?: { simulate?: boolean }): Promise<{ graph: PolentaGraph; timings: BuildTimings }>
  /** Vide les index en mémoire (prochaine construction = lecture disque complète). */
  invalidate(): void
}

export function graphSource(workspaceDir: string, rootRepoDir: string): GraphSource {
  const repoPath = path.join(workspaceDir, rootRepoDir)
  let container = createMcpContainer(repoPath, workspaceDir)
  return {
    invalidate() { container = createMcpContainer(repoPath, workspaceDir) },
    async build(opts = {}) {
      const engine = container.queryEngine as unknown as EnginePrivate
      const t0 = performance.now()
      const repos = await engine.resolveRepos(repoPath, workspaceDir)
      const perRepo = await Promise.all(repos.map(r => engine.fetchRepoRaw(r.repoPath, r.component)))
      const t1 = performance.now()
      const treeCache = await container.workspaceTree.readCache(workspaceDir)
      const labels = new Map((treeCache?.nodes ?? []).map(n => [n.name, n.label ?? n.name]))
      const rootName = repos.find(r => r.repoPath === repoPath)?.component ?? path.basename(repoPath)
      const graph = assemble(perRepo, rootName, labels, container)
      if (opts.simulate) simulateHistory(graph)
      const t2 = performance.now()
      return { graph, timings: { fetchMs: t1 - t0, assembleMs: t2 - t1 } }
    },
  }
}

function walkNodes(nodes: SystemNode[] | undefined, out: SystemNode[] = []): SystemNode[] {
  for (const n of nodes ?? []) { out.push(n); walkNodes(n.children, out) }
  return out
}

const resolveLoc = (schema: ProjectSchema | null, ref: string) => (schema ? resolveObjectTypeLocation(schema, ref) : null)
function componentOf(schema: ProjectSchema | null, ref: string | undefined, repo: string): string {
  if (!ref) return repo
  const loc = resolveLoc(schema, ref)
  return loc && loc !== 'unresolvable' && loc.nodeName !== 'root' ? loc.nodeName : repo
}

function assemble(perRepo: RawRepo[], rootName: string, labels: Map<string, string>, container: ReturnType<typeof createMcpContainer>): PolentaGraph {
  const allRequirements = perRepo.flatMap(r => r.requirements)
  const allTests = perRepo.flatMap(r => r.testCases)
  const allLinks = perRepo.flatMap(r => r.links)
  const tcMap = new Map(allTests.map(tc => [tc.id, tc]))
  const latest = new Map<string, TestRun>()
  for (const r of perRepo) for (const [id, run] of r.latestRunMap) latest.set(id, run)
  // Indicateur Polenta : même calcul que la matrice de traçabilité (graphe inter-repos complet).
  const traceability = (container as unknown as { queryEngine: { traceability: { computeCoverage: Function } } }).queryEngine.traceability
  const coverage = traceability.computeCoverage(allRequirements, allLinks, tcMap, latest, mergeRunsMaps(perRepo.map(r => r.runsMap))) as Map<string, { coverageStatus: GraphRequirement['coverageStatus'] }>

  const repos: GraphRepo[] = perRepo.map(r => ({ name: r.component, label: labels.get(r.component) ?? r.component, isRoot: r.component === rootName }))

  const objectTypes: GraphObjectType[] = []
  const linkTypes = new Map<string, PolentaGraph['schema']['linkTypes'][number]>()
  for (const r of perRepo) {
    for (const node of walkNodes(r.schema?.nodes)) {
      for (const t of node.objectTypes ?? []) {
        objectTypes.push({
          repo: r.component,
          ref: `${node.name}::${t.name}`,
          component: node.name === 'root' ? r.component : node.name,
          label: t.label ?? t.name,
          prefix: t.prefix ?? null,
          category: t.category,
          fields: (t.fields ?? []).map(f => ({ name: f.name, label: f.label ?? f.name, type: f.type, ...(f.values ? { values: f.values } : {}), required: !!f.required, trackHistory: !!f.trackHistory })),
          statuses: t.category === 'campaign' ? [] : (t.statuses ?? []).map(s => ({ name: s.name, label: s.label ?? s.name, isApproval: !!s.isApproval, isTerminal: !!s.isTerminal })),
        })
      }
    }
    for (const lt of r.schema?.linkTypes ?? []) if (!linkTypes.has(lt.name)) linkTypes.set(lt.name, { name: lt.name, labelSourceToTarget: lt.labelSourceToTarget, labelTargetToSource: lt.labelTargetToSource })
  }

  const base = (o: Requirement | TestCase, repo: string, schema: ProjectSchema | null) => ({
    id: o.id, repo, component: componentOf(schema, o.objectTypeRef, repo), objectTypeRef: o.objectTypeRef, title: o.title,
    status: o.status, version: o.version ?? null, fields: o.fields ?? {}, history: (o.history ?? {}) as ObjectHistory,
    needsRevalidation: !!o.needsRevalidation, createdAt: o.createdAt, createdBy: o.createdBy, updatedAt: o.updatedAt, updatedBy: o.updatedBy,
  })

  const requirements: GraphRequirement[] = perRepo.flatMap(r => r.requirements.map(q => ({
    ...base(q, r.component, r.schema), coverageStatus: coverage.get(q.id)?.coverageStatus ?? 'not_covered',
  })))
  const tests: GraphTest[] = perRepo.flatMap(r => r.testCases.map(tc => ({
    ...base(tc, r.component, r.schema), preconditions: tc.preconditions ?? '', postconditions: tc.postconditions ?? '', steps: tc.steps ?? [],
  })))
  const links: GraphLink[] = perRepo.flatMap(r => r.links.map(l => ({ id: l.id, type: l.type, sourceId: l.sourceId, targetId: l.targetId, repo: r.component, createdAt: l.createdAt, createdBy: l.createdBy })))

  const entry = (e: CampaignTestRun & { addedAt?: string; removedAt?: string }): GraphCampaignEntry => ({
    entryId: e.entryId, testCaseId: e.testCaseId, requirementId: e.requirementId ?? null, status: e.status, runId: e.runId ?? null,
    executedAt: e.executedAt ?? null, executedBy: e.executedBy ?? null, addedAt: e.addedAt ?? null, removedAt: e.removedAt ?? null,
    snapshot: e.testSnapshot ? { status: e.testSnapshot.status, version: e.testSnapshot.version ?? null, title: e.testSnapshot.title } : null,
  })
  const campaigns: GraphCampaign[] = perRepo.flatMap(r => r.campaigns.map(c => ({
    id: c.id, repo: r.component, component: componentOf(r.schema, c.objectTypeRef, r.component), objectTypeRef: c.objectTypeRef ?? null,
    title: c.title, status: c.status, fields: c.fields ?? {}, history: (c.history ?? {}) as ObjectHistory, baselineRef: c.baselineRef ?? null,
    createdAt: c.createdAt, completedAt: c.completedAt ?? null, entries: (c.runs ?? []).map(entry),
    removedEntries: ((c as { removedRuns?: CampaignTestRun[] }).removedRuns ?? []).map(entry),
  })))
  const runs: GraphTestRun[] = perRepo.flatMap(r => [...r.runsMap.values()].flat().map(run => ({
    id: run.id, repo: r.component, testCaseId: run.testCaseId,
    campaignEntry: (run as { campaignEntry?: { campaignId: string; entryId: string } }).campaignEntry ?? null,
    requirementId: run.requirementId ?? null, result: run.result, executedAt: run.executedAt, executedBy: run.executedBy, duration: run.duration ?? 0,
  })))

  return {
    contractVersion: 1, generatedAt: new Date().toISOString(), repos,
    schema: { objectTypes, linkTypes: [...linkTypes.values()] },
    requirements, tests, links, campaigns, runs,
  }
}

// ─── Historique simulé (format GH77 / faits GH73) ────────────────────────────
// Le jeu de démo est antérieur à GH77/GH73 : on fabrique, de façon déterministe, un historique
// de statut pour chaque objet, des dates d'ajout d'entrées et des runs rattachés aux entrées.

function rng(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296 }
}
const iso = (ms: number) => new Date(Math.round(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
const DAY = 86400000

function simulateHistory(g: PolentaGraph): void {
  const NOW = Date.parse('2026-10-13T12:00:00Z')
  const typeOf = new Map(g.schema.objectTypes.map(t => [`${t.repo}\u0000${t.ref}`, t]))
  for (const o of [...g.requirements, ...g.tests]) {
    if (o.history.status?.length) continue
    const r = rng(o.id)
    const statuses = (typeOf.get(`${o.repo}\u0000${o.objectTypeRef}`)?.statuses ?? []).filter(s => !s.isTerminal || s.name === o.status).map(s => s.name)
    const idx = Math.max(0, statuses.indexOf(o.status))
    const chain = statuses.length ? statuses.slice(0, idx + 1) : [o.status]
    const start = Date.parse(o.createdAt ?? '2026-03-01T08:00:00Z')
    const end = Math.max(start + DAY, Date.parse(o.updatedAt ?? '2026-09-30T08:00:00Z'))
    o.history = { status: chain.map((value, i) => ({ value, at: iso(start + (end - start) * (i === 0 ? 0 : (i + r()) / chain.length)), by: 'demo' })) }
  }

  const runs: GraphTestRun[] = []
  for (const c of g.campaigns) {
    const r = rng(c.id)
    const created = Date.parse(c.createdAt)
    const closed = c.completedAt ? Date.parse(c.completedAt) : NOW
    let firstRun = Infinity
    for (const e of c.entries) {
      e.addedAt ??= iso(r() < 0.85 ? created : created + (closed - created) * r() * 0.5)
      if (e.status === 'pending') continue
      const added = Date.parse(e.addedAt)
      const last = e.executedAt ? Date.parse(e.executedAt) : added + (closed - added) * (0.5 + r() / 2)
      const retries = r() < 0.35 ? 1 + Math.floor(r() * 2) : 0
      const results: GraphTestRun['result'][] = [...Array.from({ length: retries }, () => (r() < 0.7 ? 'FAIL' : 'BLOCKED') as GraphTestRun['result']), e.status as GraphTestRun['result']]
      results.forEach((result, i) => {
        const at = results.length === 1 ? last : added + (last - added) * ((i + 1) / results.length)
        firstRun = Math.min(firstRun, at)
        runs.push({ id: `${e.entryId}-sim-${i + 1}`, repo: c.repo, testCaseId: e.testCaseId, campaignEntry: { campaignId: c.id, entryId: e.entryId }, requirementId: e.requirementId, result, executedAt: iso(at), executedBy: 'demo', duration: 600 })
      })
      e.runId = `${e.entryId}-sim-${results.length}`
      e.executedAt = iso(last)
    }
    if (!c.history.status?.length) {
      const h: { value: CampaignStatus; at: string; by: string }[] = [{ value: 'planned', at: iso(created), by: 'demo' }]
      if (c.status !== 'planned' && Number.isFinite(firstRun)) h.push({ value: 'in_progress', at: iso(firstRun), by: 'demo' })
      if (c.status === 'completed' || c.status === 'abandoned') h.push({ value: c.status, at: iso(closed), by: 'demo' })
      c.history = { status: h }
    }
  }
  g.runs.push(...runs)
}
