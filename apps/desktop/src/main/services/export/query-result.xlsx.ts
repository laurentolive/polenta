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
  // GH74 — `_ids` (identifiants des objets d'origine) exporté en dernière colonne, joint par « , ».
  const withIds = payload.result.rows.some(r => Array.isArray(r._ids))
  sheet.columns = [
    ...payload.result.columns.map(c => ({ header: c.name, key: c.name })),
    ...(withIds ? [{ header: '_ids', key: '_ids' }] : []),
  ]
  for (const row of payload.result.rows) {
    sheet.addRow(Array.isArray(row._ids) ? { ...row, _ids: (row._ids as unknown[]).join(', ') } : row)
  }
  await workbook.xlsx.writeFile(destPath)
}
