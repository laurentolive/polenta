import type { ExecutionImportPreview, ExecutionImportResult, ExecutionSheetLocale, ObjectTypeDefinition, TestCampaign, TestCase, TestRun } from '@polenta/types'
import type { AuthService } from './auth.service'
import type { CampaignsService } from './campaigns.service'
import type { TestsService } from './tests.service'
import { buildExecutionSheetModel, writeExecutionWorkbook, type ExecutionSheetEntry } from './export/campaign-execution.xlsx'
import { readExecutionWorkbook, validateExecutionImport } from './export/campaign-execution-import'
import { testFingerprint } from './campaign-snapshot.util'

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
    // GH81 — version effective de chaque instance, sans rien écrire : état live du test pour une
    // instance resynchronisable (GH68), copie figée sinon, état live pour une entrée pré-T49 ; test
    // introuvable → instance sans étape. Son empreinte est contrôlée à l'import, qui la fige.
    const effective = await this.campaigns.effectiveTests(repoPath, campaign)
    // GH196 — colonnes des champs d'exécution / d'étape : type de chaque test.
    const typeDefs = await this.typeDefsOf(repoPath, campaign, effective)
    // GH196 — instance déjà exécutée : son résultat (run de l'entrée) est recopié dans le classeur.
    const runsByTest = new Map<string, Promise<TestRun[]>>()
    const runOf = async (testCaseId: string, runId: string) => {
      if (!runsByTest.has(testCaseId)) runsByTest.set(testCaseId, this.tests.findRuns(repoPath, testCaseId).catch(() => []))
      return (await runsByTest.get(testCaseId)!).find(r => r.id === runId)
    }
    const entries: ExecutionSheetEntry[] = await Promise.all(campaign.runs.map(async run => {
      const test = effective.get(run.entryId)?.test
      const prefill = run.status !== 'pending' && run.runId ? await runOf(run.testCaseId, run.runId) : undefined
      return { run, test, typeDef: typeDefs.get(run.entryId), ...(prefill && { prefill }), ...(test && { fingerprint: testFingerprint(test) }) }
    }))

    const model = buildExecutionSheetModel({ campaign, entries, locale, exportedAt: new Date().toISOString() })
    await writeExecutionWorkbook(model, destPath)
  }

  /** Lit et valide un classeur rempli contre l'état courant de la campagne, sans rien écrire. */
  async preview(repoPath: string, campaignId: string, filePath: string): Promise<ExecutionImportPreview> {
    return (await this.validate(repoPath, campaignId, filePath)).preview
  }

  private async validate(repoPath: string, campaignId: string, filePath: string) {
    const [campaign, raw, author, isApproved] = await Promise.all([
      this.campaigns.get(repoPath, campaignId),
      readExecutionWorkbook(filePath),
      this.auth.getAuthor(repoPath).catch(() => undefined),
      this.campaigns.approvalPredicate(repoPath),
    ])
    const effectiveTests = await this.campaigns.effectiveTests(repoPath, campaign, isApproved)
    const typeDefs = await this.typeDefsOf(repoPath, campaign, effectiveTests)
    const preview = validateExecutionImport(raw, {
      typeDefs,
      campaign,
      fallbackUser: author?.name || 'unknown',
      now: new Date().toISOString(),
      filePath,
      isApproved,
      effectiveTests,
      fingerprint: testFingerprint,
    })
    // GH81 — classeur v2 : la version exportée (= version effective, empreinte vérifiée) est figée
    // à l'import ; classeur v1 (sans empreinte) : copie actuelle conservée, comme avant.
    const fingerprinted = new Set('fatal' in raw ? [] : raw.instances.filter(i => i.fingerprint).map(i => i.entryId))
    return { preview, effectiveTests, fingerprinted }
  }

  /**
   * Relit et revalide le fichier (la campagne a pu changer depuis l'aperçu), puis écrit chaque
   * instance remplie comme une exécution dans l'outil : `TestRun` (origine `excel-import`) puis
   * statut de l'instance. Séquentiel ; une erreur arrête l'import, les instances déjà écrites
   * le restent (spec §4.4).
   */
  async apply(repoPath: string, campaignId: string, filePath: string, workspaceDir?: string): Promise<ExecutionImportResult> {
    const { preview, effectiveTests, fingerprinted } = await this.validate(repoPath, campaignId, filePath)
    const imported: string[] = []
    if (preview.fatal) return { imported, preview }

    for (const inst of preview.importable) {
      try {
        const run = await this.tests.execute(repoPath, inst.testCaseId, {
          stepResults: inst.stepResults,
          ...(inst.fields && { fields: inst.fields }),
          notes: inst.notes,
          result: inst.result,
          ...(inst.requirementId && { requirementId: inst.requirementId }),
          executedBy: inst.executedBy,
          executedAt: inst.executedAt,
          origin: 'excel-import',
          campaignEntry: { campaignId, entryId: inst.entryId },
        }, workspaceDir)
        const effective = effectiveTests.get(inst.entryId)
        const exported = fingerprinted.has(inst.entryId) && effective?.resyncable ? effective.test : undefined
        await this.campaigns.updateRun(repoPath, campaignId, inst.entryId, inst.result, run.id, {
          executedAt: inst.executedAt,
          executedBy: inst.executedBy,
          ...(exported && { testSnapshot: exported }),
        })
        imported.push(inst.entryId)
      } catch (err) {
        return { imported, preview, failure: { entryId: inst.entryId, message: err instanceof Error ? err.message : String(err) } }
      }
    }
    return { imported, preview }
  }

  /** GH196 — type du test de chaque entrée (un appel par type distinct). */
  private async typeDefsOf(
    repoPath: string, campaign: TestCampaign, effective: Map<string, { test: TestCase }>,
  ): Promise<Map<string, ObjectTypeDefinition | null>> {
    const byRef = new Map<string, Promise<ObjectTypeDefinition | null>>()
    const out = new Map<string, ObjectTypeDefinition | null>()
    for (const run of campaign.runs) {
      const ref = effective.get(run.entryId)?.test.objectTypeRef
      if (!ref) continue
      if (!byRef.has(ref)) byRef.set(ref, this.tests.typeDefFor(repoPath, ref).catch(() => null))
      out.set(run.entryId, await byRef.get(ref)!)
    }
    return out
  }
}
