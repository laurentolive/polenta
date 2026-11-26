import ExcelJS from 'exceljs'
import { isAcceptedLinkUrl, type TableExportPayload, type TablesExportPayload } from '@polenta/types'

/** Largeur Excel (caractères) d'une largeur à l'écran (px). */
const pxToChars = (px: number) => Math.max(4, Math.round(px / 7))

/** Excel refuse deux feuilles de même nom (sans distinction de casse), les noms de plus de 31 caractères et `[]:*?/\`. */
const SHEET_FORBIDDEN = /[[\]:*?/\\]/g
const SHEET_MAX = 31

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
  addTableSheet(workbook, payload, payload.sheetName || 'Sheet1')
  return workbook
}

/**
 * GH439 — export xlsx de la page d'une version : une feuille par table, dans l'ordre reçu, chacune mise en
 * forme comme l'export d'une grille. Noms de feuille rendus valides et uniques.
 */
export async function exportTablesXlsx(payload: TablesExportPayload, destPath: string): Promise<void> {
  const workbook = await buildTablesWorkbook(payload)
  await workbook.xlsx.writeFile(destPath)
}

export async function buildTablesWorkbook(payload: TablesExportPayload): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  const used = new Set<string>()
  for (const sheet of payload.sheets) addTableSheet(workbook, sheet, uniqueSheetName(sheet.sheetName, used))
  return workbook
}

function uniqueSheetName(requested: string, used: Set<string>): string {
  const base = (requested.replace(SHEET_FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().slice(0, SHEET_MAX).trim()) || 'Sheet1'
  let name = base
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, SHEET_MAX - String(n).length - 1)} ${n}`
  used.add(name.toLowerCase())
  return name
}

function addTableSheet(workbook: ExcelJS.Workbook, payload: TableExportPayload, name: string): void {
  const sheet = workbook.addWorksheet(name, {
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
}
