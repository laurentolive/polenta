import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CampaignTestRun, ObjectTypeDefinition, TestCampaign, TestCase } from '@polenta/types'
import { EXECUTION_SHEET_HEADER_ROW, EXECUTION_SHEET_META_NAME } from '@polenta/types'
import { buildExecutionSheetModel, buildExecutionWorkbook } from './campaign-execution.xlsx'
import { readExecutionWorkbook, validateExecutionImport } from './campaign-execution-import'

// GH196 — classeur d'exécution v3 : colonnes des champs d'exécution / d'étape (specs/GH196-tests.md 10–12, 16).

const TN: ObjectTypeDefinition = {
  name: 'tn', category: 'test', fields: [],
  runFields: [
    { name: 'reportNumber', label: 'N° de rapport', type: 'text', requiredWhen: { result: ['FAIL'] } },
    { name: 'ambientTemp', label: 'Température', type: 'number' },
    { name: 'report', label: 'Rapport', type: 'link' },
  ],
  stepFields: [{ name: 'measured', label: 'Mesure', type: 'number' }],
}
const TB: ObjectTypeDefinition = { name: 'tb', category: 'test', fields: [], runFields: [{ name: 'bench', label: 'Banc', type: 'enum', values: ['B1', 'B2'] }] }

const test = (id: string, ref: string): TestCase => ({
  id, title: id, objectTypeRef: ref, status: 'approved', version: 1, fields: {},
  steps: [{ order: 1, action: 'A', expectedResult: 'E', notes: '' }],
} as unknown as TestCase)
const run = (entryId: string, testCaseId: string): CampaignTestRun => ({ entryId, testCaseId, status: 'pending' } as CampaignTestRun)

const campaign = {
  id: 'CAMP-0001', title: 'C', status: 'in_progress', runs: [run('TN-1-1', 'TN-1'), run('TB-1-1', 'TB-1')],
} as unknown as TestCampaign
const typeDefs = new Map<string, ObjectTypeDefinition | null>([['TN-1-1', TN], ['TB-1-1', TB]])

let dir: string
beforeEach(async () => { dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh196x-')) })
afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

async function exportFile(): Promise<string> {
  const model = buildExecutionSheetModel({
    campaign, locale: 'fr', exportedAt: '2026-10-29T10:00:00Z',
    entries: [
      { run: campaign.runs[0], test: test('TN-1', 'root::tn'), typeDef: TN },
      { run: campaign.runs[1], test: test('TB-1', 'root::tb'), typeDef: TB },
    ],
  })
  const wb = await buildExecutionWorkbook(model)
  const file = path.join(dir, 'x.xlsx')
  await wb.xlsx.writeFile(file)
  return file
}

/** En-têtes de la feuille de saisie et index (1-based) d'une colonne par son en-tête. */
function headers(sheet: ExcelJS.Worksheet): string[] {
  const row = sheet.getRow(EXECUTION_SHEET_HEADER_ROW)
  return Array.from({ length: row.cellCount }, (_, i) => String(row.getCell(i + 1).value ?? ''))
}

async function fill(file: string, edit: (sheet: ExcelJS.Worksheet, col: (h: string) => number, rowOf: (key: string) => number) => void) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const sheet = wb.worksheets.find(ws => ws.name !== EXECUTION_SHEET_META_NAME)!
  const hs = headers(sheet)
  const col = (h: string) => hs.findIndex(x => x.startsWith(h)) + 1
  const rowOf = (key: string) => {
    for (let r = EXECUTION_SHEET_HEADER_ROW + 1; r <= sheet.rowCount; r++) if (sheet.getRow(r).getCell(1).value === key) return r
    throw new Error(key)
  }
  edit(sheet, col, rowOf)
  await wb.xlsx.writeFile(file)
}

const ctx = (filePath: string) => ({ campaign, fallbackUser: 'imp', now: '2026-10-29T12:00:00Z', filePath, typeDefs })

describe('classeur v3', () => {
  it('colonnes de champs après Commentaire, union des types, cellules sans objet verrouillées, carte dans _polenta', async () => {
    const file = await exportFile()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    const sheet = wb.worksheets.find(ws => ws.name !== EXECUTION_SHEET_META_NAME)!
    const hs = headers(sheet)
    const c = hs.indexOf('Commentaire')
    expect(hs.slice(c + 1, c + 6)).toEqual(['N° de rapport', 'Température', 'Rapport', 'Banc', 'Mesure'])
    expect(hs.slice(c + 6)).toEqual(['Exigence', 'Paramètres', 'Statut actuel'])
    // Ligne d'instance TB : « N° de rapport » sans objet (verrouillée), « Banc » saisissable avec liste.
    const tbRow = sheet.getRow(EXECUTION_SHEET_HEADER_ROW + 3)
    expect(tbRow.getCell(1).value).toBe('TB-1-1')
    expect(tbRow.getCell(c + 2).protection?.locked).not.toBe(false)
    expect(tbRow.getCell(c + 5).protection?.locked).toBe(false)
    expect(tbRow.getCell(c + 5).dataValidation?.formulae).toEqual(['"B1,B2"'])
    const meta = wb.getWorksheet(EXECUTION_SHEET_META_NAME)!
    let columns: unknown[] = []
    meta.eachRow(r => { if (r.getCell(1).value === 'columns') columns = (r.values as unknown[]).slice(2) })
    expect(columns).toContain('run:reportNumber')
    expect(columns).toContain('step:measured')
  })

  it('aller-retour : valeurs typées, lien hypertexte reconnu', async () => {
    const file = await exportFile()
    await fill(file, (sheet, col, rowOf) => {
      const head = sheet.getRow(rowOf('TN-1-1'))
      head.getCell(col('Verdict')).value = 'Échoué'
      head.getCell(col('N° de rapport')).value = 'RE-118'
      head.getCell(col('Température')).value = '23,5'
      head.getCell(col('Rapport')).value = { text: 'RE-118', hyperlink: 'https://ged/118' }
      const step = sheet.getRow(rowOf('TN-1-1#1'))
      step.getCell(col('Verdict')).value = 'Échoué'
      step.getCell(col('Mesure')).value = 13.1
      sheet.getRow(rowOf('TB-1-1')).getCell(col('Verdict')).value = 'Passé'
      sheet.getRow(rowOf('TB-1-1')).getCell(col('Banc')).value = 'B2'
    })
    const preview = validateExecutionImport(await readExecutionWorkbook(file), ctx(file))
    expect(preview.errors).toEqual([])
    const tn = preview.importable.find(i => i.entryId === 'TN-1-1')!
    expect(tn.fields).toEqual({ reportNumber: 'RE-118', ambientTemp: 23.5, report: { label: 'RE-118', url: 'https://ged/118' } })
    expect(tn.stepResults[0].fields).toEqual({ measured: 13.1 })
    expect(preview.importable.find(i => i.entryId === 'TB-1-1')!.fields).toEqual({ bench: 'B2' })
  })

  it('erreurs par instance : champ requis manquant, valeur illisible ; les autres importées', async () => {
    const file = await exportFile()
    await fill(file, (sheet, col, rowOf) => {
      sheet.getRow(rowOf('TN-1-1')).getCell(col('Verdict')).value = 'Échoué'
      sheet.getRow(rowOf('TB-1-1')).getCell(col('Verdict')).value = 'Passé'
    })
    let preview = validateExecutionImport(await readExecutionWorkbook(file), ctx(file))
    expect(preview.errors).toEqual([{ entryId: 'TN-1-1', error: expect.objectContaining({ code: 'required_field_missing', field: 'reportNumber' }) }])
    expect(preview.importable.map(i => i.entryId)).toEqual(['TB-1-1'])

    await fill(file, (sheet, col, rowOf) => {
      sheet.getRow(rowOf('TN-1-1')).getCell(col('N° de rapport')).value = 'RE'
      sheet.getRow(rowOf('TN-1-1')).getCell(col('Température')).value = 'chaud'
    })
    preview = validateExecutionImport(await readExecutionWorkbook(file), ctx(file))
    expect(preview.errors[0].error).toMatchObject({ code: 'invalid_field_value', field: 'ambientTemp' })
  })

  it('étape non exécutée : cellule de champ illisible ignorée (Q3) ; type introuvable avec saisie : refus', async () => {
    const file = await exportFile()
    await fill(file, (sheet, col, rowOf) => {
      const head = sheet.getRow(rowOf('TN-1-1'))
      head.getCell(col('Verdict')).value = 'Passé'
      sheet.getRow(rowOf('TN-1-1#1')).getCell(col('Mesure')).value = 'n/a'   // étape sans verdict
    })
    let preview = validateExecutionImport(await readExecutionWorkbook(file), ctx(file))
    expect(preview.errors).toEqual([])
    expect(preview.importable[0].stepResults[0]).not.toHaveProperty('fields')

    await fill(file, (sheet, col, rowOf) => { sheet.getRow(rowOf('TN-1-1')).getCell(col('N° de rapport')).value = 'RE' })
    const lost = { ...ctx(file), typeDefs: new Map<string, ObjectTypeDefinition | null>([['TN-1-1', null], ['TB-1-1', TB]]) }
    preview = validateExecutionImport(await readExecutionWorkbook(file), lost)
    expect(preview.errors[0]).toMatchObject({ entryId: 'TN-1-1', error: { code: 'invalid_field_value' } })
  })

  it('enum avec virgule : pas de liste déroulante', () => {
    const model = buildExecutionSheetModel({
      campaign, locale: 'fr', exportedAt: '2026-10-29T10:00:00Z',
      entries: [{ run: campaign.runs[1], test: test('TB-1', 'root::tb'), typeDef: { runFields: [{ name: 'bench', type: 'enum', values: ['Banc A, salle 1', 'B'] }] } }],
    })
    return buildExecutionWorkbook(model).then(wb => {
      const sheet = wb.worksheets[0]
      const row = sheet.getRow(EXECUTION_SHEET_HEADER_ROW + 1)
      const benchCol = headers(sheet).indexOf('bench') + 1
      expect(row.getCell(benchCol).dataValidation).toBeUndefined()
    })
  })

  it('résultat déjà saisi recopié ; réimport sans modification ignoré, modification importée', async () => {
    const done = { ...campaign, runs: [{ ...campaign.runs[0], status: 'FAIL', runId: 'RUN-1' }, campaign.runs[1]] } as unknown as TestCampaign
    const prefill = {
      id: 'RUN-1', testCaseId: 'TN-1', result: 'FAIL', executedAt: new Date(2026, 9, 28, 14, 30).toISOString(), executedBy: 'alice',
      duration: 0, equipmentUsed: [], notes: 'coupure tardive', fields: { reportNumber: 'RE-118', report: { label: 'RE-118', url: 'https://ged/118' } },
      stepResults: [{ order: 1, result: 'FAIL', comment: 'trop bas', executedAt: null, fields: { measured: 13.1 } }],
    } as never
    const model = buildExecutionSheetModel({
      campaign: done, locale: 'fr', exportedAt: '2026-10-29T10:00:00Z',
      entries: [
        { run: done.runs[0], test: test('TN-1', 'root::tn'), typeDef: TN, prefill },
        { run: done.runs[1], test: test('TB-1', 'root::tb'), typeDef: TB },
      ],
    })
    const file = path.join(dir, 'p.xlsx')
    await (await buildExecutionWorkbook(model)).xlsx.writeFile(file)
    const ctxDone = { ...ctx(file), campaign: done }

    // Cases pré-remplies.
    await fill(file, (sheet, col, rowOf) => {
      const head = sheet.getRow(rowOf('TN-1-1'))
      expect(head.getCell(col('Verdict')).value).toBe('Échoué')
      expect(head.getCell(col('Testeur')).value).toBe('alice')
      expect(head.getCell(col('Commentaire')).value).toBe('coupure tardive')
      expect(head.getCell(col('N° de rapport')).value).toBe('RE-118')
      expect(sheet.getRow(rowOf('TN-1-1#1')).getCell(col('Mesure')).value).toBe(13.1)
    })
    let preview = validateExecutionImport(await readExecutionWorkbook(file), ctxDone)
    expect(preview.unchangedCount).toBe(1)
    expect(preview.importable).toEqual([])
    expect(preview.errors).toEqual([])

    await fill(file, (sheet, col, rowOf) => { sheet.getRow(rowOf('TN-1-1')).getCell(col('N° de rapport')).value = 'RE-119' })
    preview = validateExecutionImport(await readExecutionWorkbook(file), ctxDone)
    expect(preview.unchangedCount).toBeUndefined()
    const tn = preview.importable.find(i => i.entryId === 'TN-1-1')!
    expect(tn.fields).toMatchObject({ reportNumber: 'RE-119', report: { label: 'RE-118', url: 'https://ged/118' } })
    expect(tn.executedBy).toBe('alice')
    expect(tn.executedAt).toBe(new Date(2026, 9, 28, 14, 30).toISOString())
  })

  it('campagne sans champ d\'exécution : aucune colonne supplémentaire', async () => {
    const model = buildExecutionSheetModel({
      campaign, locale: 'fr', exportedAt: '2026-10-29T10:00:00Z',
      entries: [{ run: campaign.runs[0], test: test('TN-1', 'root::tn'), typeDef: null }],
    })
    expect(model.fieldColumns).toEqual([])
  })
})
