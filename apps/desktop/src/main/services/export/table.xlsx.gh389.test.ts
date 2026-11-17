import { describe, expect, it } from 'vitest'
import { buildTableWorkbook } from './table.xlsx'

// GH389 U6 — classeur d'une grille : en-tête, valeurs, volets figés, hyperlien.
describe('GH389 U6 — table.xlsx', () => {
  it('écrit ce qui est affiché', async () => {
    const wb = await buildTableWorkbook({
      sheetName: 'Validation 2.0',
      columns: [{ key: 'id', label: 'ID', width: 84 }, { key: 'decision', label: 'Décision' }, { key: 'url', label: 'Lien' }],
      rows: [
        { id: 'SYS-001', decision: 'Conforme', url: 'doc' },
        { id: 'SYS-003', decision: 'Non conforme', url: '' },
      ],
      hyperlinks: { 0: { url: 'https://ex.com/doc' } },
      freezeColCount: 1,
    })
    // Aller-retour par le format xlsx : ce qu'Excel relira.
    const buffer = await wb.xlsx.writeBuffer()
    const ExcelJS = (await import('exceljs')).default
    const read = new ExcelJS.Workbook()
    await read.xlsx.load(buffer as ArrayBuffer)
    const sheet = read.getWorksheet('Validation 2.0')!
    expect(sheet.getRow(1).values).toEqual([undefined, 'ID', 'Décision', 'Lien'])
    expect(sheet.getRow(1).font?.bold).toBe(true)
    expect(sheet.getRow(2).getCell(1).value).toBe('SYS-001')
    expect(sheet.getRow(3).getCell(2).value).toBe('Non conforme')
    expect(sheet.rowCount).toBe(3)
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 1 })
    expect(sheet.getColumn(1).width).toBe(12)
    const link = sheet.getRow(2).getCell(3).value as { text: string; hyperlink: string }
    expect(link).toMatchObject({ text: 'doc', hyperlink: 'https://ex.com/doc' })
  })
})
