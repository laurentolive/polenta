import type {
  CellStatus,
  CoverageStatus,
  ImpactAcknowledgement,
  ImpactReport,
  MatrixCell,
  MatrixExportRow,
  MatrixRow,
  RevalidationItem,
  TestPlanDraft,
  TraceabilityMatrix,
  TestCase,
  TestRun,
  Requirement,
  ObjectLink,
  ImpactAnalysis,
  ImpactAnalysisSummary,
  ChangedRequirement,
  ImpactNode,
  ElementRepoRef,
  LocalImpactAnalysis,
  RequirementDiffEntry,
  ChangedField,
  CreateImpactAnalysisDto,
  UpdateImpactItemStatusDto,
} from '@polenta/types'
import type {
  AcknowledgeImpactDto,
  GenerateTestPlanDto,
  MatrixFiltersDto,
} from '@polenta/zod-schemas'
import * as path from 'path'
import type { GitService } from './git.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { SyncService } from './sync.service'
import { resolveWorkspaceRepoPaths } from './workspace-repos.util'

/** Minimal read-only snapshot of requirements/tests/links — either as they existed at a given
 * git ref (T46, one repo, built once per `createImpactAnalysis` at the target baseline's sha) or as
 * they are on disk across all workspace repos (T175). Shared by every
 * `buildImpactTreesFromSnapshot()` call of one analysis, to avoid re-reading the same blobs once
 * per changed element. `repoPath` = repo the element lives in; `rootRepoPath` = analysis root. */
interface ImpactSnapshot {
  rootRepoPath: string
  requirements: Map<string, { title: string; repoPath: string }>
  tests: Map<string, { title: string; repoPath: string }>
  links: ObjectLink[]
  repoNames: Map<string, string>
}

/**
 * Match a link against a requirement/test-case pair regardless of which side is
 * `sourceId` vs `targetId`. A "teste"/coverage link can legitimately be created from
 * either object's editor (the requirement's or the test's) — the user picks whichever
 * direction reads naturally, per the link type's `sourceRefs`/`targetRefs` — so coverage
 * can't assume the test is always the source.
 */
function matchCoverageLink(
  link: ObjectLink,
  tcIds: Set<string>,
  reqIds: Set<string>,
): { testId: string; reqId: string } | null {
  if (tcIds.has(link.sourceId) && reqIds.has(link.targetId)) {
    return { testId: link.sourceId, reqId: link.targetId }
  }
  if (tcIds.has(link.targetId) && reqIds.has(link.sourceId)) {
    return { testId: link.targetId, reqId: link.sourceId }
  }
  return null
}

/** Repo d'un élément pour l'affichage — `undefined` s'il est dans le repo racine de l'analyse. */
function elementRepoRef(snapshot: ImpactSnapshot, repoPath: string | undefined): ElementRepoRef | undefined {
  if (!repoPath || repoPath === snapshot.rootRepoPath) return undefined
  return { path: repoPath, name: snapshot.repoNames.get(repoPath) ?? path.basename(repoPath) }
}

function findImpactNodeById(nodes: ImpactNode[], elementId: string): ImpactNode | null {
  for (const node of nodes) {
    if (node.elementId === elementId) return node
    const found = findImpactNodeById(node.children, elementId)
    if (found) return found
  }
  return null
}

/** Sections d'un cas de test stockées à la racine du YAML (pas dans `fields`). */
const TEST_CASE_TOP_LEVEL_FIELDS = ['preconditions', 'equipment', 'steps', 'postconditions'] as const

/** Champ à champ sur `status`, `title`, `fields.*` — et, pour un test (T175), ses sections
 *  racine (`steps`, `preconditions`…), chacune comptée comme un seul champ. */
function diffElementFields(
  a: { status: string; title: string; fields?: unknown },
  b: { status: string; title: string; fields?: unknown },
  elementType: 'requirement' | 'test_case' = 'requirement',
): ChangedField[] {
  const changed = diffRequirementLikeFields(a, b)
  if (elementType === 'test_case') {
    const ra = a as Record<string, unknown>
    const rb = b as Record<string, unknown>
    for (const key of TEST_CASE_TOP_LEVEL_FIELDS) {
      if (JSON.stringify(ra[key]) !== JSON.stringify(rb[key])) changed.push({ field: key, from: ra[key], to: rb[key] })
    }
  }
  return changed
}

function diffRequirementLikeFields(
  a: { status: string; title: string; fields?: unknown },
  b: { status: string; title: string; fields?: unknown },
): ChangedField[] {
  const changed: ChangedField[] = []
  if (a.status !== b.status) changed.push({ field: 'status', from: a.status, to: b.status })
  if (a.title !== b.title) changed.push({ field: 'title', from: a.title, to: b.title })
  const aFields = (a.fields ?? {}) as Record<string, unknown>
  const bFields = (b.fields ?? {}) as Record<string, unknown>
  const keys = new Set([...Object.keys(aFields), ...Object.keys(bFields)])
  for (const key of keys) {
    if (JSON.stringify(aFields[key]) !== JSON.stringify(bFields[key])) {
      changed.push({ field: `fields.${key}`, from: aFields[key], to: bFields[key] })
    }
  }
  return changed
}

export class TraceabilityService {
  constructor(
    private readonly reqIndex: RequirementsIndexService,
    private readonly testsIndex: TestsIndexService,
    private readonly git: GitService,
    private readonly sync: SyncService,
    private readonly workspaceTree?: WorkspaceTreeService,
  ) {}

  /**
   * Resolve all repo paths to include in traceability queries.
   * In mono-repo mode, returns [repoPath].
   * In workspace mode (workspaceDir provided), includes repoPath + all component repos
   * from the workspace tree cache.
   */
  private resolveRepoPaths(repoPath: string, workspaceDir?: string): Promise<string[]> {
    return resolveWorkspaceRepoPaths(this.workspaceTree, repoPath, workspaceDir)
  }

  /**
   * Find a requirement by ID across multiple repos.
   * Returns the first match, or null if not found.
   */
  private async findRequirementById(
    id: string,
    repoPaths: string[],
  ): Promise<import('@polenta/types').Requirement | null> {
    for (const p of repoPaths) {
      const req = await this.reqIndex.findById(p, id)
      if (req) return req
    }
    return null
  }

  async getMatrix(repoPath: string, filters: MatrixFiltersDto, workspaceDir?: string): Promise<TraceabilityMatrix> {
    const repoPaths = await this.resolveRepoPaths(repoPath, workspaceDir)

    // Aggregate requirements, tests, runs, and links from all repos in scope
    const allRequirementsArrays = await Promise.all(
      repoPaths.map(p => this.reqIndex.findAll(p, {
        type: filters.type,
        status: filters.status,
        tags: filters.tags,
      }))
    )
    const requirements = allRequirementsArrays.flat()

    const allTestCasesArrays = await Promise.all(repoPaths.map(p => this.testsIndex.findAll(p)))
    let testCases = allTestCasesArrays.flat()
    if (filters.testType) testCases = testCases.filter((tc) => tc.objectTypeRef === filters.testType)

    // Merge latestRunMaps from all repos
    const latestRunMapsArr = await Promise.all(repoPaths.map(p => this.testsIndex.getLatestRunMap(p)))
    const latestRunMap = new Map<string, import('@polenta/types').TestRun>()
    for (const map of latestRunMapsArr) {
      for (const [k, v] of map) latestRunMap.set(k, v)
    }

    const allLinksArrays = await Promise.all(repoPaths.map(p => this.reqIndex.findAllLinks(p)))
    const allLinks = allLinksArrays.flat()

    const tcMap = new Map(testCases.map((tc) => [tc.id, tc]))
    const coverage = this.computeCoverage(requirements, allLinks, tcMap, latestRunMap)

    const colIds = new Set<string>()
    for (const { cells } of coverage.values()) {
      for (const cell of cells) colIds.add(cell.testCaseId)
    }
    const testCaseColumns = testCases
      .filter((tc) => colIds.has(tc.id))
      .map((tc) => ({ id: tc.id, title: tc.title, objectTypeRef: tc.objectTypeRef, status: tc.status }))

    const rows: MatrixRow[] = requirements.map((req) => {
      const entry = coverage.get(req.id) ?? { cells: [], coverageStatus: computeCoverageStatus([]) }
      return { requirement: req, coverageStatus: entry.coverageStatus, cells: entry.cells }
    })

    return {
      requirements: rows,
      testCases: testCaseColumns,
      filters: filters as Record<string, unknown>,
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * Build the per-requirement coverage cells (one MatrixCell per linked test case) and
   * the resulting CoverageStatus, from already-fetched requirements/links/testcase-map/
   * latest-run-map. Extracted out of getMatrix() (T77 sprint 3) so other callers —
   * `query-engine.service.ts`'s dataset builder, which needs `coverageStatus` on every
   * requirement row without a base-`SELECT` round trip through the full matrix shape —
   * reuse the *exact* same computation, including the T63 fix in computeCoverageStatus()
   * below (covered/validated priority), instead of re-deriving it and risking the two
   * implementations drifting apart.
   */
  computeCoverage(
    requirements: Requirement[],
    links: ObjectLink[],
    tcMap: Map<string, TestCase>,
    latestRunMap: Map<string, TestRun>,
  ): Map<string, { cells: MatrixCell[]; coverageStatus: CoverageStatus }> {
    const reqIds = new Set(requirements.map((r) => r.id))
    const tcIds = new Set(tcMap.keys())

    const reqToTests = new Map<string, Array<{ tc: TestCase; coverageType: 'full' | 'partial' }>>()
    for (const link of links) {
      const match = matchCoverageLink(link, tcIds, reqIds)
      if (!match) continue
      const tc = tcMap.get(match.testId)
      if (!tc) continue
      const arr = reqToTests.get(match.reqId) ?? []
      arr.push({ tc, coverageType: link.coverageType ?? 'full' })
      reqToTests.set(match.reqId, arr)
    }

    const result = new Map<string, { cells: MatrixCell[]; coverageStatus: CoverageStatus }>()
    for (const req of requirements) {
      const reqLinks = reqToTests.get(req.id) ?? []
      const cells: MatrixCell[] = reqLinks.map(({ tc, coverageType }) => {
        const latestRun = latestRunMap.get(tc.id)
        let status: CellStatus
        // T172 — le flag est porté par les éléments : la paire est à revalider si l'une de ses
        // deux extrémités est marquée.
        if (req.needsRevalidation || tc.needsRevalidation) status = 'needs_revalidation'
        else if (!latestRun) status = 'not_run'
        else if (latestRun.result === 'PASS') status = 'pass'
        else if (latestRun.result === 'FAIL') status = 'fail'
        else status = 'blocked'
        return {
          testCaseId: tc.id,
          coverageType,
          status,
          lastRunId: latestRun?.id ?? null,
          lastRunDate: latestRun?.executedAt ?? null,
        }
      })
      // T172 — une exigence marquée est `needs_revalidation` même sans test lié.
      const coverageStatus = req.needsRevalidation ? 'needs_revalidation' : computeCoverageStatus(cells)
      result.set(req.id, { cells, coverageStatus })
    }
    return result
  }

  async getMissingLinks(repoPath: string, workspaceDir?: string) {
    const repoPaths = await this.resolveRepoPaths(repoPath, workspaceDir)

    const [reqArrays, tcArrays, linksArrays] = await Promise.all([
      Promise.all(repoPaths.map(p => this.reqIndex.findAll(p, {}))),
      Promise.all(repoPaths.map(p => this.testsIndex.findAll(p))),
      Promise.all(repoPaths.map(p => this.reqIndex.findAllLinks(p))),
    ])
    const [requirements, testCases, allLinks] = [
      reqArrays.flat(),
      tcArrays.flat(),
      linksArrays.flat(),
    ]

    const reqIds = new Set(requirements.map((r) => r.id))
    const tcIds = new Set(testCases.map((tc) => tc.id))

    const coveredReqIds = new Set<string>()
    const tcCoveredLinks = new Map<string, Array<{ link: ObjectLink; reqId: string }>>()
    for (const link of allLinks) {
      const match = matchCoverageLink(link, tcIds, reqIds)
      if (!match) continue
      coveredReqIds.add(match.reqId)
      const arr = tcCoveredLinks.get(match.testId) ?? []
      arr.push({ link, reqId: match.reqId })
      tcCoveredLinks.set(match.testId, arr)
    }

    const uncoveredRequirements = requirements.filter((r) => !coveredReqIds.has(r.id))
    const orphanTests = testCases.filter((tc) => !tcCoveredLinks.has(tc.id))
    // T172 — éléments (exigences et tests) marqués `needsRevalidation` : impact à vérifier.
    const revalidationItems: RevalidationItem[] = [
      ...requirements.filter((r) => r.needsRevalidation).map((r): RevalidationItem => (
        { elementId: r.id, elementType: 'requirement', title: r.title, status: r.status })),
      ...testCases.filter((tc) => tc.needsRevalidation).map((tc): RevalidationItem => (
        { elementId: tc.id, elementType: 'test_case', title: tc.title, status: tc.status })),
    ]

    return { uncoveredRequirements, orphanTests, revalidationItems }
  }

  // ─── T46 : analyse d'impact entre deux baselines ────────────────────────────

  /**
   * Diff exigence-par-exigence entre deux refs git (toujours des shas de baseline pour T46,
   * mais fonctionne sur n'importe quel couple de shas). Ne lit que les blobs bruts via
   * `sync.diffBetween`/`git.readYamlRef` — indépendant de l'index vivant.
   */
  async diffRequirementsBetweenRefs(repoPath: string, fromSha: string, toSha: string): Promise<RequirementDiffEntry[]> {
    const files = await this.sync.diffBetween(repoPath, fromSha, toSha)
    const reqFiles = files.filter((f) => f.path.startsWith('requirements/') && f.path.endsWith('.yaml'))

    const pairs = await Promise.all(
      reqFiles.map(async (f) => {
        const [reqA, reqB] = await Promise.all([
          this.git.readYamlRef<Requirement>(repoPath, fromSha, f.path),
          this.git.readYamlRef<Requirement>(repoPath, toSha, f.path),
        ])
        return { reqA, reqB }
      }),
    )

    const entries: RequirementDiffEntry[] = []
    for (const { reqA, reqB } of pairs) {
      const reqId = reqB?.id ?? reqA?.id
      if (!reqId) continue // illisible des deux côtés — on ignore plutôt que de deviner

      if (!reqA && reqB) {
        entries.push({ reqId, changeType: 'added', changedFields: [], titleFrom: null, titleTo: reqB.title })
      } else if (reqA && !reqB) {
        entries.push({ reqId, changeType: 'removed', changedFields: [], titleFrom: reqA.title, titleTo: null })
      } else if (reqA && reqB) {
        const changedFields = diffElementFields(reqA, reqB)
        if (changedFields.length > 0) {
          entries.push({ reqId, changeType: 'modified', changedFields, titleFrom: reqA.title, titleTo: reqB.title })
        }
      }
    }
    return entries.sort((a, b) => a.reqId.localeCompare(b.reqId))
  }

  /** Charge l'état des exigences/tests/liens tel qu'il existait à `sha` — cf. `ImpactSnapshot`. */
  private async loadSnapshotAtRef(repoPath: string, sha: string): Promise<ImpactSnapshot> {
    const [reqRecords, testRecords, linksData] = await Promise.all([
      this.git.readYamlDirAtRef<Requirement>(repoPath, sha, 'requirements'),
      this.git.readYamlDirAtRef<TestCase>(repoPath, sha, 'tests'),
      this.git.readYamlRef<{ links: ObjectLink[] }>(repoPath, sha, 'links/links.yaml'),
    ])

    const requirements = new Map<string, { title: string; repoPath: string }>()
    for (const r of reqRecords) if (r.id) requirements.set(r.id, { title: r.title, repoPath })

    const tests = new Map<string, { title: string; repoPath: string }>()
    for (const t of testRecords) if (t.id) tests.set(t.id, { title: t.title, repoPath })

    return { rootRepoPath: repoPath, requirements, tests, links: linksData?.links ?? [], repoNames: new Map() }
  }

  /** T175 — lecture disque tolérante : un YAML invalide (édition en cours) donne `null`. */
  private readYamlLenient<T>(repoPath: string, filePath: string): Promise<T | null> {
    return this.git.readYaml<T>(repoPath, filePath).catch(() => null)
  }

  /**
   * T175 — état courant sur disque (pas l'index vivant, qui peut ignorer une édition faite hors
   * de l'app) de tous les repos : exigences, tests et `links/links.yaml` concaténés. Les ids sont
   * uniques sur le workspace (préfixes uniques) ; en cas de doublon, le repo racine gagne.
   */
  private async loadWorkingTreeSnapshot(rootRepoPath: string, repoPaths: string[], repoNames: Map<string, string>): Promise<ImpactSnapshot> {
    const requirements = new Map<string, { title: string; repoPath: string }>()
    const tests = new Map<string, { title: string; repoPath: string }>()
    const links: ObjectLink[] = []
    // Racine en dernier : ses entrées écrasent un éventuel doublon d'un composant.
    const ordered = [...repoPaths.filter((p) => p !== rootRepoPath), rootRepoPath]
    // Un fichier en cours d'édition peut être invalide : ignoré plutôt que de faire échouer
    // toute l'analyse (`readYaml`/`readYamlDir` propagent l'erreur de parsing).
    const readDir = async <T>(repoPath: string, dir: string): Promise<T[]> => {
      const files = (await this.git.listFiles(repoPath, dir)).filter((f) => f.endsWith('.yaml'))
      const items: (T | null)[] = await Promise.all(files.map((f) => this.readYamlLenient<T>(repoPath, f)))
      return items.filter((it): it is T => it !== null)
    }
    const perRepo = await Promise.all(ordered.map(async (repoPath) => {
      const [reqRecords, testRecords, linksData] = await Promise.all([
        readDir<Requirement>(repoPath, 'requirements'),
        readDir<TestCase>(repoPath, 'tests'),
        this.readYamlLenient<{ links: ObjectLink[] }>(repoPath, 'links/links.yaml'),
      ])
      return { repoPath, reqRecords, testRecords, repoLinks: linksData?.links ?? [] }
    }))
    for (const { repoPath, reqRecords, testRecords, repoLinks } of perRepo) {
      for (const r of reqRecords) if (r?.id) requirements.set(r.id, { title: r.title, repoPath })
      for (const t of testRecords) if (t?.id) tests.set(t.id, { title: t.title, repoPath })
      links.push(...repoLinks)
    }
    return { rootRepoPath, requirements, tests, links, repoNames }
  }

  /**
   * Construit les deux arbres d'impact (montant/descendant) d'un élément changé, à partir
   * d'un `ImpactSnapshot` déjà chargé (fonction pure, aucun accès git). Pour une exigence, les
   * tests la couvrant directement sont placés en tête de l'arbre descendant (pas d'arbre séparé
   * pour eux — ils sont rattachés à `reqId`, qui n'est lui-même pas un `ImpactNode`). Pour un
   * test (T175), l'arbre descendant est vide et l'arbre montant part des exigences qu'il couvre.
   * Un `Set` de nœuds visités est partagé par les deux arbres pour qu'un même élément
   * n'apparaisse qu'une fois (cf. spec T46 point 2).
   *
   * Liens de couverture test ↔ exigence : suivis quel que soit leur sens (cf. `matchCoverageLink`
   * — le lien peut avoir été créé depuis le test ou depuis l'exigence). Les liens exigence ↔
   * exigence gardent leur sens (source = enfant, cible = parent) ; un id qui n'est pas une
   * exigence du snapshot n'est jamais suivi comme exigence.
   */
  private buildImpactTreesFromSnapshot(
    snapshot: ImpactSnapshot,
    reqId: string,
    rootType: 'requirement' | 'test_case' = 'requirement',
  ): { descendantTree: ImpactNode[]; ascendantTree: ImpactNode[] } {
    // Index une fois (O(M)) plutôt que de filtrer `snapshot.links` en entier à chaque nœud visité
    // (qui serait O(nœuds × M) sur un projet avec beaucoup de liens).
    const bySource = new Map<string, ObjectLink[]>()
    const byTarget = new Map<string, ObjectLink[]>()
    for (const link of snapshot.links) {
      const s = bySource.get(link.sourceId) ?? []
      s.push(link)
      bySource.set(link.sourceId, s)
      const t = byTarget.get(link.targetId) ?? []
      t.push(link)
      byTarget.set(link.targetId, t)
    }

    const visited = new Set<string>([reqId])

    const makeNode = (elementId: string, elementType: 'requirement' | 'test_case', title: string, linkType: string, children: ImpactNode[] = []): ImpactNode => {
      const node: ImpactNode = {
        elementId, elementType, title, linkType,
        status: 'impact_non_verifie', comment: null, updatedAt: null, updatedBy: null,
        children,
      }
      const owner = elementType === 'requirement' ? snapshot.requirements.get(elementId) : snapshot.tests.get(elementId)
      const repo = elementRepoRef(snapshot, owner?.repoPath)
      if (repo) node.repo = repo
      return node
    }

    // Couverture dans les deux sens : test en source (lien créé depuis le test) ou en cible
    // (lien créé depuis l'exigence).
    const coverageLinksOf = (id: string): { otherId: string; link: ObjectLink }[] => [
      ...(byTarget.get(id) ?? []).map((link) => ({ otherId: link.sourceId, link })),
      ...(bySource.get(id) ?? []).map((link) => ({ otherId: link.targetId, link })),
    ]

    const testLeavesFor = (parentReqId: string): ImpactNode[] => {
      const leaves: ImpactNode[] = []
      for (const { otherId, link } of coverageLinksOf(parentReqId)) {
        if (!snapshot.tests.has(otherId)) continue
        if (visited.has(otherId)) continue
        visited.add(otherId)
        leaves.push(makeNode(otherId, 'test_case', snapshot.tests.get(otherId)!.title, link.type))
      }
      return leaves
    }

    const buildReqNode = (id: string, linkType: string, direction: 'descendant' | 'ascendant'): ImpactNode => {
      const children: ImpactNode[] = [...testLeavesFor(id)]
      const nextLinks = direction === 'descendant' ? (byTarget.get(id) ?? []) : (bySource.get(id) ?? [])
      for (const link of nextLinks) {
        const nextId = direction === 'descendant' ? link.sourceId : link.targetId
        if (visited.has(nextId) || !snapshot.requirements.has(nextId)) continue
        visited.add(nextId)
        children.push(buildReqNode(nextId, link.type, direction))
      }
      return makeNode(id, 'requirement', snapshot.requirements.get(id)!.title, linkType, children)
    }

    const collectDirect = (direction: 'descendant' | 'ascendant'): ImpactNode[] => {
      const links = direction === 'descendant' ? (byTarget.get(reqId) ?? []) : (bySource.get(reqId) ?? [])
      const nodes: ImpactNode[] = []
      for (const link of links) {
        const nextId = direction === 'descendant' ? link.sourceId : link.targetId
        if (visited.has(nextId) || !snapshot.requirements.has(nextId)) continue
        visited.add(nextId)
        nodes.push(buildReqNode(nextId, link.type, direction))
      }
      return nodes
    }

    if (rootType === 'test_case') {
      const ascendantTree: ImpactNode[] = []
      for (const { otherId, link } of coverageLinksOf(reqId)) {
        if (visited.has(otherId) || !snapshot.requirements.has(otherId)) continue
        visited.add(otherId)
        ascendantTree.push(buildReqNode(otherId, link.type, 'ascendant'))
      }
      return { descendantTree: [], ascendantTree }
    }

    const descendantTree: ImpactNode[] = [...testLeavesFor(reqId), ...collectDirect('descendant')]
    const ascendantTree: ImpactNode[] = collectDirect('ascendant')
    return { descendantTree, ascendantTree }
  }

  /**
   * T175 — analyse live des modifications locales : pour chaque repo du workspace (racine +
   * composants), exigences et tests dont le contenu sur disque diffère de HEAD (staged, unstaged
   * ou non suivis), puis arbres d'impact sur l'état courant sur disque. Jamais persistée.
   */
  async computeLocalImpactAnalysis(rootRepoPath: string, workspaceDir?: string): Promise<LocalImpactAnalysis> {
    const repoPaths = await this.resolveRepoPaths(rootRepoPath, workspaceDir)
    const repoNames = new Map<string, string>()
    if (workspaceDir && this.workspaceTree) {
      const tree = await this.workspaceTree.readCache(workspaceDir)
      for (const node of tree?.nodes ?? []) {
        if (node.repoPath) repoNames.set(node.repoPath, node.label ?? node.name)
      }
    }

    type LocalChange = { repoPath: string; elementType: 'requirement' | 'test_case'; entry: RequirementDiffEntry }
    const perRepo = await Promise.all(repoPaths.map(async (repoPath): Promise<{ head: string | null; changes: LocalChange[] }> => {
      const headSha = await this.sync.resolveHead(repoPath)
      if (!headSha) return { head: null, changes: [] } // repo sans commit : rien à comparer
      const files = (await this.sync.workdirChangesVsHead(repoPath, ['requirements', 'tests']))
        .filter((f) => f.path.endsWith('.yaml'))
      const changes = await Promise.all(files.map(async (f): Promise<LocalChange | null> => {
        const elementType = f.path.startsWith('tests/') ? 'test_case' : 'requirement'
        const [before, after] = await Promise.all([
          f.change === 'added' ? null : this.git.readYamlRef<Requirement | TestCase>(repoPath, headSha, f.path),
          f.change === 'removed' ? null : this.readYamlLenient<Requirement | TestCase>(repoPath, f.path),
        ])
        // Le type de changement vient de git (le fichier existe ou non), pas de la lisibilité du
        // YAML : un fichier en cours d'édition peut être invalide sans avoir été supprimé. Un côté
        // illisible → changement signalé sans détail de champs (id repris du nom de fichier).
        const id = after?.id ?? before?.id ?? path.posix.basename(f.path, '.yaml')
        const titleFrom = before?.title ?? null
        const titleTo = after?.title ?? null
        if (f.change === 'modified' && before && after) {
          const changedFields = diffElementFields(before, after, elementType)
          if (changedFields.length === 0) return null // même contenu champ à champ (ex. reformatage)
          return { repoPath, elementType, entry: { reqId: id, changeType: 'modified', changedFields, titleFrom, titleTo } }
        }
        return { repoPath, elementType, entry: { reqId: id, changeType: f.change, changedFields: [], titleFrom, titleTo } }
      }))
      return { head: headSha, changes: changes.filter((c): c is LocalChange => c !== null) }
    }))

    const result: LocalImpactAnalysis = {
      rootRepoPath,
      computedAt: new Date().toISOString(),
      heads: perRepo.flatMap((r, i) => (r.head ? [{ repoPath: repoPaths[i], sha: r.head }] : [])),
      changedRequirements: [],
    }
    const changes = perRepo.flatMap((r) => r.changes)
    if (changes.length === 0) return result // cas courant du polling : pas de snapshot à charger

    const snapshot = await this.loadWorkingTreeSnapshot(rootRepoPath, repoPaths, repoNames)
    // Repo racine d'abord (clé vide), puis composants par nom, puis id.
    const repoRank = (p: string) => (p === rootRepoPath ? '' : (repoNames.get(p) ?? path.basename(p)))
    changes.sort((a, b) =>
      repoRank(a.repoPath).localeCompare(repoRank(b.repoPath)) || a.entry.reqId.localeCompare(b.entry.reqId))

    result.changedRequirements = changes.map(({ repoPath, elementType, entry }) => {
      const trees = entry.changeType === 'removed'
        ? { descendantTree: [], ascendantTree: [] }
        : this.buildImpactTreesFromSnapshot(snapshot, entry.reqId, elementType)
      const changed: ChangedRequirement = {
        reqId: entry.reqId,
        title: (entry.changeType === 'removed' ? entry.titleFrom : (entry.titleTo ?? entry.titleFrom)) ?? entry.reqId,
        changeType: entry.changeType,
        changedFields: entry.changedFields,
        ...trees,
        elementType,
      }
      const repo = elementRepoRef(snapshot, repoPath)
      if (repo) changed.repo = repo
      return changed
    })
    return result
  }

  /** Crée et persiste une analyse d'impact entre deux baselines — calcul figé, une seule fois. */
  async createImpactAnalysis(repoPath: string, dto: CreateImpactAnalysisDto): Promise<ImpactAnalysis> {
    const [fromSha, toSha] = await Promise.all([
      this.sync.resolveTag(repoPath, dto.fromBaselineTag),
      this.sync.resolveTag(repoPath, dto.toBaselineTag),
    ])
    if (!fromSha) throw new Error(`Baseline "${dto.fromBaselineTag}" introuvable`)
    if (!toSha) throw new Error(`Baseline "${dto.toBaselineTag}" introuvable`)

    const [diffEntries, snapshot] = await Promise.all([
      this.diffRequirementsBetweenRefs(repoPath, fromSha, toSha),
      this.loadSnapshotAtRef(repoPath, toSha),
    ])

    const changedRequirements: ChangedRequirement[] = diffEntries.map((entry) => {
      if (entry.changeType === 'removed') {
        return {
          reqId: entry.reqId,
          title: entry.titleFrom ?? entry.reqId,
          changeType: entry.changeType,
          changedFields: entry.changedFields,
          descendantTree: [],
          ascendantTree: [],
        }
      }
      const { descendantTree, ascendantTree } = this.buildImpactTreesFromSnapshot(snapshot, entry.reqId)
      return {
        reqId: entry.reqId,
        title: entry.titleTo ?? entry.reqId,
        changeType: entry.changeType,
        changedFields: entry.changedFields,
        descendantTree,
        ascendantTree,
      }
    })

    const id = `impact-${Date.now()}`
    const analysis: ImpactAnalysis = {
      id,
      label: dto.label?.trim() || `${dto.fromBaselineTag} → ${dto.toBaselineTag}`,
      repoPath,
      fromBaseline: { tag: dto.fromBaselineTag, sha: fromSha },
      toBaseline: { tag: dto.toBaselineTag, sha: toSha },
      createdAt: new Date().toISOString(),
      createdBy: 'TODO:current-user',
      changedRequirements,
    }

    await this.git.writeYaml(repoPath, `impact-analyses/${id}.yaml`, analysis)
    return analysis
  }

  async listImpactAnalyses(repoPath: string): Promise<ImpactAnalysisSummary[]> {
    const files = await this.git.listFiles(repoPath, 'impact-analyses')
    const analyses = await Promise.all(
      files.filter((f) => f.endsWith('.yaml')).map((f) => this.git.readYaml<ImpactAnalysis>(repoPath, f)),
    )
    return analyses
      .filter((a): a is ImpactAnalysis => a != null)
      .map(({ changedRequirements: _changedRequirements, ...summary }) => summary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getImpactAnalysis(repoPath: string, id: string): Promise<ImpactAnalysis> {
    const analysis = await this.git.readYaml<ImpactAnalysis>(repoPath, `impact-analyses/${id}.yaml`)
    if (!analysis) throw new Error(`Analyse d'impact ${id} introuvable`)
    return analysis
  }

  async updateImpactItemStatus(repoPath: string, id: string, dto: UpdateImpactItemStatusDto): Promise<ImpactAnalysis> {
    const analysis = await this.getImpactAnalysis(repoPath, id)
    const changedReq = analysis.changedRequirements.find((cr) => cr.reqId === dto.reqId)
    if (!changedReq) throw new Error(`Exigence ${dto.reqId} absente de l'analyse ${id}`)

    const tree = dto.direction === 'descendant' ? changedReq.descendantTree : changedReq.ascendantTree
    const node = findImpactNodeById(tree, dto.elementId)
    if (!node) throw new Error(`Élément ${dto.elementId} absent de l'arbre ${dto.direction} de ${dto.reqId}`)

    node.status = dto.status
    node.comment = dto.comment ?? null
    node.updatedAt = new Date().toISOString()
    node.updatedBy = 'TODO:current-user'

    await this.git.writeYaml(repoPath, `impact-analyses/${id}.yaml`, analysis)
    return analysis
  }

  async deleteImpactAnalysis(repoPath: string, id: string): Promise<void> {
    await this.git.deleteFile(repoPath, `impact-analyses/${id}.yaml`)
  }

  async getImpactReport(repoPath: string, reqId: string, depth: number = 1, workspaceDir?: string): Promise<ImpactReport> {
    const repoPaths = await this.resolveRepoPaths(repoPath, workspaceDir)

    const req = await this.findRequirementById(reqId, repoPaths)
    if (!req) throw new Error(`Requirement ${reqId} not found`)

    // Merge latest run maps from all repos
    const latestRunMapsArr = await Promise.all(repoPaths.map(p => this.testsIndex.getLatestRunMap(p)))
    const latestRunMap = new Map<string, import('@polenta/types').TestRun>()
    for (const map of latestRunMapsArr) {
      for (const [k, v] of map) latestRunMap.set(k, v)
    }

    const ackFiles = await this.git.listFiles(repoPath, `impact-acks/${reqId}`)
    const acks = new Map<string, ImpactAcknowledgement>()
    for (const file of ackFiles.filter((f) => f.endsWith('.yaml'))) {
      const ack = await this.git.readYaml<ImpactAcknowledgement>(repoPath, file)
      if (ack) acks.set(ack.elementId, ack)
    }

    const items: import('@polenta/types').ImpactItem[] = []
    const visited = new Set<string>([reqId])

    interface QueueEntry {
      id: string
      depth: number
      linkType: string
      elementType: 'requirement' | 'test_case'
    }

    const queue: QueueEntry[] = []

    // Collect links from all repos
    const allLinksForReq = (await Promise.all(repoPaths.map(p => this.reqIndex.findLinks(p, reqId)))).flat()
    const links = allLinksForReq
    for (const link of links.filter((l) => l.targetId === reqId)) {
      if (!visited.has(link.sourceId)) {
        queue.push({ id: link.sourceId, depth: 1, linkType: link.type, elementType: 'requirement' })
      }
    }

    const allTestsArrays = await Promise.all(repoPaths.map(p => this.testsIndex.findAll(p)))
    const allTests = allTestsArrays.flat()
    const allLinksArrays = await Promise.all(repoPaths.map(p => this.reqIndex.findAllLinks(p)))
    const allLinks = allLinksArrays.flat()
    const tcIds = new Set(allTests.map((t) => t.id))
    for (const link of allLinks) {
      if (tcIds.has(link.sourceId) && link.targetId === reqId) {
        queue.push({ id: link.sourceId, depth: 1, linkType: link.type, elementType: 'test_case' })
      } else if (tcIds.has(link.targetId) && link.sourceId === reqId) {
        queue.push({ id: link.targetId, depth: 1, linkType: link.type, elementType: 'test_case' })
      }
    }

    while (queue.length > 0) {
      const entry = queue.shift()!
      if (visited.has(entry.id)) continue
      visited.add(entry.id)
      if (entry.depth > depth) continue

      if (entry.elementType === 'requirement') {
        const depReq = await this.findRequirementById(entry.id, repoPaths)
        if (!depReq) continue
        items.push({
          elementId: entry.id,
          elementType: 'requirement',
          title: depReq.title,
          linkType: entry.linkType,
          depth: entry.depth,
          acknowledged: acks.has(entry.id),
        })
        if (entry.depth < depth) {
          const depLinksArrays = await Promise.all(repoPaths.map(p => this.reqIndex.findLinks(p, entry.id)))
          const depLinks = depLinksArrays.flat()
          for (const link of depLinks.filter((l) => l.targetId === entry.id)) {
            if (!visited.has(link.sourceId)) {
              queue.push({ id: link.sourceId, depth: entry.depth + 1, linkType: link.type, elementType: 'requirement' })
            }
          }
        }
      } else {
        const tc = await this.testsIndex.findById(repoPath, entry.id) ??
          (await Promise.all(repoPaths.map(p => this.testsIndex.findById(p, entry.id)))).find(t => t != null)
        if (!tc) continue
        const latestRun = latestRunMap.get(tc.id)
        items.push({
          elementId: entry.id,
          elementType: 'test_case',
          title: tc.title,
          linkType: entry.linkType,
          depth: entry.depth,
          lastRunResult: latestRun?.result,
          lastRunDate: latestRun?.executedAt,
          acknowledged: acks.has(entry.id),
        })
      }
    }

    return {
      triggerId: reqId,
      triggerType: 'requirement',
      depth,
      items,
      activeCampaignRuns: [],
      generatedAt: new Date().toISOString(),
    }
  }

  async acknowledgeImpact(
    repoPath: string,
    reqId: string,
    dto: AcknowledgeImpactDto,
  ): Promise<ImpactAcknowledgement> {
    const req = await this.reqIndex.findById(repoPath, reqId)
    if (!req) throw new Error(`Requirement ${reqId} not found`)

    const ackId = `ack-${Date.now()}`
    const ack: ImpactAcknowledgement = {
      id: ackId,
      elementId: dto.elementId,
      elementType: dto.elementType,
      triggerReqId: reqId,
      acknowledgedAt: new Date().toISOString(),
      acknowledgedBy: 'TODO:current-user',
      comment: dto.comment,
    }

    await this.git.writeYaml(repoPath, `impact-acks/${reqId}/${ackId}.yaml`, ack)
    return ack
  }

  async generateTestPlan(repoPath: string, dto: GenerateTestPlanDto, workspaceDir?: string): Promise<TestPlanDraft> {
    const repoPaths = await this.resolveRepoPaths(repoPath, workspaceDir)

    let requirements = (await Promise.all(repoPaths.map(p => this.reqIndex.findAll(p, {})))).flat()
    if (dto.requirementIds?.length) requirements = requirements.filter((r) => dto.requirementIds!.includes(r.id))
    if (dto.requirementTypes?.length) requirements = requirements.filter((r) => dto.requirementTypes!.includes(r.objectTypeRef))
    if (dto.requirementTags?.length) {
      requirements = requirements.filter((r) => {
        const tags = (r.fields as Record<string, unknown>)['tags'] as string[] | undefined
        return dto.requirementTags!.some((t) => tags?.includes(t))
      })
    }

    const testCases = (await Promise.all(repoPaths.map(p => this.testsIndex.findAll(p)))).flat()
    const allLinks = (await Promise.all(repoPaths.map(p => this.reqIndex.findAllLinks(p)))).flat()
    const reqIds = new Set(requirements.map((r) => r.id))
    const tcIds = new Set(testCases.map((tc) => tc.id))
    const tcMap = new Map(testCases.map((tc) => [tc.id, tc]))

    const reqToTests = new Map<string, TestCase[]>()
    for (const link of allLinks) {
      const match = matchCoverageLink(link, tcIds, reqIds)
      if (!match) continue
      if (dto.coverageFilter === 'full_only' && link.coverageType !== 'full') continue
      const tc = tcMap.get(match.testId)!
      const arr = reqToTests.get(match.reqId) ?? []
      arr.push(tc)
      reqToTests.set(match.reqId, arr)
    }

    const selectedTcIds = new Set<string>()
    const uncoveredRequirementIds: string[] = []
    for (const req of requirements) {
      const tests = reqToTests.get(req.id) ?? []
      if (tests.length === 0) uncoveredRequirementIds.push(req.id)
      else for (const tc of tests) selectedTcIds.add(tc.id)
    }

    const selectedTests = testCases.filter((tc) => selectedTcIds.has(tc.id))
    const latestRunMapsArr = await Promise.all(repoPaths.map(p => this.testsIndex.getLatestRunMap(p)))
    const latestRunMap = new Map<string, import('@polenta/types').TestRun>()
    for (const map of latestRunMapsArr) {
      for (const [k, v] of map) latestRunMap.set(k, v)
    }

    let withPassingRun = 0
    let withFailingRun = 0
    let neverExecuted = 0
    const testCaseRefs: string[] = []

    for (const tc of selectedTests) {
      testCaseRefs.push(tc.id)
      const run = latestRunMap.get(tc.id)
      if (!run) neverExecuted++
      else if (run.result === 'PASS') withPassingRun++
      else withFailingRun++
    }

    return {
      title: dto.title,
      testCaseRefs,
      summary: {
        selectedRequirements: requirements.length,
        testCasesFound: selectedTests.length,
        withPassingRun,
        withFailingRun,
        neverExecuted,
        uncoveredRequirements: uncoveredRequirementIds.length,
      },
      uncoveredRequirementIds,
    }
  }

  async exportCsv(repoPath: string, filters: MatrixFiltersDto, workspaceDir?: string): Promise<MatrixExportRow[]> {
    const matrix = await this.getMatrix(repoPath, filters, workspaceDir)
    const tcTitleMap = new Map(matrix.testCases.map((tc) => [tc.id, tc.title]))
    const rows: MatrixExportRow[] = []
    for (const row of matrix.requirements) {
      if (row.cells.length === 0) {
        rows.push({
          reqId: row.requirement.id,
          reqTitle: row.requirement.title,
          reqObjectTypeRef: row.requirement.objectTypeRef,
          reqStatus: row.requirement.status,
          coverageStatus: row.coverageStatus,
          testId: null,
          testTitle: null,
          coverageType: null,
          lastRunResult: null,
          lastRunDate: null,
        })
      } else {
        for (const cell of row.cells) {
          rows.push({
            reqId: row.requirement.id,
            reqTitle: row.requirement.title,
            reqObjectTypeRef: row.requirement.objectTypeRef,
            reqStatus: row.requirement.status,
            coverageStatus: row.coverageStatus,
            testId: cell.testCaseId,
            testTitle: tcTitleMap.get(cell.testCaseId) ?? null,
            coverageType: cell.coverageType,
            lastRunResult: cell.status === 'not_run' ? null : cell.status,
            lastRunDate: cell.lastRunDate,
          })
        }
      }
    }
    return rows
  }
}

/**
 * T63 fix (T77 sprint 3: found NOT applied here — see below) — priority order is
 * `needs_revalidation` > `failing` > `covered` (≥1 linked test still `not_run`) >
 * `validated` (every linked, non-failing/non-revalidation test has a PASS run), per
 * `specs/SPEC-TRACEABILITY.md` §2.2 ("needs_revalidation > failing > covered >
 * validated > not_covered") and `specs/T63.md`'s root-cause writeup.
 *
 * T63 was originally reported (and fixed) against `apps/api/src/modules/
 * traceability/traceability.service.ts` (the NestJS web-API copy) — that file's
 * `computeCoverageStatus` already has the corrected `some(not_run) → covered`
 * check. This desktop copy (`apps/desktop/.../traceability.service.ts`) was never
 * updated to match and still had the pre-fix `some(pass) → validated` check, i.e.
 * a single PASS run among several still-`not_run` tests wrongly reported
 * `validated` instead of `covered`. T77 sprint 3 instructions explicitly called
 * for verifying this ("peut-être déjà corrigé") before reusing this function for
 * the new query-engine dataset column — verification found it was NOT corrected,
 * fixed here rather than reusing (and thereby propagating) the stale logic.
 *
 * Exported (T77 sprint 3) so the query-engine dataset can reuse this exact
 * aggregation via `computeCoverage()` above rather than re-implementing it.
 */
export function computeCoverageStatus(cells: MatrixCell[]): CoverageStatus {
  if (cells.length === 0) return 'not_covered'
  if (cells.some((c) => c.status === 'needs_revalidation')) return 'needs_revalidation'
  if (cells.some((c) => c.status === 'fail' || c.status === 'blocked')) return 'failing'
  if (cells.some((c) => c.status === 'not_run')) return 'covered'
  return 'validated'
}
