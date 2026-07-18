import ExcelJS from 'exceljs'
import type { ImpactAnalysisExportPayload, ImpactNode } from '@polenta/types'

/** Rapport d'analyse d'impact — export xlsx (T43 sprint 3). Une ligne par exigence modifiée, puis
 *  une ligne par élément impacté (arbres descendant/ascendant aplatis en profondeur, colonne
 *  "Profondeur" pour reconstituer la hiérarchie) — pas de xlsx pour dashboard/rapport de campagne,
 *  mais l'analyse d'impact est structurellement une liste, un aplatissement en lignes est le
 *  format le plus lisible en tableur (cf. specs/T43.md §2 pour le mapping formats). */
export async function exportImpactAnalysisXlsx(
  payload: ImpactAnalysisExportPayload,
  destPath: string,
): Promise<void> {
  const { analysis } = payload
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Analyse d\'impact')

  const titleRow = sheet.addRow([`Analyse d'impact : ${analysis.fromBaseline.tag} → ${analysis.toBaseline.tag}`])
  titleRow.font = { bold: true, size: 13 }
  sheet.addRow([])

  const headerRow = sheet.addRow(['Direction', 'Profondeur', 'ID', 'Titre', 'Type / Lien', 'Statut', 'Commentaire'])
  headerRow.font = { bold: true }
  sheet.getColumn(1).width = 14
  sheet.getColumn(2).width = 10
  sheet.getColumn(3).width = 16
  sheet.getColumn(4).width = 50
  sheet.getColumn(5).width = 20
  sheet.getColumn(6).width = 24
  sheet.getColumn(7).width = 40

  function addNodeRows(node: ImpactNode, direction: string, depth: number): void {
    sheet.addRow([direction, depth, node.elementId, node.title, node.linkType, node.status, node.comment ?? ''])
    for (const child of node.children) addNodeRows(child, direction, depth + 1)
  }

  for (const req of analysis.changedRequirements) {
    sheet.addRow(['Modification', 0, req.reqId, req.title, req.changeType, '', ''])
    for (const node of req.descendantTree) addNodeRows(node, 'Descendant', 1)
    for (const node of req.ascendantTree) addNodeRows(node, 'Ascendant', 1)
  }

  await workbook.xlsx.writeFile(destPath)
}
