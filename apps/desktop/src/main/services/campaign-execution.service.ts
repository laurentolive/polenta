import type { ExecutionImportPreview, ExecutionImportResult, ExecutionSheetLocale, TestCase } from '@polenta/types'
import type { AuthService } from './auth.service'
import type { CampaignsService } from './campaigns.service'
import type { TestsService } from './tests.service'
import { buildExecutionSheetModel, writeExecutionWorkbook, type ExecutionSheetEntry } from './export/campaign-execution.xlsx'
import { readExecutionWorkbook, validateExecutionImport } from './export/campaign-execution-import'

/**
 * GH36 — exécution d'une campagne hors outil : export d'un classeur Excel à remplir par les
 * testeurs, puis réimport des résultats. Cf. specs/GH36-design.md §3.5.
 */
export class CampaignExecutionService {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly tests: TestsService,
    /** Testeur de repli à l'import (colonne Testeur vide) : identité git de l'utilisateur. */
    private readonly auth: Pick<AuthService, 'getAuthor'>,
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

  /** Lit et valide un classeur rempli contre l'état courant de la campagne, sans rien écrire. */
  async preview(repoPath: string, campaignId: string, filePath: string): Promise<ExecutionImportPreview> {
    const [campaign, raw, author] = await Promise.all([
      this.campaigns.get(repoPath, campaignId),
      readExecutionWorkbook(filePath),
      this.auth.getAuthor(repoPath).catch(() => undefined),
    ])
    return validateExecutionImport(raw, {
      campaign,
      fallbackUser: author?.name || 'unknown',
      now: new Date().toISOString(),
      filePath,
    })
  }

  /**
   * Relit et revalide le fichier (la campagne a pu changer depuis l'aperçu), puis écrit chaque
   * instance remplie comme une exécution dans l'outil : `TestRun` (origine `excel-import`) puis
   * statut de l'instance. Séquentiel ; une erreur arrête l'import, les instances déjà écrites
   * le restent (spec §4.4).
   */
  async apply(repoPath: string, campaignId: string, filePath: string, workspaceDir?: string): Promise<ExecutionImportResult> {
    const preview = await this.preview(repoPath, campaignId, filePath)
    const imported: string[] = []
    if (preview.fatal) return { imported, preview }

    for (const inst of preview.importable) {
      try {
        const run = await this.tests.execute(repoPath, inst.testCaseId, {
          stepResults: inst.stepResults,
          notes: inst.notes,
          result: inst.result,
          ...(inst.requirementId && { requirementId: inst.requirementId }),
          executedBy: inst.executedBy,
          executedAt: inst.executedAt,
          origin: 'excel-import',
        }, workspaceDir)
        await this.campaigns.updateRun(repoPath, campaignId, inst.entryId, inst.result, run.id, {
          executedAt: inst.executedAt,
          executedBy: inst.executedBy,
        })
        imported.push(inst.entryId)
      } catch (err) {
        return { imported, preview, failure: { entryId: inst.entryId, message: err instanceof Error ? err.message : String(err) } }
      }
    }
    return { imported, preview }
  }
}
