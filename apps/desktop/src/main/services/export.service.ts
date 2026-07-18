import type { ExportFormat, ExportKind, RequirementsExportPayload, TestsExportPayload, CampaignExportPayload, QueryResultExportPayload, ImpactAnalysisExportPayload, DashboardExportPayload } from '@polenta/types'
import { exportRequirementsXlsx } from './export/requirements.xlsx'
import { exportRequirementsDocx } from './export/requirements.docx'
import { exportTestsXlsx } from './export/tests.xlsx'
import { exportTestsDocx } from './export/tests.docx'
import { exportCampaignPlanXlsx } from './export/campaign.xlsx'
import { exportCampaignPlanDocx, exportCampaignReportDocx } from './export/campaign.docx'
import { exportQueryResultXlsx } from './export/query-result.xlsx'
import { exportImpactAnalysisXlsx } from './export/impact-analysis.xlsx'
import { exportDashboardDocx } from './export/dashboard.docx'
import { renderKindToPdf } from './pdf.util'

type Generator = (payload: unknown, destPath: string) => Promise<void>

// Table kind:format -> générateur, plutôt qu'une chaîne de `if (kind === ...)` — évite qu'elle ne
// devienne une suite de blocs quasi identiques au fil des sprints (T43-design.md, refactorée en
// sprint 2 quand elle a franchi le seuil "proportionné"). `payload` reste `unknown` à ce niveau,
// chaque générateur applique lui-même son cast vers son type de payload spécifique, comme avant.
const GENERATORS: Partial<Record<`${ExportKind}:${'xlsx' | 'docx'}`, Generator>> = {
  'requirements:xlsx': (p, d) => exportRequirementsXlsx(p as RequirementsExportPayload, d),
  'requirements:docx': (p, d) => exportRequirementsDocx(p as RequirementsExportPayload, d),
  'tests:xlsx': (p, d) => exportTestsXlsx(p as TestsExportPayload, d),
  'tests:docx': (p, d) => exportTestsDocx(p as TestsExportPayload, d),
  'campaign-plan:xlsx': (p, d) => exportCampaignPlanXlsx(p as CampaignExportPayload, d),
  'campaign-plan:docx': (p, d) => exportCampaignPlanDocx(p as CampaignExportPayload, d),
  'campaign-report:docx': (p, d) => exportCampaignReportDocx(p as CampaignExportPayload, d),
  'query-result:xlsx': (p, d) => exportQueryResultXlsx(p as QueryResultExportPayload, d),
  'impact-analysis:xlsx': (p, d) => exportImpactAnalysisXlsx(p as ImpactAnalysisExportPayload, d),
  'dashboard:docx': (p, d) => exportDashboardDocx(p as DashboardExportPayload, d),
}

/**
 * Point d'entrée unique pour tous les exports (T43) — un seul canal IPC (`export:save`) au lieu
 * d'un handler ad hoc par type de contenu, cf. specs/T43-design.md. xlsx/docx sont construits à
 * partir du `payload` envoyé par le renderer (déjà chargé/filtré côté vue) ; pdf ignore `payload`
 * et rend la route imprimable correspondante à partir de `printParams`.
 */
export class ExportService {
  // `repoPath` volontairement absent de cette signature (divergence assumée vs le brouillon de
  // specs/T43-design.md) : aucun générateur sprint 1/2 n'en a besoin (xlsx/docx travaillent
  // uniquement à partir de `payload`, pdf reçoit son propre repoPath via `printParams`) — à
  // réintroduire ici si un générateur d'un sprint suivant en a réellement besoin, plutôt qu'un
  // paramètre mort dès aujourd'hui.
  async run(
    kind: ExportKind,
    format: ExportFormat,
    payload: unknown,
    printParams: Record<string, string> | undefined,
    destPath: string,
  ): Promise<void> {
    if (format === 'pdf') {
      await renderKindToPdf(kind, printParams ?? {}, destPath)
      return
    }

    const generator = GENERATORS[`${kind}:${format}`]
    if (!generator) throw new Error(`Export "${format}" non implémenté pour "${kind}"`)
    await generator(payload, destPath)
  }
}
