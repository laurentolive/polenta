import type { ExportFormat, ExportKind, RequirementsExportPayload, TestsExportPayload, CampaignExportPayload, QueryResultExportPayload, ImpactAnalysisExportPayload, DashboardExportPayload } from '@polenta/types'
import { renderKindToPdf } from './pdf.util'
import type { TemplateExportService } from './export/template/template-export.service'

type Generator = (payload: unknown, destPath: string) => Promise<void>

// Table kind:format -> générateur, plutôt qu'une chaîne de `if (kind === ...)` — évite qu'elle ne
// devienne une suite de blocs quasi identiques au fil des sprints (T43-design.md, refactorée en
// sprint 2 quand elle a franchi le seuil "proportionné"). `payload` reste `unknown` à ce niveau,
// chaque générateur applique lui-même son cast vers son type de payload spécifique, comme avant.
//
// Chaque générateur est chargé via `import()` dynamique plutôt qu'un `import` statique en haut de
// fichier (T141) : `requirements.xlsx.ts`/`*.docx.ts` importent `exceljs`/`docx`, deux libs lourdes
// (~380ms et ~30ms à charger) qui n'ont aucune raison d'être payées à CHAQUE démarrage de l'app —
// `ExportService` est construit dans `container.ts` dès le boot, avant qu'aucun export n'ait été
// demandé. Le coût est désormais différé au premier export réellement déclenché.
const GENERATORS: Partial<Record<`${ExportKind}:${'xlsx' | 'docx'}`, Generator>> = {
  'requirements:xlsx': async (p, d) =>
    (await import('./export/requirements.xlsx')).exportRequirementsXlsx(p as RequirementsExportPayload, d),
  'requirements:docx': async (p, d) =>
    (await import('./export/requirements.docx')).exportRequirementsDocx(p as RequirementsExportPayload, d),
  'tests:xlsx': async (p, d) => (await import('./export/tests.xlsx')).exportTestsXlsx(p as TestsExportPayload, d),
  'tests:docx': async (p, d) => (await import('./export/tests.docx')).exportTestsDocx(p as TestsExportPayload, d),
  'campaign-plan:xlsx': async (p, d) =>
    (await import('./export/campaign.xlsx')).exportCampaignPlanXlsx(p as CampaignExportPayload, d),
  'campaign-plan:docx': async (p, d) =>
    (await import('./export/campaign.docx')).exportCampaignPlanDocx(p as CampaignExportPayload, d),
  'campaign-report:docx': async (p, d) =>
    (await import('./export/campaign.docx')).exportCampaignReportDocx(p as CampaignExportPayload, d),
  'query-result:xlsx': async (p, d) =>
    (await import('./export/query-result.xlsx')).exportQueryResultXlsx(p as QueryResultExportPayload, d),
  'impact-analysis:xlsx': async (p, d) =>
    (await import('./export/impact-analysis.xlsx')).exportImpactAnalysisXlsx(p as ImpactAnalysisExportPayload, d),
  'dashboard:docx': async (p, d) =>
    (await import('./export/dashboard.docx')).exportDashboardDocx(p as DashboardExportPayload, d),
}

/**
 * Point d'entrée unique pour tous les exports (T43) — un seul canal IPC (`export:save`) au lieu
 * d'un handler ad hoc par type de contenu, cf. specs/T43-design.md. xlsx/docx sont construits à
 * partir du `payload` envoyé par le renderer (déjà chargé/filtré côté vue) ; pdf ignore `payload`
 * et rend la route imprimable correspondante à partir de `printParams`.
 */
export class ExportService {
  constructor(private readonly templates: TemplateExportService) {}

  /**
   * `options.templateRelPath` (GH34) : gabarit client choisi dans la bibliothèque — remplace le
   * rendu Standard pour xlsx/docx. `repoPath` est réintroduit pour ce cas (données communes du
   * gabarit : branche, commit, tag, projet), seul générateur qui en a besoin.
   */
  async run(
    kind: ExportKind,
    format: ExportFormat,
    payload: unknown,
    printParams: Record<string, string> | undefined,
    destPath: string,
    options: { repoPath?: string; templateRelPath?: string } = {},
  ): Promise<void> {
    if (format === 'pdf') {
      await renderKindToPdf(kind, printParams ?? {}, destPath)
      return
    }

    if (options.templateRelPath) {
      if (!options.repoPath) throw new Error('Export à partir d’un gabarit : dépôt du projet inconnu.')
      await this.templates.run(kind, format, payload, options.repoPath, options.templateRelPath, destPath)
      return
    }

    const generator = GENERATORS[`${kind}:${format}`]
    if (!generator) throw new Error(`Export "${format}" non implémenté pour "${kind}"`)
    await generator(payload, destPath)
  }
}
