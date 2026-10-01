import * as path from 'path'
import ExcelJS from 'exceljs'
import {
  EXECUTION_SHEET_COLUMNS, EXECUTION_SHEET_FORMAT_VERSION, EXECUTION_SHEET_HEADER_ROW, EXECUTION_SHEET_META_NAME,
  parseGlobalVerdict, parseStepVerdict,
} from '@polenta/types'
import type {
  ExecutionImportFatal, ExecutionImportInstanceError, ExecutionImportPreview, ExecutionSheetColumn,
  ImportedInstance, StepResultValue, TestCampaign, TestRunResult,
} from '@polenta/types'

/**
 * GH36 sprint 2 — relecture d'un classeur d'exécution rempli (specs/GH36-design.md §3.4).
 * `readExecutionWorkbook` (exceljs) ne fait qu'extraire les cellules ; `validateExecutionImport`
 * (pur) applique les règles de la spec §4.2 contre la campagne courante.
 */

export interface RawExecutionRow {
  /** N° de ligne Excel (1-based), pour les messages. */
  row: number
  key: string
  text: string
  verdict: string
  tester: string
  date: Date | string | number | null
  comment: string
}

export interface RawExecutionSheet {
  formatVersion: string
  campaignId: string
  /** Instances exportées, dans l'ordre de la campagne au moment de l'export. */
  instances: { entryId: string; testCaseId: string; orders: number[]; testFound: boolean }[]
  rows: RawExecutionRow[]
  /** Lignes sans clé technique mais avec une saisie (ajoutées par le testeur). */
  rowsWithoutKey: number[]
}

const col = (c: ExecutionSheetColumn) => EXECUTION_SHEET_COLUMNS.indexOf(c) + 1

/** Texte d'une cellule exceljs, quel que soit son type (texte riche, formule, lien…). */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map(r => r.text).join('')
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('result' in value) return cellText((value as { result?: ExcelJS.CellValue }).result ?? null)
  }
  return ''
}

function dateCell(value: ExcelJS.CellValue): Date | string | number | null {
  // Formule (`=AUJOURDHUI()`…) : sa valeur calculée, enregistrée par Excel dans le fichier.
  if (value && typeof value === 'object' && !(value instanceof Date) && 'result' in value) {
    return dateCell((value as { result?: ExcelJS.CellValue }).result ?? null)
  }
  if (value instanceof Date || typeof value === 'number') return value
  const text = cellText(value).trim()
  return text || null
}

export async function readExecutionWorkbook(filePath: string): Promise<RawExecutionSheet | { fatal: ExecutionImportFatal }> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.readFile(filePath)
  } catch {
    return { fatal: { code: 'unreadable' } }
  }

  const meta = workbook.getWorksheet(EXECUTION_SHEET_META_NAME)
  // Feuille de saisie : la première feuille autre que `_polenta` (son nom dépend de la langue).
  const sheet = workbook.worksheets.find(ws => ws.name !== EXECUTION_SHEET_META_NAME)
  if (!meta || !sheet) return { fatal: { code: 'not_an_execution_sheet' } }

  const props = new Map<string, string>()
  const instances: RawExecutionSheet['instances'] = []
  let inInstances = false
  meta.eachRow(r => {
    const first = cellText(r.getCell(1).value).trim()
    if (!first) return
    if (first === 'entryId') {
      inInstances = true
      return
    }
    if (!inInstances) {
      props.set(first, cellText(r.getCell(2).value).trim())
      return
    }
    const orders = cellText(r.getCell(3).value).split(',').map(s => s.trim()).filter(Boolean).map(Number)
    instances.push({
      entryId: first,
      testCaseId: cellText(r.getCell(2).value).trim(),
      orders,
      testFound: cellText(r.getCell(4).value).trim() !== '0',
    })
  })
  const campaignId = props.get('campaignId')
  if (!campaignId) return { fatal: { code: 'not_an_execution_sheet' } }

  const rows: RawExecutionRow[] = []
  const rowsWithoutKey: number[] = []
  for (let r = EXECUTION_SHEET_HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const get = (c: ExecutionSheetColumn) => cellText(row.getCell(col(c)).value).trim()
    const key = get('key')
    const raw: RawExecutionRow = {
      row: r,
      key,
      text: get('text'),
      verdict: get('verdict'),
      tester: get('tester'),
      date: dateCell(row.getCell(col('date')).value),
      // Pas de trim des lignes intérieures : le commentaire garde sa mise en page.
      comment: cellText(row.getCell(col('comment')).value).replace(/\r\n?/g, '\n').trim(),
    }
    if (key) rows.push(raw)
    else if (raw.verdict || raw.tester || raw.date !== null || raw.comment) rowsWithoutKey.push(r)
  }

  return { formatVersion: props.get('formatVersion') ?? '', campaignId, instances, rows, rowsWithoutKey }
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ExecutionImportContext {
  campaign: TestCampaign
  /** Testeur retenu quand la colonne est vide (identité git de l'utilisateur qui importe). */
  fallbackUser: string
  /** Date d'import (ISO), retenue quand la colonne Date est vide. */
  now: string
  filePath: string
}

export function validateExecutionImport(
  raw: RawExecutionSheet | { fatal: ExecutionImportFatal },
  ctx: ExecutionImportContext,
): ExecutionImportPreview {
  const preview: ExecutionImportPreview = {
    filePath: ctx.filePath,
    fileName: path.basename(ctx.filePath),
    importable: [],
    errors: [],
    warnings: [],
    unfilledCount: 0,
  }
  const fatal = 'fatal' in raw ? raw.fatal : fatalOf(raw, ctx.campaign)
  if (fatal) return { ...preview, fatal }
  const sheet = raw as RawExecutionSheet

  preview.warnings = sheet.rowsWithoutKey.map(row => ({ code: 'row_without_key' as const, row }))

  // Lignes regroupées par instance (clé `entryId` ou `entryId#order`), indépendamment de leur
  // position : un tri ou un filtre fait dans Excel est sans effet.
  const byEntry = new Map<string, { instance?: RawExecutionRow; steps: { order: number; row: RawExecutionRow }[] }>()
  for (const row of sheet.rows) {
    const hash = row.key.lastIndexOf('#')
    const entryId = hash === -1 ? row.key : row.key.slice(0, hash)
    const group = byEntry.get(entryId) ?? { steps: [] }
    if (hash === -1) group.instance = row
    else group.steps.push({ order: Number(row.key.slice(hash + 1)), row })
    byEntry.set(entryId, group)
  }

  const metaById = new Map(sheet.instances.map(i => [i.entryId, i]))
  const entryIds = [...sheet.instances.map(i => i.entryId), ...[...byEntry.keys()].filter(id => !metaById.has(id))]

  for (const entryId of entryIds) {
    const group = byEntry.get(entryId)
    if (!group) continue
    const filled = !!group.instance?.verdict || group.steps.some(s => s.row.verdict)
    if (!filled) {
      preview.unfilledCount++
      continue
    }
    const result = validateInstance(entryId, group, metaById.get(entryId), ctx)
    if ('error' in result) preview.errors.push({ entryId, error: result.error })
    else preview.importable.push(result.instance)
  }
  return preview
}

function fatalOf(sheet: RawExecutionSheet, campaign: TestCampaign): ExecutionImportFatal | undefined {
  if (sheet.formatVersion !== String(EXECUTION_SHEET_FORMAT_VERSION)) {
    return { code: 'unsupported_version', version: sheet.formatVersion }
  }
  if (sheet.campaignId !== campaign.id) return { code: 'wrong_campaign', fileCampaignId: sheet.campaignId }
  if (campaign.status === 'completed' || campaign.status === 'abandoned') {
    return { code: 'campaign_closed', status: campaign.status }
  }
  return undefined
}

function validateInstance(
  entryId: string,
  group: { instance?: RawExecutionRow; steps: { order: number; row: RawExecutionRow }[] },
  meta: RawExecutionSheet['instances'][number] | undefined,
  ctx: ExecutionImportContext,
): { instance: ImportedInstance } | { error: ExecutionImportInstanceError } {
  const run = ctx.campaign.runs.find(r => r.entryId === entryId)
  if (!run || !meta) return { error: { code: 'entry_not_found' } }
  if (!meta.testFound) return { error: { code: 'test_not_found', testCaseId: meta.testCaseId } }

  const found = group.steps.map(s => s.order).sort((a, b) => a - b)
  const expected = [...meta.orders].sort((a, b) => a - b)
  if (!group.instance || found.length !== expected.length || found.some((o, i) => o !== expected[i])) {
    return { error: { code: 'steps_mismatch', expected, found } }
  }

  const stepResults: ImportedInstance['stepResults'] = []
  for (const { order, row } of [...group.steps].sort((a, b) => a.order - b.order)) {
    let result: StepResultValue = 'NOT_EXECUTED'
    if (row.verdict) {
      const parsed = parseStepVerdict(row.verdict)
      if (!parsed) return { error: { code: 'invalid_verdict', row: row.row, value: row.verdict } }
      result = parsed
    }
    stepResults.push({ order, result, comment: plainTextToMarkdown(row.comment) })
  }

  const head = group.instance
  let result: TestRunResult
  let resultForced = false
  if (head.verdict) {
    const parsed = parseGlobalVerdict(head.verdict)
    if (!parsed) return { error: { code: 'invalid_verdict', row: head.row, value: head.verdict } }
    result = parsed
    resultForced = true
  } else {
    result = computeGlobalResult(stepResults.map(s => s.result))
  }

  let executedAt = ctx.now
  if (head.date !== null) {
    const parsed = parseExecutionDate(head.date)
    if (!parsed) return { error: { code: 'invalid_date', row: head.row, value: String(head.date instanceof Date ? head.date.toISOString() : head.date) } }
    executedAt = parsed
  }

  const title = run.testSnapshot?.title ?? head.text.split(' — ').slice(1).join(' — ')
  return {
    instance: {
      entryId,
      testCaseId: run.testCaseId,
      ...(run.requirementId && { requirementId: run.requirementId }),
      title,
      previousStatus: run.status,
      result,
      resultForced,
      executedBy: head.tester || ctx.fallbackUser,
      executedAt,
      notes: plainTextToMarkdown(head.comment),
      stepResults,
    },
  }
}

/** Règle SPEC-TESTS §3.3 (identique à l'écran d'exécution). */
export function computeGlobalResult(steps: StepResultValue[]): TestRunResult {
  if (steps.some(r => r === 'FAIL')) return 'FAIL'
  if (steps.some(r => r === 'BLOCKED')) return 'BLOCKED'
  if (steps.some(r => r === 'NOT_EXECUTED')) return 'INCOMPLETE'
  return 'PASS'
}

/**
 * Date d'exécution saisie → ISO. Excel ne stocke pas de fuseau : une cellule date est lue par
 * exceljs en UTC, ses composantes sont donc réinterprétées en heure locale. Texte accepté :
 * `AAAA-MM-JJ[ HH:mm]` et `JJ/MM/AAAA[ HH:mm]`. Sans heure (ou 00:00 sur une cellule date) : midi
 * local, pour ne pas changer de jour une fois converti en UTC. `null` si illisible.
 */
export function parseExecutionDate(value: Date | string | number): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return localIso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate(),
      value.getUTCHours(), value.getUTCMinutes(), value.getUTCHours() === 0 && value.getUTCMinutes() === 0)
  }
  if (typeof value === 'number') {
    // Numéro de série Excel saisi dans une cellule sans format date.
    if (!(value > 0 && value < 2958466)) return null
    return parseExecutionDate(new Date(Math.round((value - 25569) * 86400000)))
  }
  const text = value.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(text)
  if (m) return localIso(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, !m[4])
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(text)
  if (m) return localIso(+m[3], +m[2], +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, !m[4])
  return null
}

function localIso(y: number, mo: number, d: number, h: number, mi: number, noon: boolean): string | null {
  const hours = noon ? 12 : h
  const date = new Date(y, mo - 1, d, hours, mi)
  const valid = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
    && date.getHours() === hours && date.getMinutes() === mi
  return valid ? date.toISOString() : null
}

/**
 * Commentaire saisi en texte brut → Markdown du richtext : une ligne non vide = un paragraphe,
 * caractères Markdown échappés (y compris les marqueurs de liste en début de ligne) pour que la
 * relecture affiche exactement le texte saisi.
 */
export function plainTextToMarkdown(text: string): string {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line
      .replace(/([\\`*_[\]#<>|~])/g, '\\$1')
      .replace(/^([-+])(\s)/, '\\$1$2')
      .replace(/^(\d+)\.(\s)/, '$1\\.$2'))
    .join('\n\n')
}
