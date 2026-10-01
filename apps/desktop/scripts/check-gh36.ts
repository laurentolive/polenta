/**
 * GH36 — vérifications automatiques du classeur Excel d'exécution hors outil (specs/GH36-tests.md,
 * scénarios « Auto »). Sprint 1 : export (E1–E10). Construit une campagne fixture, l'exporte via
 * le vrai service (`CampaignExecutionService`, dépendances simulées), relit le fichier avec exceljs
 * et vérifie contenu, protection, listes déroulantes et feuille technique.
 *
 * Lancement : `pnpm --filter @polenta/desktop exec tsx scripts/check-gh36.ts`
 */
import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import ExcelJS from 'exceljs'
import {
  EXECUTION_SHEET_COLUMNS, EXECUTION_SHEET_HEADER_ROW, EXECUTION_SHEET_LABELS, EXECUTION_SHEET_META_NAME,
  parseGlobalVerdict, parseStepVerdict,
} from '@polenta/types'
import type { CampaignTestRun, ExecutionSheetColumn, TestCampaign, TestCase } from '@polenta/types'
import { CampaignExecutionService } from '../src/main/services/campaign-execution.service'
import type { CampaignsService } from '../src/main/services/campaigns.service'
import type { TestsService } from '../src/main/services/tests.service'

let failures = 0
let passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++
  else failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`)
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// ── Fixtures ────────────────────────────────────────────────────────────────

function testCase(id: string, title: string, steps: [string, string][], extra: Partial<TestCase> = {}): TestCase {
  return {
    id, title, projectId: '', branchId: '', objectTypeRef: 'root::test', status: 'approved', version: 1,
    preconditions: '', postconditions: '', equipment: [], fields: {},
    steps: steps.map(([action, expectedResult], i) => ({ order: i + 1, action, expectedResult, notes: null })),
    createdAt: null, createdBy: null, updatedAt: null, updatedBy: null,
    ...extra,
  }
}

const T1 = testCase('TEST-1', 'Démarrage', [
  ['Appuyer sur **Marche**', 'LED allumée'],
  ['Mesurer le délai', '< 500 ms'],
  ['Relâcher\n\n```image\n{"src":"images/a.png"}\n```', 'Moteur arrêté\n\n```drawio\n{"file":"d.drawio"}\n```'],
], { preconditions: 'Batterie > 20 %', postconditions: '- Produit éteint\n- LED off' })
const T2 = testCase('TEST-2', 'Tension', [
  ['Alimenter à {tension}', 'Lot {lot} affiché'],
  ['Couper', 'Arrêt'],
])
const T3 = testCase('TEST-3', 'Itérant', [['Vérifier {req.title}', 'OK']])
const T4 = testCase('TEST-4', 'Live', [['Étape A', 'A'], ['Étape B', 'B']])

const runs: CampaignTestRun[] = [
  { entryId: 'TEST-1-1', testCaseId: 'TEST-1', status: 'pending', testSnapshot: T1 },
  {
    entryId: 'TEST-2-1', testCaseId: 'TEST-2', status: 'pending', testSnapshot: T2,
    resolvedParams: { tension: '230 V' }, paramValues: { lot: 'L42' }, unresolvedParams: [],
  },
  {
    entryId: 'TEST-3-1', testCaseId: 'TEST-3', status: 'PASS', testSnapshot: T3, requirementId: 'SYS-0007',
    resolvedParams: { 'req.title': 'Démarrage rapide' }, unresolvedParams: [], runId: 'TEST-3-run-0001',
  },
  { entryId: 'TEST-4-1', testCaseId: 'TEST-4', status: 'pending' },          // pas de snapshot → live
  { entryId: 'TEST-9-1', testCaseId: 'TEST-9', status: 'pending' },          // test introuvable
]
const campaign: TestCampaign = {
  id: 'CAMP-T', title: 'Validation v2', fields: {}, status: 'in_progress', baselineRef: 'v2.0',
  testCaseIds: runs.map(r => r.testCaseId), runs, createdAt: '2026-10-01T00:00:00Z',
}

const fakeCampaigns = { get: async () => structuredClone(campaign) } as unknown as CampaignsService
const fakeTests = {
  findOne: async (_repo: string, id: string) => {
    if (id === 'TEST-4') return T4
    throw new Error(`Test case ${id} not found`)
  },
} as unknown as TestsService
const service = new CampaignExecutionService(fakeCampaigns, fakeTests)

// ── Helpers de lecture ──────────────────────────────────────────────────────

const col = (c: ExecutionSheetColumn) => EXECUTION_SHEET_COLUMNS.indexOf(c) + 1
const str = (v: ExcelJS.CellValue) => (v === null || v === undefined ? '' : String(v))

interface ReadRow { row: number; get: (c: ExecutionSheetColumn) => string; cell: (c: ExecutionSheetColumn) => ExcelJS.Cell; outline: number }

async function exportAndRead(locale: 'fr' | 'en'): Promise<{ wb: ExcelJS.Workbook; sheet: ExcelJS.Worksheet; rows: ReadRow[] }> {
  // GH36_OUT_DIR : conserve les fichiers produits (ouverture manuelle dans Excel, E11).
  const dir = process.env.GH36_OUT_DIR ?? await fsP.mkdtemp(path.join(os.tmpdir(), 'gh36-'))
  const file = path.join(dir, `CAMP-T_${locale}.xlsx`)
  await service.exportSheet('/repo', 'CAMP-T', locale, file)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const sheet = wb.worksheets[0]
  const rows: ReadRow[] = []
  for (let r = EXECUTION_SHEET_HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    if (!str(row.getCell(col('key')).value)) continue
    rows.push({
      row: r,
      get: c => str(row.getCell(col(c)).value),
      cell: c => row.getCell(col(c)),
      outline: row.outlineLevel ?? 0,
    })
  }
  return { wb, sheet, rows }
}

// ── Scénarios ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { wb, sheet, rows } = await exportAndRead('fr')
  const L = EXECUTION_SHEET_LABELS.fr
  const byKey = new Map(rows.map(r => [r.get('key'), r]))

  // E1 — structure
  const keys = rows.map(r => r.get('key'))
  check('E1 clés dans l\'ordre de la campagne', eq(keys, [
    'TEST-1-1', 'TEST-1-1#1', 'TEST-1-1#2', 'TEST-1-1#3',
    'TEST-2-1', 'TEST-2-1#1', 'TEST-2-1#2',
    'TEST-3-1', 'TEST-3-1#1',
    'TEST-4-1', 'TEST-4-1#1', 'TEST-4-1#2',
    'TEST-9-1',
  ]), keys.join(' | '))
  check('E1 colonne clé masquée', sheet.getColumn(col('key')).hidden === true)
  check('E1 lignes d\'étape repliables (outline 1), instances au niveau 0',
    rows.every(r => r.outline === (r.get('key').includes('#') ? 1 : 0)))
  check('E1 en-têtes ligne 5', eq(EXECUTION_SHEET_COLUMNS.map(c => str(sheet.getRow(EXECUTION_SHEET_HEADER_ROW).getCell(col(c)).value)),
    EXECUTION_SHEET_COLUMNS.map(c => L.headers[c])))
  check('E1 titre de campagne', str(sheet.getCell(1, col('instance')).value) === 'CAMP-T — Validation v2')
  check('E1 baseline mentionnée', str(sheet.getCell(2, col('instance')).value).includes('v2.0'))
  check('E1 instance : ID — titre', byKey.get('TEST-1-1')?.get('text') === 'TEST-1 — Démarrage')
  check('E1 étape : n° et action en texte brut', byKey.get('TEST-1-1#1')?.get('step') === '1'
    && byKey.get('TEST-1-1#1')?.get('text') === 'Appuyer sur Marche', byKey.get('TEST-1-1#1')?.get('text'))
  const cond = byKey.get('TEST-1-1')?.get('expected') ?? ''
  check('E1 pré/postconditions sur la ligne d\'instance', cond.includes('Préconditions :\nBatterie > 20 %')
    && cond.includes('Postconditions :\n• Produit éteint\n• LED off'), cond)

  // E2 — paramètres
  check('E2 paramètres substitués dans l\'action', byKey.get('TEST-2-1#1')?.get('text') === 'Alimenter à 230 V',
    byKey.get('TEST-2-1#1')?.get('text'))
  check('E2 paramètre saisi substitué dans le résultat attendu', byKey.get('TEST-2-1#1')?.get('expected') === 'Lot L42 affiché')
  check('E2 colonne Paramètres triée', byKey.get('TEST-2-1')?.get('params') === 'lot = L42\ntension = 230 V',
    byKey.get('TEST-2-1')?.get('params'))

  // E3 — instance itérante
  check('E3 exigence de l\'instance', byKey.get('TEST-3-1')?.get('requirement') === 'SYS-0007')
  check('E3 {req.title} substitué', byKey.get('TEST-3-1#1')?.get('text') === 'Vérifier Démarrage rapide')
  check('E3 statut actuel libellé', byKey.get('TEST-3-1')?.get('currentStatus') === L.runStatuses.PASS)
  check('E3 instance pending libellée', byKey.get('TEST-1-1')?.get('currentStatus') === L.runStatuses.pending)

  // E4 — test live
  check('E4 test sans snapshot résolu en live', byKey.get('TEST-4-1')?.get('text') === 'TEST-4 — Live'
    && byKey.get('TEST-4-1#2')?.get('text') === 'Étape B')

  // E5 — test introuvable
  check('E5 test introuvable : instance sans étape', byKey.get('TEST-9-1')?.get('text') === `TEST-9 — ${L.testNotFound}`
    && !keys.some(k => k.startsWith('TEST-9-1#')))

  // E6 — richtext
  check('E6 bloc image → repère', byKey.get('TEST-1-1#3')?.get('text') === `Relâcher\n${L.image}`, byKey.get('TEST-1-1#3')?.get('text'))
  check('E6 bloc draw.io → repère', byKey.get('TEST-1-1#3')?.get('expected') === `Moteur arrêté\n${L.diagram}`,
    byKey.get('TEST-1-1#3')?.get('expected'))

  // E7 — protection
  const protection = (sheet as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection
  check('E7 feuille protégée', !!protection?.sheet, JSON.stringify(protection))
  const editableOk = rows.every(r => EXECUTION_SHEET_COLUMNS.every(c => {
    const editable = r.get('key').includes('#')
      ? c === 'verdict' || c === 'comment'
      : c === 'verdict' || c === 'tester' || c === 'date' || c === 'comment'
    const locked = r.cell(c).protection?.locked !== false
    return editable === !locked
  }))
  check('E7 seules les cellules de saisie sont déverrouillées', editableOk)

  // E8 — listes déroulantes
  const dvInstance = byKey.get('TEST-1-1')?.cell('verdict').dataValidation
  const dvStep = byKey.get('TEST-1-1#1')?.cell('verdict').dataValidation
  check('E8 liste globale sur la ligne d\'instance', dvInstance?.type === 'list'
    && dvInstance.formulae?.[0] === `"${Object.values(L.globalVerdicts).join(',')}"`, JSON.stringify(dvInstance))
  check('E8 liste étape sur la ligne d\'étape', dvStep?.type === 'list'
    && dvStep.formulae?.[0] === `"${Object.values(L.stepVerdicts).join(',')}"`, JSON.stringify(dvStep))
  check('E8 pas de liste sur Testeur', !byKey.get('TEST-1-1')?.cell('tester').dataValidation?.type)

  // E9 — feuille technique
  const meta = wb.getWorksheet(EXECUTION_SHEET_META_NAME)
  check('E9 _polenta veryHidden', meta?.state === 'veryHidden', meta?.state)
  const metaRows = new Map<string, string>()
  meta?.eachRow(r => metaRows.set(str(r.getCell(1).value), str(r.getCell(2).value)))
  check('E9 formatVersion = 1', metaRows.get('formatVersion') === '1')
  check('E9 campaignId', metaRows.get('campaignId') === 'CAMP-T')
  const instRows: string[] = []
  meta?.eachRow(r => { if (/^TEST-\d+-\d+$/.test(str(r.getCell(1).value))) instRows.push([1, 2, 3].map(i => str(r.getCell(i).value)).join('|')) })
  check('E9 une ligne par instance avec ses orders', eq(instRows, [
    'TEST-1-1|TEST-1|1,2,3', 'TEST-2-1|TEST-2|1,2', 'TEST-3-1|TEST-3|1', 'TEST-4-1|TEST-4|1,2', 'TEST-9-1|TEST-9|',
  ]), instRows.join(' ; '))

  // E10 — anglais
  const en = await exportAndRead('en')
  const LE = EXECUTION_SHEET_LABELS.en
  check('E10 feuille et en-têtes en anglais', en.sheet.name === LE.sheetName
    && str(en.sheet.getRow(EXECUTION_SHEET_HEADER_ROW).getCell(col('expected')).value) === LE.headers.expected)
  check('E10 liste déroulante en anglais', en.rows[0].cell('verdict').dataValidation?.formulae?.[0]
    === `"${Object.values(LE.globalVerdicts).join(',')}"`)
  check('E10 bandeau en anglais', str(en.sheet.getCell(3, col('instance')).value) === LE.banner)

  // Reconnaissance des verdicts (utilisée à l'import, sprint 2)
  check('verdicts : codes, libellés FR/EN, casse et espaces', parseStepVerdict(' échoué ') === 'FAIL'
    && parseStepVerdict('Failed') === 'FAIL' && parseStepVerdict('NOT_EXECUTED') === 'NOT_EXECUTED'
    && parseStepVerdict('non  exécuté') === 'NOT_EXECUTED' && parseStepVerdict('ignoré') === 'SKIP'
    && parseGlobalVerdict('Incomplete') === 'INCOMPLETE' && parseGlobalVerdict('SKIP') === null
    && parseStepVerdict('foo') === null)

  // Campagne clôturée : export refusé
  const closed = new CampaignExecutionService(
    { get: async () => ({ ...campaign, status: 'completed' }) } as unknown as CampaignsService, fakeTests)
  const refused = await closed.exportSheet('/repo', 'CAMP-T', 'fr', path.join(os.tmpdir(), 'gh36-closed.xlsx')).then(() => false, () => true)
  check('export refusé sur campagne clôturée', refused)

  console.log(`\n${passes} PASS, ${failures} FAIL`)
  if (failures > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
