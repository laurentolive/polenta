import ExcelJS from 'exceljs'
import type { QueryResultExportPayload } from '@polenta/types'

/** Résultats de requête — export xlsx (T43 sprint 3). Reprend telle quelle la logique de
 *  l'ancien `QueryEngineService.exportExcel` (canal ad hoc `queries:export-excel`, retiré ce
 *  sprint au profit du mécanisme générique `export:save`, cf. specs/T43-sprint3.md). */
export async function exportQueryResultXlsx(
  payload: QueryResultExportPayload,
  destPath: string,
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Résultat')
  sheet.columns = payload.result.columns.map(c => ({ header: c.name, key: c.name }))
  for (const row of payload.result.rows) sheet.addRow(row)
  await workbook.xlsx.writeFile(destPath)
}
