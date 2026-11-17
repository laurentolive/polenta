import ExcelJS from 'exceljs'
import { isAcceptedLinkUrl, type TableExportPayload } from '@polenta/types'

/** Largeur Excel (caractères) d'une largeur à l'écran (px). */
const pxToChars = (px: number) => Math.max(4, Math.round(px / 7))

/**
 * GH389 — export xlsx d'une grille (`DataGrid`, spec §1.10) : ce qui est affiché, déjà résolu par le
 * renderer. En-tête gras, volets figés (en-tête + colonnes figées), largeurs proches de l'écran, URL
 * des valeurs `link` en liens hypertexte.
 */
export async function exportTableXlsx(payload: TableExportPayload, destPath: string): Promise<void> {
  const workbook = await buildTableWorkbook(payload)
  await workbook.xlsx.writeFile(destPath)
}

export async function buildTableWorkbook(payload: TableExportPayload): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(payload.sheetName || 'Sheet1', {
    views: [{ state: 'frozen', xSplit: payload.freezeColCount ?? 0, ySplit: 1 }],
  })
  sheet.columns = payload.columns.map(c => ({
    header: c.label,
    key: c.key,
    ...(c.width ? { width: pxToChars(c.width) } : {}),
  }))
  sheet.getRow(1).font = { bold: true }
  payload.rows.forEach((values, i) => {
    const row = sheet.addRow(values)
    const links = payload.hyperlinks?.[String(i)]
    if (!links) return
    for (const [key, url] of Object.entries(links)) {
      // Seuls les liens acceptés par un champ `link` (GH195) deviennent cliquables.
      if (!isAcceptedLinkUrl(url)) continue
      const cell = row.getCell(key)
      cell.value = { text: values[key] || url, hyperlink: url }
      cell.font = { color: { argb: 'FF0563C1' }, underline: true }
    }
  })
  return workbook
}
