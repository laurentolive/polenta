import type {
  CampaignTestRun, ExecutionHistory, ExecutionHistoryRow, ExecutionHistoryTarget, ObjectLink, TestCampaign, TestCase, TestRun,
} from '@polenta/types'
import { isOpenCampaignStatus, sortExecutionHistory } from '@polenta/types'
import type { CampaignsService } from './campaigns.service'
import type { RequirementsService } from './requirements.service'
import type { TestsService } from './tests.service'
import { matchCoverageLink } from './traceability.service'

/**
 * GH197 — historique des exécutions d'un test ou d'une exigence (specs/GH197.md §1, §5) : runs,
 * campagne et entrée de chacun (entrée retirée GH73, run remplacé par un nouvel essai), entrées en
 * attente des campagnes ouvertes, règle T179 pour une exigence. Lecture seule.
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

    // Une erreur de lecture des campagnes remonte : sinon chaque run serait affiché « campagne introuvable ».
    const campaigns = await this.campaigns.list(repoPath)
    const campaignById = new Map(campaigns.map(c => [c.id, c]))
    const pendingByTest = new Map<string, { campaign: TestCampaign; entry: CampaignTestRun }[]>()
    for (const campaign of campaigns) {
      if (!isOpenCampaignStatus(campaign.status)) continue
      for (const entry of campaign.runs) {
        if (entry.status !== 'pending' || entry.runId) continue
        const list = pendingByTest.get(entry.testCaseId) ?? []
        list.push({ campaign, entry })
        pendingByTest.set(entry.testCaseId, list)
      }
    }
    // T179 — un run (ou une instance) générée pour une autre exigence ne compte pas pour celle-ci.
    const forTarget = (reqId?: string) => !requirementId || !reqId || reqId === requirementId

    const runsByTest = await Promise.all(tests.map(t => this.tests.findRuns(repoPath, t.id)))
    const rows: ExecutionHistoryRow[] = []
    tests.forEach((test, i) => {
      const base = { testCaseId: test.id, testTitle: test.title, objectTypeRef: test.objectTypeRef }
      for (const run of runsByTest[i]) {
        if (forTarget(run.requirementId)) rows.push(runRow(run, base, campaignById))
      }
      for (const { campaign, entry } of pendingByTest.get(test.id) ?? []) {
        if (!forTarget(entry.requirementId)) continue
        rows.push({
          key: `pending:${campaign.id}:${entry.entryId}`, kind: 'pending', ...base,
          campaign: campaignInfo(campaign), entry: entryInfo(entry),
        })
      }
    })

    const typeRefs = [...new Set(tests.map(t => t.objectTypeRef))]
    const defs = await Promise.all(typeRefs.map(ref => this.tests.typeDefFor(repoPath, ref, workspaceDir).catch(() => null)))
    const runFieldDefs: ExecutionHistory['runFieldDefs'] = {}
    typeRefs.forEach((ref, i) => { runFieldDefs[ref] = { runFields: defs[i]?.runFields ?? [], stepFields: defs[i]?.stepFields ?? [] } })
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

/**
 * Ligne d'un run. L'entrée de campagne n'est reprise que si elle porte ce run (`runId`) : un run
 * remplacé par un nouvel essai garde sa campagne et son `entryId`, mais ni les données de l'entrée
 * (version, paramètres de l'essai courant) ni le lien d'ouverture (`superseded`).
 */
function runRow(run: TestRun, base: Pick<ExecutionHistoryRow, 'testCaseId' | 'testTitle' | 'objectTypeRef'>, campaigns: Map<string, TestCampaign>): ExecutionHistoryRow {
  const row: ExecutionHistoryRow = { key: run.id, kind: 'run', ...base, run }
  const ref = run.campaignEntry
  if (!ref) return row
  const campaign = campaigns.get(ref.campaignId)
  if (!campaign) return { ...row, campaignMissing: true }
  row.campaign = campaignInfo(campaign)
  const live = campaign.runs.find(e => e.entryId === ref.entryId)
  const removed = live ? undefined : campaign.removedRuns?.find(e => e.entryId === ref.entryId)
  const entry = live ?? removed
  if (removed) row.removed = true
  if (entry && (!entry.runId || entry.runId === run.id)) row.entry = entryInfo(entry)
  else {
    row.entry = { entryId: ref.entryId }
    if (entry) row.superseded = true
  }
  return row
}

function campaignInfo(c: TestCampaign): NonNullable<ExecutionHistoryRow['campaign']> {
  return { id: c.id, title: c.title, status: c.status, fields: c.fields ?? {} }
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
