import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import ExcelJS from 'exceljs'
import PizZip from 'pizzip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CampaignExportPayload, CampaignTestRun, TestCampaign, TestCase } from '@polenta/types'
import { buildExecutionSheetModel, buildExecutionWorkbook } from './campaign-execution.xlsx'
import { exportCampaignPlanXlsx } from './campaign.xlsx'
import { exportCampaignPlanDocx, exportCampaignReportDocx } from './campaign.docx'

// GH442 — la colonne « Exigence » des exports reprend celle de la grille de la campagne (U7–U9 de
// specs/GH442-tests.md) : exigence de l'instance (test itérant), sinon exigences couvertes par le test.

const test = (id: string): TestCase =>
  ({ id, title: `Titre ${id}`, objectTypeRef: 'root::test', status: 'approved', version: 1, fields: {}, steps: [] }) as unknown as TestCase
const run = (entryId: string, extra: Partial<CampaignTestRun> = {}): CampaignTestRun =>
  ({ entryId, testCaseId: entryId.replace(/-\d+$/, ''), status: 'pending', ...extra }) as CampaignTestRun

// A : non itérant, deux exigences couvertes · B : aucune · C : deux instances d'un test itérant
const runs = [run('TEST-A-1'), run('TEST-B-1'), run('TEST-C-1', { requirementId: 'SYS-0001' }), run('TEST-C-2', { requirementId: 'SYS-0003' })]
const requirements: Record<string, string[]> = {
  'TEST-A-1': ['SYS-0001', 'SYS-0002'], 'TEST-B-1': [], 'TEST-C-1': ['SYS-0001'], 'TEST-C-2': ['SYS-0003'],
}
const campaign = { id: 'CAMP-0001', title: 'Campagne', status: 'in_progress', runs } as unknown as TestCampaign
const entries = (withRequirements: boolean): CampaignExportPayload['entries'] =>
  runs.map(r => ({ run: r, test: test(r.testCaseId), ...(withRequirements && { requirements: requirements[r.entryId] }) }))

let dir: string
beforeEach(async () => { dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh442-')) })
afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

/** Colonne `header` d'une feuille : valeurs sous l'en-tête, texte brut. */
function column(sheet: ExcelJS.Worksheet, header: string): string[] {
  let headerRow = 0
  let col = 0
  sheet.eachRow((row, r) => row.eachCell((cell, c) => { if (!col && String(cell.value) === header) { col = c; headerRow = r } }))
  expect(col).toBeGreaterThan(0)
  const out: string[] = []
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) out.push(String(sheet.getRow(r).getCell(col).value ?? ''))
  return out
}

describe('cahier de campagne xlsx (GH442 U8)', () => {
  it('la colonne Exigence liste les exigences affichées', async () => {
    const file = path.join(dir, 'plan.xlsx')
    await exportCampaignPlanXlsx({ campaign, entries: entries(true) }, file)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    expect(column(wb.worksheets[0]!, 'Exigence')).toEqual(['SYS-0001, SYS-0002', '', 'SYS-0001', 'SYS-0003'])
  })

  it('sans liste fournie (ancien payload) : repli sur l\'exigence de l\'instance', async () => {
    const file = path.join(dir, 'plan.xlsx')
    await exportCampaignPlanXlsx({ campaign, entries: entries(false) }, file)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    expect(column(wb.worksheets[0]!, 'Exigence')).toEqual(['', '', 'SYS-0001', 'SYS-0003'])
  })
})

describe('cahier et rapport docx (GH442 U9)', () => {
  async function headings(write: (p: CampaignExportPayload, f: string) => Promise<void>): Promise<string> {
    const file = path.join(dir, 'doc.docx')
    await write({ campaign, entries: entries(true) }, file)
    return new PizZip(await fsP.readFile(file)).file('word/document.xml')!.asText()
  }

  it.each([
    ['cahier', exportCampaignPlanDocx],
    ['rapport', exportCampaignReportDocx],
  ])('le titre de chaque entrée du %s suit les exigences affichées', async (_name, write) => {
    const xml = await headings(write)
    expect(xml).toContain('TEST-A — Titre TEST-A · SYS-0001, SYS-0002')
    expect(xml).toContain('TEST-C — Titre TEST-C · SYS-0001')
    expect(xml).toContain('TEST-C — Titre TEST-C · SYS-0003')
    // Entrée sans exigence : pas de « · » dans son titre.
    expect(xml).toMatch(/TEST-B — Titre TEST-B(?! ·)/)
  })
})

describe('classeur d\'exécution (GH442 U7)', () => {
  it('la colonne Exigence reprend le texte de la grille ; vide sans exigence', async () => {
    const model = buildExecutionSheetModel({
      campaign, locale: 'fr', exportedAt: '2026-11-26T10:00:00Z',
      entries: runs.map(r => ({ run: r, test: test(r.testCaseId), requirements: requirements[r.entryId] })),
    })
    const wb = await buildExecutionWorkbook(model)
    const cells = column(wb.worksheets[0]!, 'Exigence')
    // Les lignes d'étape n'ont pas de valeur dans cette colonne : on ne garde que les lignes d'instance.
    expect(cells.filter(Boolean)).toEqual(['SYS-0001, SYS-0002', 'SYS-0001', 'SYS-0003'])
  })

  it('sans liste fournie : exigence de l\'instance seule', async () => {
    const model = buildExecutionSheetModel({
      campaign, locale: 'fr', exportedAt: '2026-11-26T10:00:00Z',
      entries: runs.map(r => ({ run: r, test: test(r.testCaseId) })),
    })
    const wb = await buildExecutionWorkbook(model)
    expect(column(wb.worksheets[0]!, 'Exigence').filter(Boolean)).toEqual(['SYS-0001', 'SYS-0003'])
  })
})
