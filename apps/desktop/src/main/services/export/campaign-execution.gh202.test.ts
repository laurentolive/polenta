import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CampaignTestRun, TestCampaign, TestCase, TestRun, TestedConfigContext, TestedRepoOptions } from '@polenta/types'
import { EXECUTION_SHEET_HEADER_ROW, EXECUTION_SHEET_META_NAME } from '@polenta/types'
import { buildExecutionSheetModel, buildExecutionWorkbook, type ExecutionSheetEntry } from './campaign-execution.xlsx'
import { readExecutionWorkbook, validateExecutionImport } from './campaign-execution-import'

// GH202 — classeur d'exécution v4 : colonnes de la version testée (specs/GH202-tests.md 9).

const options: TestedRepoOptions = {
  name: 'produit', label: 'produit',
  versions: [
    { id: 'PV-0002', title: '1.1', state: 'in_progress', components: { moteur: 'MV-0001' } },
    { id: 'PV-0001', title: '1.0', state: 'abandoned' },
  ],
  dependencies: [{
    name: 'moteur', label: 'Moteur',
    versions: [{ id: 'MV-0001', title: '2.0', state: 'released' }, { id: 'MV-0002', title: '2.1', state: 'in_progress' }],
    dependencies: [{ name: 'bms', label: 'BMS', versions: [], dependencies: [] }],
  }],
}
const test: TestCase = {
  id: 'T-1', title: 'T-1', objectTypeRef: 'root::tn', status: 'approved', version: 1, fields: {},
  steps: [{ order: 1, action: 'A', expectedResult: 'E', notes: '' }],
} as unknown as TestCase
const entry = { entryId: 'T-1-1', testCaseId: 'T-1', status: 'pending' } as CampaignTestRun
const campaign = { id: 'CAMP-0001', title: 'C', status: 'in_progress', runs: [entry] } as unknown as TestCampaign

let dir: string
beforeEach(async () => { dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh202x-')) })
afterEach(async () => { await fsP.rm(dir, { recursive: true, force: true }) })

async function exportFile(tested: TestedConfigContext | undefined, extra: Partial<ExecutionSheetEntry> = {}): Promise<string> {
  const model = buildExecutionSheetModel({
    campaign, locale: 'fr', exportedAt: '2026-11-03T10:00:00Z', ...(tested && { tested }),
    entries: [{ run: entry, test, fingerprint: undefined, ...extra }],
  })
  const wb = await buildExecutionWorkbook(model)
  const file = path.join(dir, 'x.xlsx')
  await wb.xlsx.writeFile(file)
  return file
}

/** Saisit des cellules de la ligne d'instance, par en-tête. */
async function fill(file: string, values: Record<string, string | null>) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const sheet = wb.worksheets.find(ws => ws.name !== EXECUTION_SHEET_META_NAME)!
  const head = sheet.getRow(EXECUTION_SHEET_HEADER_ROW)
  const hs = Array.from({ length: head.cellCount }, (_, i) => String(head.getCell(i + 1).value ?? ''))
  const row = sheet.getRow(EXECUTION_SHEET_HEADER_ROW + 1)
  for (const [h, v] of Object.entries(values)) row.getCell(hs.findIndex(x => x.startsWith(h)) + 1).value = v
  await wb.xlsx.writeFile(file)
  return hs
}

const preview = async (file: string, testedOptions: TestedRepoOptions | undefined = options) => validateExecutionImport(await readExecutionWorkbook(file), {
  campaign, fallbackUser: 'x', now: '2026-11-03T11:00:00Z', filePath: file, ...(testedOptions && { testedOptions }),
})

describe('GH202 — classeur, version testée', () => {
  it('colonnes de la version et des composants, version pré-remplie en label, composants vides', async () => {
    const file = await exportFile({ options, prefill: { version: 'PV-0002' } })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    const sheet = wb.worksheets.find(ws => ws.name !== EXECUTION_SHEET_META_NAME)!
    const head = sheet.getRow(EXECUTION_SHEET_HEADER_ROW)
    const hs = Array.from({ length: head.cellCount }, (_, i) => String(head.getCell(i + 1).value ?? ''))
    expect(hs).toEqual(expect.arrayContaining(['Version testée *', 'Moteur', 'BMS']))
    const row = sheet.getRow(EXECUTION_SHEET_HEADER_ROW + 1)
    expect(row.getCell(hs.indexOf('Version testée *') + 1).value).toBe('1.1')
    expect(row.getCell(hs.indexOf('Moteur') + 1).value).toBeNull()
    expect(row.getCell(hs.indexOf('Moteur') + 1).numFmt).toBe('@')
    // Une ligne d'étape reste verrouillée sur ces colonnes.
    expect(sheet.getRow(EXECUTION_SHEET_HEADER_ROW + 2).getCell(hs.indexOf('Moteur') + 1).protection?.locked).not.toBe(false)
  })

  it('sans version sélectionnable : pas de colonne, import sans testedConfig', async () => {
    const file = await exportFile({ options: { ...options, versions: [] }, prefill: null })
    const hs = await fill(file, { Verdict: 'PASS' })
    expect(hs.some(h => h.startsWith('Version testée'))).toBe(false)
    const result = await preview(file)
    expect(result.errors).toEqual([])
    expect(result.importable[0].testedVersion).toBeUndefined()
  })

  it('relecture : version et écart ; composant vide absent', async () => {
    const file = await exportFile({ options, prefill: { version: 'PV-0002' } })
    await fill(file, { Verdict: 'PASS', Moteur: '2.1' })
    const result = await preview(file)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.importable[0].testedVersion).toEqual({ version: '1.1', components: { moteur: '2.1' } })
  })

  it('valeur inconnue : écart non documenté signalé à l\'aperçu', async () => {
    const file = await exportFile({ options, prefill: null })
    await fill(file, { Verdict: 'PASS', 'Version testée': 'proto', BMS: 'B-12' })
    const result = await preview(file)
    expect(result.importable[0].testedVersion).toEqual({ version: 'proto', components: { 'moteur/bms': 'B-12' } })
    expect(result.warnings).toEqual([
      { code: 'tested_version_undocumented', entryId: 'T-1-1', path: '', value: 'proto' },
      { code: 'tested_version_undocumented', entryId: 'T-1-1', path: 'moteur/bms', value: 'B-12' },
    ])
  })

  it('une version abandonnée n\'est pas reconnue', async () => {
    const file = await exportFile({ options, prefill: null })
    await fill(file, { Verdict: 'PASS', 'Version testée': '1.0' })
    expect((await preview(file)).warnings).toContainEqual({ code: 'tested_version_undocumented', entryId: 'T-1-1', path: '', value: '1.0' })
  })

  it('version manquante : erreur par instance', async () => {
    const file = await exportFile({ options, prefill: null })
    await fill(file, { Verdict: 'PASS' })
    const result = await preview(file)
    expect(result.importable).toEqual([])
    expect(result.errors).toEqual([{ entryId: 'T-1-1', error: { code: 'tested_version_missing', row: EXECUTION_SHEET_HEADER_ROW + 1 } }])
  })

  it('version manquante acceptée si plus aucune version n\'est sélectionnable depuis l\'export', async () => {
    const file = await exportFile({ options, prefill: null })
    await fill(file, { Verdict: 'PASS' })
    expect((await preview(file, { ...options, versions: [] })).errors).toEqual([])
  })

  it('classeur sans ces colonnes (v3) : importé sans testedConfig', async () => {
    const file = await exportFile(undefined)
    await fill(file, { Verdict: 'PASS' })
    const result = await preview(file)
    expect(result.errors).toEqual([])
    expect(result.importable[0].testedVersion).toBeUndefined()
  })

  it('instance déjà exécutée, non modifiée : reconnue, ses valeurs sont reprises du run', async () => {
    const executed: TestRun = {
      id: 'R1', testCaseId: 'T-1', result: 'PASS', executedAt: '2026-11-01T08:00:00Z', executedBy: 'x', duration: 0, equipmentUsed: [],
      stepResults: [{ order: 1, result: 'PASS', comment: '' }], notes: '',
      testedConfig: { component: 'produit', ref: 'PV-0002', label: '1.1', components: { moteur: { ref: 'MV-0002', label: '2.1', expected: 'MV-0001' } } },
    } as unknown as TestRun
    const file = await exportFile({ options, prefill: null }, { prefill: executed })
    const result = await preview(file)
    expect(result.unchangedCount).toBe(1)
    await fill(file, { Moteur: '2.0' })
    expect((await preview(file)).importable[0].testedVersion).toEqual({ version: '1.1', components: { moteur: '2.0' } })
  })
})
