import { Injectable, NotFoundException } from '@nestjs/common'
import { GitService } from '../git/git.service'
import { RequirementsIndexService } from '../index/requirements-index.service'
import { TestsIndexService } from '../index/tests-index.service'
import { ProjectsRegistryService } from '../projects/projects-registry.service'
import type { AcknowledgeImpactDto, GenerateTestPlanDto, MatrixFiltersDto } from '@polenta/zod-schemas'
import type {
  CellStatus,
  CoverageStatus,
  ImpactAcknowledgement,
  ImpactReport,
  MatrixCell,
  MatrixExportRow,
  MatrixRow,
  TestPlanDraft,
  TraceabilityMatrix,
} from '@polenta/types'
import type { TestCase } from '@polenta/types'

// Forme historique (lien marqué) de RevalidationItem : `@polenta/types` est passé à une forme
// par élément avec T172 (desktop) ; cette copie apps/api n'est pas alignée (hors scope T172).
export interface LegacyRevalidationItem {
  type: 'req_link' | 'coverage_link'
  sourceId: string
  sourceTitle: string
  targetId: string
  targetTitle: string
  linkType: string
  reason: string
}

@Injectable()
export class TraceabilityService {
  constructor(
    private readonly reqIndex: RequirementsIndexService,
    private readonly testsIndex: TestsIndexService,
    private readonly git: GitService,
    private readonly registry: ProjectsRegistryService,
  ) {}

  // ─── Coverage Matrix ─────────────────────────────────────────────────────────

  async getMatrix(projectId: string, branchId: string, filters: MatrixFiltersDto): Promise<TraceabilityMatrix> {
    const branch = this.registry.getBranch(projectId, branchId)

    const requirements = await this.reqIndex.findAll(projectId, branch.name, {
      objectTypeRef: filters.type,
      status: filters.status,
      tags: filters.tags,
    })

    const allLinks = await this.reqIndex.findAllLinks(projectId, branch.name)
    // Coverage links: links with coverageType set (req → test case direction)
    const coverageLinks = allLinks.filter((l) => l.coverageType !== undefined)

    let testCases = await this.testsIndex.findAll(projectId, branch.name)
    if (filters.testType) {
      testCases = testCases.filter((tc) => tc.objectTypeRef.includes(filters.testType!))
    }

    const latestRunMap = await this.testsIndex.getLatestRunMap(projectId, branch.name)

    // Build reqId → [{testCaseId, coverageType, needsRevalidation}]
    const reqToTests = new Map<string, Array<{ tc: TestCase; coverageType: 'full' | 'partial'; needsRevalidation: boolean }>>()
    const testCaseMap = new Map(testCases.map((tc) => [tc.id, tc]))
    for (const link of coverageLinks) {
      const tc = testCaseMap.get(link.targetId)
      if (!tc) continue
      const arr = reqToTests.get(link.sourceId) ?? []
      arr.push({ tc, coverageType: link.coverageType!, needsRevalidation: link.needsRevalidation ?? false })
      reqToTests.set(link.sourceId, arr)
    }

    // Collect test case columns (linked to at least one displayed requirement)
    const colIds = new Set<string>()
    for (const req of requirements) {
      for (const { tc } of reqToTests.get(req.id) ?? []) {
        colIds.add(tc.id)
      }
    }
    const testCaseColumns = testCases
      .filter((tc) => colIds.has(tc.id))
      .map((tc) => ({ id: tc.id, title: tc.title, objectTypeRef: tc.objectTypeRef, status: tc.status }))

    const rows: MatrixRow[] = requirements.map((req) => {
      const links = reqToTests.get(req.id) ?? []
      const cells: MatrixCell[] = links.map(({ tc, coverageType, needsRevalidation }) => {
        const latestRun = latestRunMap.get(tc.id)
        let status: CellStatus
        if (needsRevalidation) {
          status = 'needs_revalidation'
        } else if (!latestRun) {
          status = 'not_run'
        } else if (latestRun.result === 'PASS') {
          status = 'pass'
        } else if (latestRun.result === 'FAIL') {
          status = 'fail'
        } else {
          status = 'blocked'
        }
        return {
          testCaseId: tc.id,
          coverageType,
          status,
          lastRunId: latestRun?.id ?? null,
          lastRunDate: latestRun?.executedAt ?? null,
        }
      })
      return { requirement: req, coverageStatus: computeCoverageStatus(cells), cells }
    })

    return {
      requirements: rows,
      testCases: testCaseColumns,
      filters: filters as Record<string, unknown>,
      generatedAt: new Date().toISOString(),
    }
  }

  // ─── Missing links ────────────────────────────────────────────────────────────

  async getMissingLinks(projectId: string, branchId: string) {
    const branch = this.registry.getBranch(projectId, branchId)

    const [requirements, testCases, linksNeedingRevalidation] = await Promise.all([
      this.reqIndex.findAll(projectId, branch.name, {}),
      this.testsIndex.findAll(projectId, branch.name),
      this.reqIndex.findLinksNeedingRevalidation(projectId, branch.name),
    ])

    const allLinks = await this.reqIndex.findAllLinks(projectId, branch.name)
    const coverageLinks = allLinks.filter((l) => l.coverageType !== undefined)

    // Covered requirement IDs (any test linked to them)
    const coveredReqIds = new Set(coverageLinks.map((l) => l.sourceId))
    const testIdsWithLinks = new Set(coverageLinks.map((l) => l.targetId))

    const uncoveredRequirements = requirements.filter((r) => !coveredReqIds.has(r.id))
    const orphanTests = testCases.filter((tc) => !testIdsWithLinks.has(tc.id))

    const revalidationItems: LegacyRevalidationItem[] = []

    // Req-to-req links needing revalidation
    const reqRevalidationLinks = linksNeedingRevalidation.filter((l) => l.coverageType === undefined)
    for (const link of reqRevalidationLinks) {
      const [source, target] = await Promise.all([
        this.reqIndex.findById(projectId, branch.name, link.sourceId),
        this.reqIndex.findById(projectId, branch.name, link.targetId),
      ])
      if (!source || !target) continue
      revalidationItems.push({
        type: 'req_link',
        sourceId: link.sourceId,
        sourceTitle: source.title,
        targetId: link.targetId,
        targetTitle: target.title,
        linkType: link.type,
        reason: 'Target requirement has been modified since this link was created',
      })
    }

    // Coverage links needing revalidation
    const coverageRevalidationLinks = linksNeedingRevalidation.filter((l) => l.coverageType !== undefined)
    const testCaseMap = new Map(testCases.map((tc) => [tc.id, tc]))
    for (const link of coverageRevalidationLinks) {
      const req = await this.reqIndex.findById(projectId, branch.name, link.sourceId)
      const tc = testCaseMap.get(link.targetId)
      if (!req || !tc) continue
      revalidationItems.push({
        type: 'coverage_link',
        sourceId: tc.id,
        sourceTitle: tc.title,
        targetId: link.sourceId,
        targetTitle: req.title,
        linkType: 'COVERS',
        reason: 'Linked requirement has been modified since this test was linked',
      })
    }

    return { uncoveredRequirements, orphanTests, revalidationItems }
  }

  // ─── Impact analysis ──────────────────────────────────────────────────────────

  async getImpactReport(
    projectId: string,
    branchId: string,
    reqId: string,
    depth: number = 1,
  ): Promise<ImpactReport> {
    const branch = this.registry.getBranch(projectId, branchId)
    const req = await this.reqIndex.findById(projectId, branch.name, reqId)
    if (!req) throw new NotFoundException(`Requirement ${reqId} not found`)

    const latestRunMap = await this.testsIndex.getLatestRunMap(projectId, branch.name)

    // Load existing acknowledgements for this trigger
    const ackFiles = await this.git.listFiles(projectId, branch.name, `impact-acks/${reqId}/`)
    const acks = new Map<string, ImpactAcknowledgement>()
    for (const file of ackFiles.filter((f) => f.endsWith('.yaml'))) {
      const ack = await this.git.readYaml<ImpactAcknowledgement>(projectId, branch.name, file)
      if (ack) acks.set(ack.elementId, ack)
    }

    const items: import('@polenta/types').ImpactItem[] = []
    const visited = new Set<string>([reqId])

    interface QueueEntry { id: string; depth: number; linkType: string; elementType: 'requirement' | 'test_case' }
    const queue: QueueEntry[] = []

    // Seed: requirements that depend on reqId (source → reqId as target)
    const links = await this.reqIndex.findLinks(projectId, branch.name, reqId)
    for (const link of links.filter((l) => l.targetId === reqId && l.coverageType === undefined)) {
      if (!visited.has(link.sourceId)) {
        queue.push({ id: link.sourceId, depth: 1, linkType: link.type, elementType: 'requirement' })
      }
    }

    // Seed: test cases that cover reqId (coverage links: sourceId=reqId, targetId=testCaseId)
    const allLinks = await this.reqIndex.findAllLinks(projectId, branch.name)
    for (const link of allLinks.filter((l) => l.sourceId === reqId && l.coverageType !== undefined)) {
      queue.push({ id: link.targetId, depth: 1, linkType: link.type, elementType: 'test_case' })
    }

    while (queue.length > 0) {
      const entry = queue.shift()!
      if (visited.has(entry.id)) continue
      visited.add(entry.id)

      if (entry.depth > depth) continue

      if (entry.elementType === 'requirement') {
        const depReq = await this.reqIndex.findById(projectId, branch.name, entry.id)
        if (!depReq) continue
        items.push({
          elementId: entry.id,
          elementType: 'requirement' as const,
          title: depReq.title,
          linkType: entry.linkType,
          depth: entry.depth,
          acknowledged: acks.has(entry.id),
        })
        // Recurse deeper if needed
        if (entry.depth < depth) {
          const depLinks = await this.reqIndex.findLinks(projectId, branch.name, entry.id)
          for (const link of depLinks.filter((l) => l.targetId === entry.id && l.coverageType === undefined)) {
            if (!visited.has(link.sourceId)) {
              queue.push({ id: link.sourceId, depth: entry.depth + 1, linkType: link.type, elementType: 'requirement' })
            }
          }
        }
      } else {
        const tc = await this.testsIndex.findById(projectId, branch.name, entry.id)
        if (!tc) continue
        const latestRun = latestRunMap.get(tc.id)
        items.push({
          elementId: entry.id,
          elementType: 'test_case' as const,
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
    projectId: string,
    branchId: string,
    reqId: string,
    dto: AcknowledgeImpactDto,
  ): Promise<ImpactAcknowledgement> {
    const branch = this.registry.getBranch(projectId, branchId)
    const req = await this.reqIndex.findById(projectId, branch.name, reqId)
    if (!req) throw new NotFoundException(`Requirement ${reqId} not found`)

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

    await this.git.writeAndCommit(
      projectId,
      branch.name,
      [{ path: `impact-acks/${reqId}/${ackId}.yaml`, content: ack }],
      `chore(${reqId}): acknowledge impact on ${dto.elementId}`,
      { name: 'Polenta User', email: 'user@polenta' },
    )

    return ack
  }

  // ─── Test plan generation ─────────────────────────────────────────────────────

  async generateTestPlan(
    projectId: string,
    branchId: string,
    dto: GenerateTestPlanDto,
  ): Promise<TestPlanDraft> {
    const branch = this.registry.getBranch(projectId, branchId)

    let requirements = await this.reqIndex.findAll(projectId, branch.name, {})

    if (dto.requirementIds?.length) {
      requirements = requirements.filter((r) => dto.requirementIds!.includes(r.id))
    }
    if (dto.requirementTypes?.length) {
      requirements = requirements.filter((r) => dto.requirementTypes!.includes(r.objectTypeRef))
    }
    if (dto.requirementTags?.length) {
      requirements = requirements.filter((r) => {
        const tags = (r.fields as Record<string, unknown>)['tags'] as string[] | undefined
        return dto.requirementTags!.some((t) => tags?.includes(t))
      })
    }

    let testCases = await this.testsIndex.findAll(projectId, branch.name)
    if (dto.testCaseFilter === 'approved_only') {
      testCases = testCases.filter((tc) => tc.status.toLowerCase() === 'approved')
    }

    const allLinks = await this.reqIndex.findAllLinks(projectId, branch.name)
    const coverageLinks = allLinks.filter((l) => l.coverageType !== undefined)

    // Build reqId → test cases map
    const testCaseMap = new Map(testCases.map((tc) => [tc.id, tc]))
    const reqToTests = new Map<string, TestCase[]>()
    for (const link of coverageLinks) {
      if (dto.coverageFilter === 'full_only' && link.coverageType !== 'full') continue
      const tc = testCaseMap.get(link.targetId)
      if (!tc) continue
      const arr = reqToTests.get(link.sourceId) ?? []
      arr.push(tc)
      reqToTests.set(link.sourceId, arr)
    }

    // Collect unique test cases covering selected requirements
    const selectedTcIds = new Set<string>()
    const uncoveredRequirementIds: string[] = []
    for (const req of requirements) {
      const tests = reqToTests.get(req.id) ?? []
      if (tests.length === 0) {
        uncoveredRequirementIds.push(req.id)
      } else {
        for (const tc of tests) selectedTcIds.add(tc.id)
      }
    }

    const selectedTests = testCases.filter((tc) => selectedTcIds.has(tc.id))
    const latestRunMap = await this.testsIndex.getLatestRunMap(projectId, branch.name)

    let withPassingRun = 0, withFailingRun = 0, neverExecuted = 0
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

  // ─── CSV export ───────────────────────────────────────────────────────────────

  async exportCsv(projectId: string, branchId: string, filters: MatrixFiltersDto): Promise<MatrixExportRow[]> {
    const matrix = await this.getMatrix(projectId, branchId, filters)
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeCoverageStatus(cells: MatrixCell[]): CoverageStatus {
  if (cells.length === 0) return 'not_covered'
  if (cells.some((c) => c.status === 'needs_revalidation')) return 'needs_revalidation'
  if (cells.some((c) => c.status === 'fail' || c.status === 'blocked')) return 'failing'
  if (cells.some((c) => c.status === 'not_run')) return 'covered'
  return 'validated'
}
