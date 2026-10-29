import * as path from 'path'
import ExcelJS from 'exceljs'
import {
  EXECUTION_SHEET_COLUMNS, EXECUTION_SHEET_HEADER_ROW, EXECUTION_SHEET_META_NAME, EXECUTION_SHEET_SUPPORTED_VERSIONS,
  convertFieldValue, executionFieldColumnId, parseGlobalVerdict, parseStepVerdict, prepareRunFields,
} from '@polenta/types'
import type {
  ExecutionImportFatal, ExecutionImportInstanceError, ExecutionImportPreview, ExecutionSheetColumn,
  ImportedInstance, ObjectTypeDefinition, SchemaField, StepResultValue, TestCampaign, TestCase, TestRunResult,
} from '@polenta/types'
import { readLinkCell } from './link-cell.util'

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
  /** GH196 — cellules des colonnes de champ (v3), par id de colonne (`run:<nom>` / `step:<nom>`). */
  fields: Record<string, { value: ExcelJS.CellValue; address: string }>
}

export interface RawExecutionSheet {
  formatVersion: string
  campaignId: string
  /** Instances exportées, dans l'ordre de la campagne au moment de l'export ; `fingerprint` : v2 (GH81) ;
   *  `prefill` (GH196) : signature des valeurs pré-remplies d'une instance déjà exécutée. */
  instances: { entryId: string; testCaseId: string; orders: number[]; testFound: boolean; fingerprint?: string; prefill?: string }[]
  rows: RawExecutionRow[]
  /** Lignes sans clé technique mais avec une saisie (ajoutées par le testeur). */
  rowsWithoutKey: number[]
}

/** Lettre de colonne Excel (1 → A, 27 → AA), pour nommer une cellule dans un message. */
function columnLetter(index: number): string {
  let n = index
  let out = ''
  while (n > 0) {
    const m = (n - 1) % 26
    out = String.fromCharCode(65 + m) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

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
  // GH196 — v3 : carte des colonnes de la feuille de saisie ; v1 / v2 : ordre fixe.
  let columnIds: string[] = [...EXECUTION_SHEET_COLUMNS]
  let inInstances = false
  meta.eachRow(r => {
    const first = cellText(r.getCell(1).value).trim()
    if (!first) return
    if (first === 'entryId') {
      inInstances = true
      return
    }
    if (!inInstances && first === 'columns') {
      const ids: string[] = []
      for (let c = 2; c <= r.cellCount; c++) ids.push(cellText(r.getCell(c).value).trim())
      if (ids.length > 0) columnIds = ids
      return
    }
    if (!inInstances) {
      props.set(first, cellText(r.getCell(2).value).trim())
      return
    }
    const orders = cellText(r.getCell(3).value).split(',').map(s => s.trim()).filter(Boolean).map(Number)
    const fingerprint = cellText(r.getCell(5).value).trim()
    const prefill = cellText(r.getCell(6).value).trim()
    instances.push({
      entryId: first,
      testCaseId: cellText(r.getCell(2).value).trim(),
      orders,
      testFound: cellText(r.getCell(4).value).trim() !== '0',
      ...(fingerprint && { fingerprint }),
      ...(prefill && { prefill }),
    })
  })
  const campaignId = props.get('campaignId')
  if (!campaignId) return { fatal: { code: 'not_an_execution_sheet' } }

  // La carte ne vaut que pour un classeur v3 ; v1 / v2 : ordre fixe des colonnes.
  if (Number(props.get('formatVersion')) < 3) columnIds = [...EXECUTION_SHEET_COLUMNS]
  const { rows, rowsWithoutKey } = readSheetRows(sheet, columnIds)
  return { formatVersion: props.get('formatVersion') ?? '', campaignId, instances, rows, rowsWithoutKey }
}

/**
 * Lignes de la feuille de saisie, lues par la carte des colonnes (`columnIds`, ordre de la feuille).
 * Partagée avec l'export (signature des valeurs pré-remplies, GH196) : même lecture des deux côtés.
 */
export function readSheetRows(sheet: ExcelJS.Worksheet, columnIds: string[]): { rows: RawExecutionRow[]; rowsWithoutKey: number[] } {
  const col = (c: ExecutionSheetColumn) => columnIds.indexOf(c) + 1
  const fieldColumns = columnIds.map((id, i) => ({ id, index: i + 1 })).filter(c => c.id.startsWith('run:') || c.id.startsWith('step:'))
  const rows: RawExecutionRow[] = []
  const rowsWithoutKey: number[] = []
  for (let r = EXECUTION_SHEET_HEADER_ROW + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const fields: RawExecutionRow['fields'] = {}
    for (const fc of fieldColumns) {
      const value = row.getCell(fc.index).value
      if (value !== null && value !== undefined && cellText(value).trim() !== '') fields[fc.id] = { value, address: `${columnLetter(fc.index)}${r}` }
    }
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
      fields,
    }
    if (key) rows.push(raw)
    else if (raw.verdict || raw.tester || raw.date !== null || raw.comment) rowsWithoutKey.push(r)
  }
  return { rows, rowsWithoutKey }
}

/** Valeur de cellule normalisée pour la signature (lien : texte et cible ; date : à la minute). */
function signatureValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : new Date(Math.round(value.getTime() / 60000) * 60000).toISOString()
  if (typeof value === 'object' && 'hyperlink' in (value as object)) {
    const v = value as { text?: unknown; hyperlink?: unknown }
    return `${cellText((v.text ?? '') as ExcelJS.CellValue)}|${String(v.hyperlink ?? '')}`
  }
  return cellText(value as ExcelJS.CellValue).replace(/\r\n?/g, '\n').trim()
}

/**
 * GH196 — signature des valeurs saisissables d'une instance (ligne d'instance puis lignes d'étape) :
 * calculée à l'export sur les valeurs pré-remplies, recalculée à l'import ; égale = instance non
 * modifiée, ignorée (pas de nouveau run).
 */
export function instanceSignature(rows: RawExecutionRow[]): string {
  const sorted = [...rows].sort((a, b) => a.key.localeCompare(b.key))
  return JSON.stringify(sorted.map(r => [
    r.key, r.verdict, r.tester, signatureValue(r.date), r.comment,
    Object.keys(r.fields).sort().map(id => [id, signatureValue(r.fields[id].value)]),
  ]))
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ExecutionImportContext {
  campaign: TestCampaign
  /** Testeur retenu quand la colonne est vide (identité git de l'utilisateur qui importe). */
  fallbackUser: string
  /** Date d'import (ISO), retenue quand la colonne Date est vide. */
  now: string
  filePath: string
  /** GH68 — statut d'approbation d'un test ; absent : aucun avertissement `test_not_approved`. */
  isApproved?: (test: TestCase) => boolean
  /**
   * GH81 — version effective de chaque entrée (`CampaignsService.effectiveTests`) : avertissement
   * `test_not_approved` jugé sur elle, empreinte comparée à celle du classeur.
   */
  effectiveTests?: Map<string, { test: TestCase; resyncable: boolean }>
  /** GH81 — empreinte d'une version de test ; absent : pas de contrôle « test modifié ». */
  fingerprint?: (test: TestCase) => string
  /** GH196 — type du test de chaque entrée (champs d'exécution / d'étape) ; absent : champs ignorés. */
  typeDefs?: Map<string, Pick<ObjectTypeDefinition, 'runFields' | 'stepFields'> | null>
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
    // GH196 — résultat pré-rempli à l'export et non modifié : ignoré (pas de doublon de run).
    const prefill = metaById.get(entryId)?.prefill
    if (prefill && instanceSignature([...(group.instance ? [group.instance] : []), ...group.steps.map(s => s.row)]) === prefill) {
      preview.unchangedCount = (preview.unchangedCount ?? 0) + 1
      continue
    }
    const filled = !!group.instance?.verdict || group.steps.some(s => s.row.verdict)
    if (!filled) {
      preview.unfilledCount++
      continue
    }
    const result = validateInstance(entryId, group, metaById.get(entryId), ctx)
    if ('error' in result) preview.errors.push({ entryId, error: result.error })
    else {
      preview.importable.push(result.instance)
      // GH68 — exécution d'un test non approuvé : signalée, pas refusée ; jugée sur la version
      // effective (GH81 : live pour une instance resynchronisable, copie sinon, live pré-T49).
      const test = ctx.effectiveTests?.get(entryId)?.test
      if (test && ctx.isApproved && !ctx.isApproved(test)) {
        preview.warnings.push({ code: 'test_not_approved', entryId, status: test.status })
      }
    }
  }
  return preview
}

function fatalOf(sheet: RawExecutionSheet, campaign: TestCampaign): ExecutionImportFatal | undefined {
  if (!EXECUTION_SHEET_SUPPORTED_VERSIONS.some(v => sheet.formatVersion === String(v))) {
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

  // GH81 (#75) — le test a changé depuis l'export : les verdicts porteraient sur une autre version.
  // Avant le contrôle des étapes, plus explicite pour une étape insérée ou retirée.
  const effective = ctx.effectiveTests?.get(entryId)?.test
  if (meta.fingerprint && effective && ctx.fingerprint && ctx.fingerprint(effective) !== meta.fingerprint) {
    return { error: { code: 'test_changed_since_export', testCaseId: run.testCaseId } }
  }

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
  const stepRows = [...group.steps].sort((a, b) => a.order - b.order).map(s => s.row)

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

  // GH196 — champs d'exécution (ligne d'instance) et d'étape (lignes d'étape exécutées).
  const typeDef = ctx.typeDefs?.get(entryId)
  let runFields: Record<string, unknown> | undefined
  // Champs saisis mais type du test introuvable : refus plutôt que perte silencieuse (run immuable).
  const filledRow = [head, ...stepRows].find(r => Object.keys(r.fields).length > 0)
  if (ctx.typeDefs && !typeDef && filledRow) {
    return { error: { code: 'invalid_field_value', row: filledRow.row, field: Object.keys(filledRow.fields)[0], message: `type du test ${run.testCaseId} introuvable : champs d'exécution non lisibles` } }
  }
  if (typeDef) {
    const read = (
      defs: SchemaField[], list: 'runFields' | 'stepFields', row: RawExecutionRow,
    ): { error: ExecutionImportInstanceError } | { values: Record<string, unknown> } => {
      const out: Record<string, unknown> = {}
      for (const def of defs) {
        const cell = row.fields[executionFieldColumnId(list, def.name)]
        if (!cell) continue
        let raw: unknown = plainCellValue(cell.value)
        if (def.type === 'link') {
          const links = readLinkCell({ value: cell.value, address: cell.address })
          if (!links.ok) return { error: { code: 'invalid_field_value' as const, row: row.row, field: def.name, message: links.reason } }
          raw = links.links
        }
        const c = convertFieldValue(def, raw)
        if (!c.ok) return { error: { code: 'invalid_field_value' as const, row: row.row, field: def.name, message: c.reason } }
        if (c.value !== undefined) out[def.name] = c.value
      }
      return { values: out }
    }
    const runRead = read(typeDef.runFields ?? [], 'runFields', head)
    if ('error' in runRead) return { error: runRead.error }
    const stepValues: Record<string, unknown>[] = []
    for (const [i, row] of stepRows.entries()) {
      // Q3 — étape non exécutée : ses cellules ne sont ni lues ni contrôlées.
      if (stepResults[i].result === 'NOT_EXECUTED') { stepValues.push({}); continue }
      const sr = read(typeDef.stepFields ?? [], 'stepFields', row)
      if ('error' in sr) return { error: sr.error }
      stepValues.push(sr.values)
    }
    const prepared = prepareRunFields(typeDef, {
      result, fields: runRead.values,
      stepResults: stepResults.map((s, i) => ({ order: s.order, result: s.result, fields: stepValues[i] })),
    })
    if (!prepared.ok) {
      const row = prepared.step !== undefined ? stepRows[stepResults.findIndex(s => s.order === prepared.step)]?.row ?? head.row : head.row
      return { error: { code: 'required_field_missing', row, field: prepared.field, message: prepared.reason } }
    }
    runFields = prepared.fields
    prepared.stepFields.forEach((fields, i) => { if (fields) stepResults[i].fields = fields })
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
      ...(runFields && { fields: runFields }),
    },
  }
}

/** Valeur d'une cellule de champ, hors lien : nombre, booléen ou date gardés, texte sinon. */
function plainCellValue(value: ExcelJS.CellValue): unknown {
  if (typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value
  if (value && typeof value === 'object' && 'result' in value) return plainCellValue((value as { result?: ExcelJS.CellValue }).result ?? null)
  return cellText(value).replace(/\r\n?/g, '\n').trim()
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
