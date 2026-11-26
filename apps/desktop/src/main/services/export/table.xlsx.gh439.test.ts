import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TableExportPayload } from '@polenta/types'
import { buildTablesWorkbook, exportTablesXlsx } from './table.xlsx'

// GH439 sprint 3 — export xlsx de la page d'une version : un classeur, une feuille par section.

const sheet = (sheetName: string, rows: Array<Record<string, string>>, extra: Partial<TableExportPayload> = {}): TableExportPayload => ({
  sheetName, columns: [{ key: 'id', label: 'ID', width: 140 }, { key: 'title', label: 'Titre' }], rows, ...extra,
})

let dir: string
beforeEach(async () => { dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh439-xlsx-')) })
afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

describe('exportTablesXlsx', () => {
  it('X4 — une feuille par table, dans l\'ordre reçu, en-tête gras, largeurs et lignes reprises', async () => {
    const dest = path.join(dir, 'version.xlsx')
    await exportTablesXlsx({ sheets: [sheet('Informations', [{ id: 'Label', title: '1.0' }]), sheet('Exigences', [{ id: 'PR-0001', title: 'Démarrage' }, { id: 'PR-0002', title: 'Arrêt' }])] }, dest)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(dest)
    expect(wb.worksheets.map(w => w.name)).toEqual(['Informations', 'Exigences'])
    const req = wb.getWorksheet('Exigences')!
    expect(req.getRow(1).values).toEqual([undefined, 'ID', 'Titre'])
    expect(req.getRow(1).font?.bold).toBe(true)
    expect(req.getRow(3).getCell(2).value).toBe('Arrêt')
    expect(req.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
  })

  it('noms de feuille : 31 caractères au plus, caractères interdits remplacés, doublons suffixés (sans distinction de casse)', async () => {
    const wb = await buildTablesWorkbook({
      sheets: [
        sheet('Informations', []), sheet('INFORMATIONS', []), sheet('Un titre de section bien trop long pour Excel', []), sheet('Tests / Analyse [2]', []), sheet('', []),
      ],
    })
    const names = wb.worksheets.map(w => w.name)
    expect(names).toEqual(['Informations', 'INFORMATIONS 2', 'Un titre de section bien trop l', 'Tests Analyse 2', 'Sheet1'])
    expect(names.every(n => n.length <= 31)).toBe(true)
  })

  it('section vide : feuille avec son en-tête et aucune ligne', async () => {
    const wb = await buildTablesWorkbook({ sheets: [sheet('Exigences', [])] })
    const ws = wb.getWorksheet('Exigences')!
    expect(ws.rowCount).toBe(1)
    expect(ws.getRow(1).values).toEqual([undefined, 'ID', 'Titre'])
  })
})
