import ExcelJS from 'exceljs'
import { parseLinksText } from '@polenta/types'
import type { TestsExportPayload } from '@polenta/types'
import { writeLinkCell } from './link-cell.util'

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

  // GH195 — champs `link` (forme texte `libellé | URL` dans `rows`) : hyperliens natifs.
  const linkKeys = payload.columns.filter(c => c.type === 'link').map(c => c.key)
  for (const row of payload.rows) {
    const added = sheet.addRow(row)
    for (const key of linkKeys) writeLinkCell(added.getCell(key), parseLinksText(row[key] ?? ''))
  }

  await workbook.xlsx.writeFile(destPath)
}
