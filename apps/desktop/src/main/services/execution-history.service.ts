import type {
  CampaignTestRun, ExecutionHistory, ExecutionHistoryRow, ExecutionHistoryTarget, ObjectLink, TestCampaign, TestCase,
} from '@polenta/types'
import { sortExecutionHistory } from '@polenta/types'
import type { CampaignsService } from './campaigns.service'
import type { RequirementsService } from './requirements.service'
import type { TestsService } from './tests.service'
import { matchCoverageLink } from './traceability.service'

const OPEN_STATUSES = new Set(['planned', 'in_progress'])

/**
 * GH197 — historique des exécutions d'un test ou d'une exigence (specs/GH197.md §1, §5) : runs,
 * campagne et entrée de chacun (entrée retirée GH73 comprise), entrées en attente des campagnes
 * ouvertes, règle T179 pour une exigence. Lecture seule.
 */
export class ExecutionHistoryService {
  constructor(
    private readonly tests: TestsService,
    private readonly campaigns: CampaignsService,
    private readonly requirements: Pick<RequirementsService, 'findLinks'>,
  ) {}

  async history(repoPath: string, target: ExecutionHistoryTarget, workspaceDir?: string): Promise<ExecutionHistory> {
    const allTests = await this.tests.findAll(repoPath)
    const requirementId = 'requirementId' in target ? target.requirementId : undefined
    const tests = requirementId
      ? await this.coveringTests(repoPath, requirementId, allTests)
      : allTests.filter(t => t.id === (target as { testId: string }).testId)

    const campaigns = await this.campaigns.list(repoPath).catch((): TestCampaign[] => [])
    const rows: ExecutionHistoryRow[] = []
    const typeRefs = new Set<string>()

    for (const test of tests) {
      typeRefs.add(test.objectTypeRef)
      const base = { testCaseId: test.id, testTitle: test.title, objectTypeRef: test.objectTypeRef }
      // T179 — un run (ou une instance) générée pour une autre exigence ne compte pas pour celle-ci.
      const forTarget = (reqId?: string) => !requirementId || !reqId || reqId === requirementId

      for (const run of await this.tests.findRuns(repoPath, test.id)) {
        if (!forTarget(run.requirementId)) continue
        const row: ExecutionHistoryRow = { key: run.id, kind: 'run', ...base, run }
        const ref = run.campaignEntry
        if (ref) {
          const campaign = campaigns.find(c => c.id === ref.campaignId)
          if (!campaign) {
            row.campaignMissing = true
          } else {
            row.campaign = campaignInfo(campaign)
            const live = campaign.runs.find(e => e.entryId === ref.entryId)
            const removed = live ? undefined : campaign.removedRuns?.find(e => e.entryId === ref.entryId)
            const entry = live ?? removed
            if (entry) row.entry = entryInfo(entry)
            if (removed) row.removed = true
          }
        }
        rows.push(row)
      }

      for (const campaign of campaigns) {
        if (!OPEN_STATUSES.has(campaign.status)) continue
        for (const entry of campaign.runs) {
          if (entry.testCaseId !== test.id || entry.status !== 'pending' || entry.runId) continue
          if (!forTarget(entry.requirementId)) continue
          rows.push({
            key: `pending:${campaign.id}:${entry.entryId}`, kind: 'pending', ...base,
            campaign: campaignInfo(campaign), entry: entryInfo(entry),
          })
        }
      }
    }

    const runFieldDefs: ExecutionHistory['runFieldDefs'] = {}
    for (const ref of typeRefs) {
      const def = await this.tests.typeDefFor(repoPath, ref, workspaceDir).catch(() => null)
      runFieldDefs[ref] = { runFields: def?.runFields ?? [], stepFields: def?.stepFields ?? [] }
    }
    return { rows: sortExecutionHistory(rows), runFieldDefs }
  }

  /** Tests reliés à l'exigence (tout lien test ↔ exigence, sens indifférent, comme la traçabilité). */
  private async coveringTests(repoPath: string, requirementId: string, allTests: TestCase[]): Promise<TestCase[]> {
    const links = (await this.requirements.findLinks(repoPath, requirementId)) as ObjectLink[]
    const tcIds = new Set(allTests.map(t => t.id))
    const reqIds = new Set([requirementId])
    const ids = new Set(links.map(l => matchCoverageLink(l, tcIds, reqIds)?.testId).filter((id): id is string => !!id))
    return allTests.filter(t => ids.has(t.id))
  }
}

function campaignInfo(c: TestCampaign): NonNullable<ExecutionHistoryRow['campaign']> {
  return { id: c.id, title: c.title, status: c.status, ...(c.baselineRef && { baselineRef: c.baselineRef }), fields: c.fields ?? {} }
}

function entryInfo(e: CampaignTestRun): NonNullable<ExecutionHistoryRow['entry']> {
  return {
    entryId: e.entryId,
    ...(e.requirementId && { requirementId: e.requirementId }),
    ...(e.paramValues && { paramValues: e.paramValues }),
    ...(e.resolvedParams && { resolvedParams: e.resolvedParams }),
    ...(e.testSnapshot?.version !== undefined && { testVersion: e.testSnapshot.version }),
    ...(e.carriedFrom && { carriedFrom: e.carriedFrom }),
  }
}
