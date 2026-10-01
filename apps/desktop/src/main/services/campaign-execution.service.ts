import type { ExecutionSheetLocale, TestCase } from '@polenta/types'
import type { CampaignsService } from './campaigns.service'
import type { TestsService } from './tests.service'
import { buildExecutionSheetModel, writeExecutionWorkbook, type ExecutionSheetEntry } from './export/campaign-execution.xlsx'

/**
 * GH36 — exécution d'une campagne hors outil : export d'un classeur Excel à remplir par les
 * testeurs (sprint 1), puis réimport des résultats (sprint 2). Cf. specs/GH36-design.md §3.5.
 */
export class CampaignExecutionService {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly tests: TestsService,
  ) {}

  async exportSheet(repoPath: string, campaignId: string, locale: ExecutionSheetLocale, destPath: string): Promise<void> {
    const campaign = await this.campaigns.get(repoPath, campaignId)
    if (campaign.status === 'completed' || campaign.status === 'abandoned') {
      throw new Error(`La campagne ${campaignId} est clôturée : pas d'exécution hors outil possible.`)
    }

    // Même repli que l'écran (`resolveCampaignRuns`) : copie figée à l'inclusion, sinon état live
    // du test (entrées antérieures à T49) ; test introuvable → instance sans étape.
    const liveIds = [...new Set(campaign.runs.filter(r => !r.testSnapshot).map(r => r.testCaseId))]
    const live = new Map<string, TestCase>()
    await Promise.all(liveIds.map(async id => {
      const test = await this.tests.findOne(repoPath, id).catch(() => undefined)
      if (test) live.set(id, test)
    }))
    const entries: ExecutionSheetEntry[] = campaign.runs.map(run => ({
      run,
      test: run.testSnapshot ?? live.get(run.testCaseId),
    }))

    const model = buildExecutionSheetModel({ campaign, entries, locale, exportedAt: new Date().toISOString() })
    await writeExecutionWorkbook(model, destPath)
  }
}
