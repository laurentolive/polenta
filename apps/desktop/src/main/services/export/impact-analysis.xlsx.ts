import ExcelJS from 'exceljs'
import type { ImpactAnalysisExportPayload, ImpactNode } from '@polenta/types'

/** Analyse d'impact d'un change — export xlsx (GH199, ex-analyse entre baselines T43 sprint 3).
 *  Feuille 1 : une ligne par racine, puis ses arbres descendant / ascendant aplatis en profondeur
 *  (colonne « Profondeur » pour reconstituer la hiérarchie). Feuille 2 : éléments impactés. */
export async function exportImpactAnalysisXlsx(
  payload: ImpactAnalysisExportPayload,
  destPath: string,
): Promise<void> {
  const { change, analysis } = payload
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Analyse d\'impact')

  const bounds = change.range ? ` (${change.range.from.ref} → ${change.range.to.ref})` : ''
  const titleRow = sheet.addRow([`Analyse d'impact : ${change.id} — ${change.title}${bounds}`])
  titleRow.font = { bold: true, size: 13 }
  sheet.addRow([analysis.frozen ? `Figée le ${analysis.computedAt}` : `Calculée le ${analysis.computedAt}`])
  sheet.addRow([])

  const headerRow = sheet.addRow(['Direction', 'Profondeur', 'ID', 'Titre', 'Type / Lien', 'Statut', 'Commentaire'])
  headerRow.font = { bold: true }
  for (const [i, w] of [14, 10, 16, 50, 20, 24, 40].entries()) sheet.getColumn(i + 1).width = w

  function addNodeRows(node: ImpactNode, direction: string, depth: number): void {
    sheet.addRow([direction, depth, node.elementId, node.title, node.linkType, node.status, node.comment ?? ''])
    for (const child of node.children) addNodeRows(child, direction, depth + 1)
  }
  for (const r of analysis.roots) {
    sheet.addRow(['Racine', 0, r.elementId, r.title, r.elementType, '', ''])
    for (const node of r.descendantTree) addNodeRows(node, 'Descendant', 1)
    for (const node of r.ascendantTree) addNodeRows(node, 'Ascendant', 1)
  }

  const rowsSheet = workbook.addWorksheet('Éléments impactés')
  const rowsHeader = rowsSheet.addRow(['ID', 'Type', 'Titre', 'Source', 'Atteint', 'Statut', 'Commentaire'])
  rowsHeader.font = { bold: true }
  for (const [i, w] of [16, 14, 50, 12, 10, 24, 40].entries()) rowsSheet.getColumn(i + 1).width = w
  for (const row of analysis.rows) {
    rowsSheet.addRow([row.id, row.elementType ?? '', row.title ?? '', row.source, row.reached ? 'oui' : 'non', row.status, row.comment ?? ''])
  }

  await workbook.xlsx.writeFile(destPath)
}
