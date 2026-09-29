import ExcelJS from 'exceljs'
import type { CampaignExportPayload } from '@polenta/types'

/** Cahier de campagne — export xlsx (T43 sprint 2). Pas d'équivalent xlsx pour le rapport de
 *  campagne (docx/pdf uniquement, cf. specs/T43.md §2 — mapping formats validé avec l'utilisateur). */
export async function exportCampaignPlanXlsx(
  payload: CampaignExportPayload,
  destPath: string,
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Cahier de campagne')

  const titleRow = sheet.addRow([`Campagne : ${payload.campaign.title} (${payload.campaign.id})`])
  titleRow.font = { bold: true, size: 13 }
  sheet.addRow([])

  // T179 — une ligne par instance ; « Exigence » : exigence pour laquelle l'instance a été générée.
  const headerRow = sheet.addRow(['ID', 'Titre', 'Exigence', 'Type', 'Statut'])
  headerRow.font = { bold: true }
  sheet.getColumn(1).width = 16
  sheet.getColumn(2).width = 50
  sheet.getColumn(3).width = 16
  sheet.getColumn(4).width = 24
  sheet.getColumn(5).width = 14

  for (const { run, test: t } of payload.entries) {
    sheet.addRow([t.id, t.title, run.requirementId ?? '', t.objectTypeRef, t.status])
  }

  await workbook.xlsx.writeFile(destPath)
}
