import ExcelJS from 'exceljs'
import type { TestsExportPayload } from '@polenta/types'

/** Cahier de test — export xlsx, miroir de `requirements.xlsx.ts` : colonnes génériques résolues
 *  côté renderer (`payload.columns`/`payload.rows`), reflètent `visibleFieldsExcel`. */
export async function exportTestsXlsx(
  payload: TestsExportPayload,
  destPath: string,
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Tests')

  sheet.columns = payload.columns.map(c => ({
    header: c.label,
    key: c.key,
    width: c.key === 'section' ? 10 : c.key === 'id' ? 16 : 40,
  }))
  sheet.getRow(1).font = { bold: true }

  for (const row of payload.rows) sheet.addRow(row)

  await workbook.xlsx.writeFile(destPath)
}
