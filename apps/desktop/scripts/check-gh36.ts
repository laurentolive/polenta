/**
 * GH36 — vérifications automatiques du classeur Excel d'exécution hors outil (specs/GH36-tests.md,
 * scénarios « Auto »). Sprint 1 : export (E1–E10). Construit une campagne fixture, l'exporte via
 * le vrai service (`CampaignExecutionService`, dépendances simulées), relit le fichier avec exceljs
 * et vérifie contenu, protection, listes déroulantes et feuille technique. Sprint 2 : import (I*) —
 * le remplissage par le testeur est simulé en écrivant les cellules avec exceljs, puis aperçu et
 * application via le même service (écritures enregistrées par les dépendances simulées).
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

// État courant de la campagne vu par le service (modifiable par scénario).
let current: TestCampaign = campaign
const executeCalls: { testCaseId: string; dto: Record<string, unknown> }[] = []
const updateRunCalls: { entryId: string; status: string; runId?: string; meta?: unknown }[] = []
const fakeCampaigns = {
  get: async () => structuredClone(current),
  updateRun: async (_repo: string, _id: string, entryId: string, status: string, runId?: string, meta?: unknown) => {
    updateRunCalls.push({ entryId, status, runId, meta })
  },
} as unknown as CampaignsService
const fakeTests = {
  findOne: async (_repo: string, id: string) => {
    if (id === 'TEST-4') return T4
    throw new Error(`Test case ${id} not found`)
  },
  execute: async (_repo: string, testCaseId: string, dto: Record<string, unknown>) => {
    executeCalls.push({ testCaseId, dto })
    return { id: `${testCaseId}-run-${String(executeCalls.length).padStart(4, '0')}` }
  },
} as unknown as TestsService
const fakeAuth = { getAuthor: async () => ({ name: 'Importateur', email: 'imp@example.com' }) }
const service = new CampaignExecutionService(fakeCampaigns, fakeTests, fakeAuth)

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
  meta?.eachRow(r => { if (/^TEST-\d+-\d+$/.test(str(r.getCell(1).value))) instRows.push([1, 2, 3, 4].map(i => str(r.getCell(i).value)).join('|')) })
  check('E9 une ligne par instance avec ses orders et testFound', eq(instRows, [
    'TEST-1-1|TEST-1|1,2,3|1', 'TEST-2-1|TEST-2|1,2|1', 'TEST-3-1|TEST-3|1|1', 'TEST-4-1|TEST-4|1,2|1', 'TEST-9-1|TEST-9||0',
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
    { get: async () => ({ ...campaign, status: 'completed' }) } as unknown as CampaignsService, fakeTests, fakeAuth)
  const refused = await closed.exportSheet('/repo', 'CAMP-T', 'fr', path.join(os.tmpdir(), 'gh36-closed.xlsx')).then(() => false, () => true)
  check('export refusé sur campagne clôturée', refused)

  await importScenarios()

  console.log(`\n${passes} PASS, ${failures} FAIL`)
  if (failures > 0) process.exit(1)
}

// ── Sprint 2 : import ───────────────────────────────────────────────────────

type Fill = Partial<Record<'verdict' | 'tester' | 'date' | 'comment', ExcelJS.CellValue>>

/** Exporte la campagne fixture, puis applique `fills` (clé de ligne → valeurs saisies) et
 *  `mutate` (altérations libres du classeur) comme le ferait un testeur. */
async function filledSheet(name: string, fills: Record<string, Fill>, mutate?: (wb: ExcelJS.Workbook, sheet: ExcelJS.Worksheet) => void): Promise<string> {
  current = campaign
  const dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh36-imp-'))
  const file = path.join(dir, `${name}.xlsx`)
  await service.exportSheet('/repo', 'CAMP-T', 'fr', file)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const sheet = wb.worksheets[0]
  for (let r = EXECUTION_SHEET_HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const fill = fills[str(sheet.getRow(r).getCell(col('key')).value)]
    if (!fill) continue
    for (const [c, v] of Object.entries(fill)) sheet.getRow(r).getCell(col(c as ExecutionSheetColumn)).value = v ?? null
  }
  mutate?.(wb, sheet)
  await wb.xlsx.writeFile(file)
  return file
}

/** Réordonne les lignes de données (tri fait par le testeur dans Excel). */
function reorderRows(sheet: ExcelJS.Worksheet, order: (keys: string[]) => string[]): void {
  const first = EXECUTION_SHEET_HEADER_ROW + 1
  const byKey = new Map<string, ExcelJS.CellValue[]>()
  for (let r = first; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    byKey.set(str(row.getCell(col('key')).value), EXECUTION_SHEET_COLUMNS.map((_, i) => row.getCell(i + 1).value))
  }
  order([...byKey.keys()]).forEach((key, i) => {
    const row = sheet.getRow(first + i)
    byKey.get(key)!.forEach((v, j) => { row.getCell(j + 1).value = v })
  })
}

const localNoon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0).toISOString()
const NOW_TOLERANCE_MS = 60_000

async function importScenarios(): Promise<void> {
  const base: Record<string, Fill> = {
    'TEST-1-1#1': { verdict: 'Passé' }, 'TEST-1-1#2': { verdict: 'Passé', comment: 'ok' },
    'TEST-1-1#3': { verdict: 'Échoué', comment: 'Délai 800 ms\nà froid' },
    'TEST-2-1': { verdict: 'Passé', tester: 'Alice', date: new Date(Date.UTC(2026, 9, 5)), comment: 'RAS' },
  }

  // I1 — aperçu
  const f1 = await filledSheet('i1', base)
  const p1 = await service.preview('/repo', 'CAMP-T', f1)
  const a = p1.importable.find(i => i.entryId === 'TEST-1-1')
  const b = p1.importable.find(i => i.entryId === 'TEST-2-1')
  check('I1 deux instances importables, trois non remplies (dont le test introuvable vide)',
    p1.importable.length === 2 && p1.unfilledCount === 3 && p1.errors.length === 0 && !p1.fatal,
    JSON.stringify({ n: p1.importable.length, u: p1.unfilledCount, e: p1.errors, f: p1.fatal }))
  check('I1 A : FAIL calculé depuis les étapes', a?.result === 'FAIL' && a.resultForced === false
    && eq(a.stepResults.map(s => s.result), ['PASS', 'PASS', 'FAIL']))
  check('I1 B : PASS forcé, étapes NOT_EXECUTED', b?.result === 'PASS' && b.resultForced === true
    && eq(b.stepResults.map(s => s.result), ['NOT_EXECUTED', 'NOT_EXECUTED']))
  check('I1 commentaire multi-ligne → paragraphes', a?.stepResults[2].comment === 'Délai 800 ms\n\nà froid', a?.stepResults[2].comment)

  // I3 — lignes réordonnées
  const f3 = await filledSheet('i3', base, (_wb, sheet) => reorderRows(sheet, keys => {
    const b2 = keys.filter(k => k.startsWith('TEST-2-1'))
    const a2 = keys.filter(k => k.startsWith('TEST-1-1')).reverse()
    return [...b2, ...a2, ...keys.filter(k => !k.startsWith('TEST-1-1') && !k.startsWith('TEST-2-1'))]
  }))
  const p3 = await service.preview('/repo', 'CAMP-T', f3)
  const shape = (p: typeof p1) => p.importable.map(i => JSON.stringify([i.entryId, i.result, i.stepResults])).sort()
  check('I3 lignes réordonnées : même aperçu', eq(shape(p3), shape(p1)))

  // I4 — PASS forcé malgré une étape FAIL
  const f4 = await filledSheet('i4', { ...base, 'TEST-1-1': { verdict: 'Passé' } })
  const a4 = (await service.preview('/repo', 'CAMP-T', f4)).importable.find(i => i.entryId === 'TEST-1-1')
  check('I4 global forcé prioritaire', a4?.result === 'PASS' && a4.resultForced)

  // I5 / I6 — testeur et dates
  check('I5 testeur vide → utilisateur qui importe', a?.executedBy === 'Importateur')
  check('I5 date vide → date d\'import', !!a && Math.abs(Date.parse(a.executedAt) - Date.now()) < NOW_TOLERANCE_MS)
  check('I6 testeur saisi', b?.executedBy === 'Alice')
  check('I6 cellule date sans heure → midi local', b?.executedAt === localNoon(2026, 10, 5), b?.executedAt)
  const f6 = await filledSheet('i6', { ...base, 'TEST-1-1': { date: '05/10/2026 14:30' } })
  const a6 = (await service.preview('/repo', 'CAMP-T', f6)).importable.find(i => i.entryId === 'TEST-1-1')
  check('I6 date texte JJ/MM/AAAA HH:mm', a6?.executedAt === new Date(2026, 9, 5, 14, 30).toISOString(), a6?.executedAt)

  const f6b = await filledSheet('i6b', { ...base, 'TEST-1-1': { date: { formula: 'DATE(2026,10,7)', result: new Date(Date.UTC(2026, 9, 7)) } } })
  const a6b = (await service.preview('/repo', 'CAMP-T', f6b)).importable.find(i => i.entryId === 'TEST-1-1')
  check('I6 date saisie par formule → valeur calculée', a6b?.executedAt === localNoon(2026, 10, 7), a6b?.executedAt)

  // I7 — instance déjà exécutée
  const f7 = await filledSheet('i7', { 'TEST-3-1#1': { verdict: 'FAIL' } })
  const c7 = (await service.preview('/repo', 'CAMP-T', f7)).importable.find(i => i.entryId === 'TEST-3-1')
  check('I7 instance déjà PASS : importable, statut précédent signalé', c7?.previousStatus === 'PASS' && c7.result === 'FAIL')
  check('I7 exigence de l\'instance conservée', c7?.requirementId === 'SYS-0007')

  // I9–I12 — refus global
  const f9 = await filledSheet('i9', base, wb => { wb.getWorksheet(EXECUTION_SHEET_META_NAME)!.getRow(2).getCell(2).value = 'CAMP-X' })
  const p9 = await service.preview('/repo', 'CAMP-T', f9)
  check('I9 autre campagne → refus global', p9.fatal?.code === 'wrong_campaign' && p9.importable.length === 0)
  const f10 = await filledSheet('i10', base)
  current = { ...campaign, status: 'completed' }
  const p10 = await service.preview('/repo', 'CAMP-T', f10)
  check('I10 campagne clôturée → refus global', p10.fatal?.code === 'campaign_closed')
  current = campaign
  const f11 = await filledSheet('i11', base, wb => { wb.removeWorksheet(wb.getWorksheet(EXECUTION_SHEET_META_NAME)!.id) })
  check('I11 feuille technique absente', (await service.preview('/repo', 'CAMP-T', f11)).fatal?.code === 'not_an_execution_sheet')
  const junk = path.join(path.dirname(f11), 'junk.xlsx')
  await fsP.writeFile(junk, 'pas un classeur')
  check('I11 fichier corrompu', (await service.preview('/repo', 'CAMP-T', junk)).fatal?.code === 'unreadable')
  const f12 = await filledSheet('i12', base, wb => { wb.getWorksheet(EXECUTION_SHEET_META_NAME)!.getRow(1).getCell(2).value = 99 })
  check('I12 version inconnue', (await service.preview('/repo', 'CAMP-T', f12)).fatal?.code === 'unsupported_version')

  // I13 — instance retirée depuis l'export
  const f13 = await filledSheet('i13', { ...base, 'TEST-4-1#1': { verdict: 'PASS' } })
  current = { ...campaign, runs: campaign.runs.filter(r => r.entryId !== 'TEST-4-1') }
  const p13 = await service.preview('/repo', 'CAMP-T', f13)
  current = campaign
  check('I13 instance retirée → erreur, les autres importables',
    p13.errors.some(e => e.entryId === 'TEST-4-1' && e.error.code === 'entry_not_found') && p13.importable.length === 2)

  // I14 — étape supprimée / clé altérée
  const f14 = await filledSheet('i14', base, (_wb, sheet) => {
    for (let r = EXECUTION_SHEET_HEADER_ROW + 1; r <= sheet.rowCount; r++) {
      const cell = sheet.getRow(r).getCell(col('key'))
      if (str(cell.value) === 'TEST-1-1#2') cell.value = 'TEST-1-1#9'
    }
  })
  const e14 = (await service.preview('/repo', 'CAMP-T', f14)).errors.find(e => e.entryId === 'TEST-1-1')?.error
  check('I14 clé d\'étape altérée → steps_mismatch', e14?.code === 'steps_mismatch' && eq(e14.expected, [1, 2, 3]) && eq(e14.found, [1, 3, 9]), JSON.stringify(e14))
  const f14b = await filledSheet('i14b', base, (_wb, sheet) => {
    for (let r = EXECUTION_SHEET_HEADER_ROW + 1; r <= sheet.rowCount; r++) {
      if (str(sheet.getRow(r).getCell(col('key')).value) === 'TEST-1-1#3') { sheet.spliceRows(r, 1); break }
    }
  })
  check('I14 ligne d\'étape supprimée → steps_mismatch',
    (await service.preview('/repo', 'CAMP-T', f14b)).errors.some(e => e.entryId === 'TEST-1-1' && e.error.code === 'steps_mismatch'))

  // I15 / I16 — saisies invalides
  const f15 = await filledSheet('i15', { ...base, 'TEST-2-1#1': { verdict: 'foo' } })
  const e15 = (await service.preview('/repo', 'CAMP-T', f15)).errors.find(e => e.entryId === 'TEST-2-1')?.error
  check('I15 verdict inconnu → erreur avec ligne et valeur', e15?.code === 'invalid_verdict' && e15.value === 'foo' && e15.row > EXECUTION_SHEET_HEADER_ROW)
  const f16 = await filledSheet('i16', { ...base, 'TEST-2-1': { verdict: 'PASS', date: '32/13/2026' } })
  check('I16 date invalide', (await service.preview('/repo', 'CAMP-T', f16)).errors.some(e => e.entryId === 'TEST-2-1' && e.error.code === 'invalid_date'))

  // I17 — verdicts en codes / FR / EN
  const f17 = await filledSheet('i17', {
    'TEST-1-1#1': { verdict: 'FAIL' }, 'TEST-1-1#2': { verdict: ' échoué ' }, 'TEST-1-1#3': { verdict: 'Failed' },
  })
  const a17 = (await service.preview('/repo', 'CAMP-T', f17)).importable.find(i => i.entryId === 'TEST-1-1')
  check('I17 codes et libellés FR/EN reconnus', eq(a17?.stepResults.map(s => s.result), ['FAIL', 'FAIL', 'FAIL']))

  // I18 — ligne ajoutée sans clé
  const f18 = await filledSheet('i18', base, (_wb, sheet) => {
    sheet.getRow(sheet.rowCount + 1).getCell(col('comment')).value = 'ligne ajoutée'
  })
  const p18 = await service.preview('/repo', 'CAMP-T', f18)
  check('I18 ligne sans clé → avertissement', p18.warnings.length === 1 && p18.warnings[0].code === 'row_without_key')

  // I19 — échappement Markdown
  const f19 = await filledSheet('i19', { 'TEST-4-1': { verdict: 'PASS', comment: '- item\n# titre *gras* <b>x</b>\n1. un\n{tension}' } })
  const d19 = (await service.preview('/repo', 'CAMP-T', f19)).importable.find(i => i.entryId === 'TEST-4-1')
  check('I19 caractères Markdown échappés, accolades conservées',
    d19?.notes === '\\- item\n\n\\# titre \\*gras\\* \\<b\\>x\\</b\\>\n\n1\\. un\n\n{tension}', d19?.notes)

  // I20 — test introuvable rempli
  const f20 = await filledSheet('i20', { 'TEST-9-1': { verdict: 'PASS' } })
  check('I20 test introuvable → erreur', (await service.preview('/repo', 'CAMP-T', f20)).errors.some(e => e.entryId === 'TEST-9-1' && e.error.code === 'test_not_found'))

  // Application (I2 côté service) : un TestRun puis une mise à jour d'instance par instance remplie.
  executeCalls.length = 0
  updateRunCalls.length = 0
  const res = await service.apply('/repo', 'CAMP-T', f1, '/ws')
  check('apply : instances écrites dans l\'ordre du fichier', eq(res.imported, ['TEST-1-1', 'TEST-2-1']) && !res.failure)
  check('apply : TestRun avec origine, testeur, date, résultat', executeCalls.length === 2
    && executeCalls[1].testCaseId === 'TEST-2' && executeCalls[1].dto.origin === 'excel-import'
    && executeCalls[1].dto.executedBy === 'Alice' && executeCalls[1].dto.executedAt === localNoon(2026, 10, 5)
    && executeCalls[1].dto.result === 'PASS' && executeCalls[1].dto.notes === 'RAS', JSON.stringify(executeCalls[1]))
  check('apply : statut d\'instance, runId et méta', eq(updateRunCalls.map(u => [u.entryId, u.status, u.runId]), [
    ['TEST-1-1', 'FAIL', 'TEST-1-run-0001'], ['TEST-2-1', 'PASS', 'TEST-2-run-0002'],
  ]) && eq(updateRunCalls[1].meta, { executedAt: localNoon(2026, 10, 5), executedBy: 'Alice' }), JSON.stringify(updateRunCalls))
  executeCalls.length = 0
  const r7 = await service.apply('/repo', 'CAMP-T', f7)
  check('apply I7 : requirementId transmis au run', executeCalls[0]?.dto.requirementId === 'SYS-0007' && r7.imported.length === 1)
  executeCalls.length = 0
  const r9 = await service.apply('/repo', 'CAMP-T', f9)
  check('apply refus global : rien d\'écrit', r9.imported.length === 0 && executeCalls.length === 0 && r9.preview.fatal?.code === 'wrong_campaign')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
