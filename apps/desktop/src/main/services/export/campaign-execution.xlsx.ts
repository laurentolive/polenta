import ExcelJS from 'exceljs'
import {
  EXECUTION_SHEET_COLUMNS, EXECUTION_SHEET_FORMAT_VERSION, EXECUTION_SHEET_HEADER_ROW,
  EXECUTION_SHEET_LABELS, EXECUTION_SHEET_META_NAME, executionFieldColumnId, formatRequiredWhenText,
  readLinkValues, substituteRunParams,
} from '@polenta/types'
import type {
  CampaignTestRun, ExecutionSheetColumn, ExecutionSheetFieldColumn, ExecutionSheetLabels, ExecutionSheetLocale,
  ObjectTypeDefinition, TestCampaign, TestCase, TestRun,
} from '@polenta/types'
import { writeLinkCell } from './link-cell.util'
import { instanceSignature, readSheetRows } from './campaign-execution-import'

/** GH196 — valeurs déjà saisies (dernier run de l'instance), recopiées dans les cases jaunes. */
export interface RowPrefill {
  verdict?: string
  tester?: string
  /** Date « Excel » : composantes UTC = heure locale (une cellule date n'a pas de fuseau). */
  date?: Date
  comment?: string
  fields?: Record<string, unknown>
}
import { markdownToPlainText } from './template/markdown-to-text'
import { BRAND } from '../../../shared/brand'

/**
 * GH36 — classeur Excel d'exécution hors outil (specs/GH36-design.md §3.3). Deux niveaux :
 * `buildExecutionSheetModel` (pur, testable sans exceljs) décide du contenu ligne par ligne ;
 * `writeExecutionWorkbook` s'occupe de la mise en forme, de la protection, des listes déroulantes et
 * de la feuille technique `_polenta` que l'import (sprint 2) relit.
 */

export type ExecutionSheetRow =
  | {
      kind: 'instance'
      key: string
      entryId: string
      text: string
      expected: string
      requirementId: string
      params: string
      currentStatus: string
      /** GH196 — colonnes de champ saisissables sur cette ligne (champs d'exécution du type). */
      fieldIds: string[]
      prefill?: RowPrefill
    }
  | {
      kind: 'step'
      key: string
      order: number
      text: string
      expected: string
      /** GH196 — colonnes de champ saisissables sur cette ligne (champs d'étape du type). */
      fieldIds: string[]
      prefill?: RowPrefill
    }

export interface ExecutionSheetModel {
  locale: ExecutionSheetLocale
  campaignId: string
  title: string
  baselineRef?: string
  exportedAt: string
  rows: ExecutionSheetRow[]
  /** GH196 — colonnes des champs d'exécution puis d'étape, union des types de la campagne (un nom =
   *  une colonne, Q6), dans l'ordre de première apparition. */
  fieldColumns: ExecutionSheetFieldColumn[]
  /** Une entrée par instance, dans l'ordre de la campagne — recopiée dans `_polenta`. */
  instances: { entryId: string; testCaseId: string; orders: number[]; testFound: boolean; fingerprint?: string; prefilled?: boolean }[]
}

export interface ExecutionSheetEntry {
  run: CampaignTestRun
  /** Version effective (GH81) ; absent : test source introuvable. Paramètres non substitués. */
  test?: TestCase
  /** GH81 — empreinte de `test`, contrôlée à l'import. */
  fingerprint?: string
  /** GH196 — type du test (champs d'exécution / d'étape) ; absent : pas de colonne de champ. */
  typeDef?: Pick<ObjectTypeDefinition, 'runFields' | 'stepFields'> | null
  /** GH196 — run du résultat déjà saisi (instance exécutée) : valeurs recopiées dans le classeur. */
  prefill?: TestRun
}

/** Instant ISO → `Date` dont les composantes UTC sont l'heure locale (relue telle quelle à l'import). */
function excelDate(iso: string): Date | undefined {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()))
}

/** GH196 — union ordonnée des colonnes de champs : tous les champs d'exécution, puis d'étape. */
function fieldColumnsOf(entries: ExecutionSheetEntry[]): ExecutionSheetFieldColumn[] {
  const out: ExecutionSheetFieldColumn[] = []
  for (const list of ['runFields', 'stepFields'] as const) {
    for (const { typeDef, test } of entries) {
      if (!test) continue
      for (const field of typeDef?.[list] ?? []) {
        const id = executionFieldColumnId(list, field.name)
        if (!out.some(c => c.id === id)) out.push({ id, list, field })
      }
    }
  }
  return out
}

/** Clé technique d'une ligne d'étape (colonne A masquée) ; une ligne d'instance a pour clé son `entryId`. */
export function stepRowKey(entryId: string, order: number): string {
  return `${entryId}#${order}`
}

export function buildExecutionSheetModel(input: {
  campaign: TestCampaign
  entries: ExecutionSheetEntry[]
  locale: ExecutionSheetLocale
  exportedAt: string
}): ExecutionSheetModel {
  const labels = EXECUTION_SHEET_LABELS[input.locale]
  const rows: ExecutionSheetRow[] = []
  const instances: ExecutionSheetModel['instances'] = []
  const fieldColumns = fieldColumnsOf(input.entries)

  for (const { run, test, fingerprint, typeDef, prefill } of input.entries) {
    const plain = (md: string | null | undefined) => (md ? markdownToPlainText(md).trim() : '')
    const idsOf = (list: 'runFields' | 'stepFields') => (test ? (typeDef?.[list] ?? []).map(f => executionFieldColumnId(list, f.name)) : [])
    const steps = [...(test?.steps ?? [])].sort((a, b) => a.order - b.order)
    const text = (md: string | null | undefined) => richtextToCellText(substituteRunParams(md ?? '', run), labels)

    const conditions = test
      ? [
          [labels.preconditions, text(test.preconditions)],
          [labels.postconditions, text(test.postconditions)],
        ].filter(([, value]) => value).map(([label, value]) => `${label} :\n${value}`).join('\n\n')
      : ''

    rows.push({
      kind: 'instance',
      key: run.entryId,
      entryId: run.entryId,
      text: test ? `${test.id} — ${test.title}` : `${run.testCaseId} — ${labels.testNotFound}`,
      expected: conditions,
      requirementId: run.requirementId ?? '',
      params: formatParams(run),
      currentStatus: labels.runStatuses[run.status] ?? run.status,
      fieldIds: idsOf('runFields'),
      ...(prefill && test && {
        prefill: {
          verdict: labels.globalVerdicts[prefill.result],
          tester: prefill.executedBy,
          date: excelDate(prefill.executedAt),
          comment: plain(prefill.notes),
          fields: prefill.fields,
        },
      }),
    })
    for (const step of steps) {
      rows.push({
        kind: 'step',
        key: stepRowKey(run.entryId, step.order),
        order: step.order,
        text: text(step.action),
        expected: text(step.expectedResult),
        fieldIds: idsOf('stepFields'),
        ...((): { prefill?: RowPrefill } => {
          const sr = prefill?.stepResults.find(s => s.order === step.order)
          if (!sr || sr.result === 'NOT_EXECUTED') return {}
          return { prefill: { verdict: labels.stepVerdicts[sr.result], comment: plain(sr.comment), fields: sr.fields } }
        })(),
      })
    }
    instances.push({
      entryId: run.entryId, testCaseId: run.testCaseId, orders: steps.map(s => s.order), testFound: !!test,
      ...(test && fingerprint && { fingerprint }),
      ...(test && prefill && { prefilled: true }),
    })
  }

  return {
    locale: input.locale,
    campaignId: input.campaign.id,
    title: input.campaign.title,
    baselineRef: input.campaign.baselineRef || undefined,
    exportedAt: input.exportedAt,
    rows,
    fieldColumns,
    instances,
  }
}

/** Valeurs figées de l'instance, `réf = valeur`, une par ligne, triées par référence. */
function formatParams(run: CampaignTestRun): string {
  const values = { ...(run.paramValues ?? {}), ...(run.resolvedParams ?? {}) }
  return Object.keys(values)
    .sort((a, b) => a.localeCompare(b))
    .filter(k => (values[k] ?? '').trim())
    .map(k => `${k} = ${values[k]}`)
    .join('\n')
}

// Blocs image / draw.io (SPEC-REQ §3.2a-b) : `markdownToPlainText` les omet, le testeur doit
// pourtant savoir qu'il manque une illustration → repère textuel à leur place.
const FENCED_FIGURE_RE = /^([ \t]*)(`{3,}|~{3,})[ \t]*(image|drawio)\b[^\n]*\n[\s\S]*?^[ \t]*\2[ \t]*$/gm
const INLINE_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g

function richtextToCellText(markdown: string, labels: ExecutionSheetLabels): string {
  if (!markdown.trim()) return ''
  const marked = markdown
    .replace(FENCED_FIGURE_RE, (_m, indent: string, _fence: string, info: string) =>
      `${indent}${info === 'drawio' ? labels.diagram : labels.image}`)
    .replace(INLINE_IMAGE_RE, labels.image)
  return markdownToPlainText(marked).trim()
}

// ─── Écriture exceljs ─────────────────────────────────────────────────────────

const COLUMN_WIDTHS: Record<ExecutionSheetColumn, number> = {
  key: 18, instance: 14, step: 6, text: 42, expected: 32,
  verdict: 14, tester: 16, date: 16, comment: 40,
  requirement: 13, params: 26, currentStatus: 13,
}
const WRAPPED: ExecutionSheetColumn[] = ['text', 'expected', 'params', 'comment']
/** Colonnes saisissables par type de ligne (spec §3.2). */
const EDITABLE: Record<ExecutionSheetRow['kind'], ExecutionSheetColumn[]> = {
  instance: ['verdict', 'tester', 'date', 'comment'],
  step: ['verdict', 'comment'],
}

const INPUT_COLUMNS = new Set<ExecutionSheetColumn>([...EDITABLE.instance, ...EDITABLE.step])

const FILL_INSTANCE = 'FFDCE6F2'
const FILL_LOCKED = 'FFF2F2F2'
const FILL_HEADER = 'FF1F3864'
/** Cases à remplir par le testeur (et leurs en-têtes) : jaune, repère explicite du bandeau. */
const FILL_INPUT = 'FFFFF2CC'
const FILL_INPUT_HEADER = 'FFBF8F00'
const FONT_HEADER = 'FFFFFFFF'

const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

/** Formule d'une liste déroulante Excel : valeurs entre guillemets, séparées par des virgules. */
function listFormula(values: string[]): string {
  return `"${values.map(v => v.replace(/"/g, '""')).join(',')}"`
}

/** GH196 — colonnes de la feuille : fixes jusqu'à « Commentaire », champs, puis colonnes d'information. */
type SheetColumn = { kind: 'fixed'; c: ExecutionSheetColumn } | { kind: 'field'; col: ExecutionSheetFieldColumn }

function sheetColumns(fieldColumns: ExecutionSheetFieldColumn[]): SheetColumn[] {
  const fixed = EXECUTION_SHEET_COLUMNS.map((c): SheetColumn => ({ kind: 'fixed', c }))
  const cut = EXECUTION_SHEET_COLUMNS.indexOf('comment') + 1
  return [...fixed.slice(0, cut), ...fieldColumns.map((col): SheetColumn => ({ kind: 'field', col })), ...fixed.slice(cut)]
}

const columnId = (sc: SheetColumn) => (sc.kind === 'fixed' ? sc.c : sc.col.id)

/** Commentaire d'en-tête d'une colonne de champ : type, valeurs, obligation en clair. */
function fieldNote(col: ExecutionSheetFieldColumn, model: ExecutionSheetModel): string {
  const f = col.field
  const fr = model.locale === 'fr'
  const lines = [`${fr ? 'Type' : 'Type'} : ${f.type}`]
  if (f.values?.length) lines.push(`${fr ? 'Valeurs' : 'Values'} : ${f.values.join(', ')}`)
  if (f.type === 'boolean') lines.push(fr ? 'Oui / Non' : 'Yes / No')
  if (f.type === 'link') lines.push(fr ? 'Lien hypertexte, URL ou « libellé | URL », un par ligne' : 'Hyperlink, URL or “label | URL”, one per line')
  if (f.required) lines.push(fr ? 'Obligatoire' : 'Required')
  if (f.requiredWhen) lines.push(`${fr ? 'Obligatoire si' : 'Required if'} ${formatRequiredWhenText(f.requiredWhen)}`)
  return lines.join('\n')
}

export async function writeExecutionWorkbook(model: ExecutionSheetModel, destPath: string): Promise<void> {
  const workbook = await buildExecutionWorkbook(model)
  await workbook.xlsx.writeFile(destPath)
}

/** Classeur en mémoire (séparé de l'écriture pour le script de contrôle). */
export async function buildExecutionWorkbook(model: ExecutionSheetModel): Promise<ExcelJS.Workbook> {
  const labels = EXECUTION_SHEET_LABELS[model.locale]
  const columns = sheetColumns(model.fieldColumns ?? [])
  const colIndex = (c: ExecutionSheetColumn) => columns.findIndex(sc => sc.kind === 'fixed' && sc.c === c) + 1
  const workbook = new ExcelJS.Workbook()
  workbook.creator = BRAND.productName
  const sheet = workbook.addWorksheet(labels.sheetName, {
    // Volet figé : en-têtes + colonnes Clé/Instance/Étape (repère en défilement horizontal).
    views: [{ state: 'frozen', ySplit: EXECUTION_SHEET_HEADER_ROW, xSplit: colIndex('step') }],
    properties: { outlineProperties: { summaryBelow: false, summaryRight: false } },
  })

  columns.forEach((sc, i) => {
    const column = sheet.getColumn(i + 1)
    column.width = sc.kind === 'fixed' ? COLUMN_WIDTHS[sc.c] : (sc.col.field.type === 'link' || sc.col.field.type === 'richtext' ? 32 : 16)
    if (sc.kind === 'fixed' && sc.c === 'key') column.hidden = true
  })

  // En-tête du classeur (lignes 1-3).
  const title = sheet.getCell(1, colIndex('instance'))
  title.value = `${model.campaignId} — ${model.title}`
  title.font = { bold: true, size: 14 }
  const exported = new Date(model.exportedAt)
  sheet.getCell(2, colIndex('instance')).value = [
    `${labels.exportedAt} ${exported.toLocaleString(model.locale === 'fr' ? 'fr-FR' : 'en-GB')}`,
    model.baselineRef ? `${labels.baseline} : ${model.baselineRef}` : '',
  ].filter(Boolean).join(' · ')
  const banner = sheet.getCell(3, colIndex('instance'))
  banner.value = labels.banner
  banner.font = { italic: true, color: { argb: 'FFC00000' } }

  const header = sheet.getRow(EXECUTION_SHEET_HEADER_ROW)
  columns.forEach((sc, i) => {
    const cell = header.getCell(i + 1)
    const input = sc.kind === 'field' || INPUT_COLUMNS.has(sc.c)
    cell.value = sc.kind === 'fixed' ? labels.headers[sc.c] : `${sc.col.field.label ?? sc.col.field.name}${sc.col.field.required ? ' *' : ''}`
    if (sc.kind === 'field') cell.note = fieldNote(sc.col, model)
    cell.font = { bold: true, color: { argb: FONT_HEADER } }
    cell.fill = solid(input ? FILL_INPUT_HEADER : FILL_HEADER)
    cell.alignment = { vertical: 'middle', wrapText: true }
  })

  const globalList = listFormula(Object.values(labels.globalVerdicts))
  const stepList = listFormula(Object.values(labels.stepVerdicts))
  const booleanWords = model.locale === 'fr' ? ['Oui', 'Non'] : ['Yes', 'No']
  const booleanList = listFormula(booleanWords)

  let rowNumber = EXECUTION_SHEET_HEADER_ROW
  for (const r of model.rows) {
    rowNumber++
    const row = sheet.getRow(rowNumber)
    const values: Partial<Record<ExecutionSheetColumn, string | number>> = r.kind === 'instance'
      ? {
          key: r.key, instance: r.entryId, text: r.text, expected: r.expected,
          requirement: r.requirementId, params: r.params, currentStatus: r.currentStatus,
        }
      : { key: r.key, step: r.order, text: r.text, expected: r.expected }

    const editable = new Set<string>([...EDITABLE[r.kind], ...r.fieldIds])
    const lockedFill = solid(r.kind === 'instance' ? FILL_INSTANCE : FILL_LOCKED)
    columns.forEach((sc, i) => {
      const cell = row.getCell(i + 1)
      const id = columnId(sc)
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } }
      if (sc.kind === 'field') {
        const f = sc.col.field
        cell.alignment = { vertical: 'top', wrapText: f.type === 'link' || f.type === 'richtext' || f.type === 'textarea' }
        if (!editable.has(id)) { cell.fill = lockedFill; return }        // sans objet : grisée, verrouillée
        cell.protection = { locked: false }
        cell.fill = solid(FILL_INPUT)
        const existing = r.prefill?.fields?.[f.name]
        if (existing !== undefined && existing !== null && existing !== '') {
          // GH196 — valeur déjà saisie (dernier run).
          if (f.type === 'link') writeLinkCell(cell, readLinkValues(existing))
          else if (f.type === 'boolean') cell.value = booleanWords[existing === true || existing === 'true' ? 0 : 1]
          else cell.value = typeof existing === 'number' ? existing : String(existing)
        } else if (f.default !== undefined && f.default !== '') {
          // Q7 — valeur par défaut pré-remplie.
          if (f.type === 'link') writeLinkCell(cell, readLinkValues(f.default))
          else if (f.type === 'boolean') cell.value = booleanWords[String(f.default) === 'true' ? 0 : 1]
          else cell.value = f.type === 'number' && Number.isFinite(Number(f.default)) ? Number(f.default) : String(f.default)
        }
        // Liste déroulante seulement si Excel peut la porter (pas de virgule, 255 caractères au plus) ;
        // sinon les valeurs restent dans le commentaire d'en-tête.
        const enumList = f.type === 'enum' && f.values?.length && f.values.every(v => !v.includes(',')) ? listFormula(f.values) : null
        const list = enumList && enumList.length <= 257 ? enumList : f.type === 'boolean' ? booleanList : null
        if (list) {
          cell.dataValidation = { type: 'list', allowBlank: true, formulae: [list], showErrorMessage: f.type === 'boolean' || f.type === 'enum', errorTitle: f.label ?? f.name }
        }
        return
      }
      const c = sc.c
      const value = values[c]
      if (value !== undefined && value !== '') cell.value = value
      // GH196 — résultat déjà saisi recopié dans les cases jaunes.
      const pre = r.prefill
      if (pre && c === 'verdict' && pre.verdict) cell.value = pre.verdict
      if (pre && c === 'tester' && pre.tester) cell.value = pre.tester
      if (pre && c === 'date' && pre.date) cell.value = pre.date
      if (pre && c === 'comment' && pre.comment) cell.value = pre.comment
      cell.alignment = { vertical: 'top', wrapText: WRAPPED.includes(c) }
      if (editable.has(c)) {
        cell.protection = { locked: false }
        cell.fill = solid(FILL_INPUT)
      } else {
        cell.fill = lockedFill
      }
      if (c === 'verdict') {
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [r.kind === 'instance' ? globalList : stepList],
          showErrorMessage: true,
          errorTitle: labels.headers.verdict,
          error: Object.values(r.kind === 'instance' ? labels.globalVerdicts : labels.stepVerdicts).join(', '),
        }
      }
      if (c === 'date' && r.kind === 'instance') cell.numFmt = model.locale === 'fr' ? 'dd/mm/yyyy hh:mm' : 'yyyy-mm-dd hh:mm'
    })
    if (r.kind === 'instance') {
      row.font = { bold: true }
    } else {
      row.outlineLevel = 1
    }
  }

  sheet.autoFilter = {
    from: { row: EXECUTION_SHEET_HEADER_ROW, column: 1 },
    to: { row: Math.max(rowNumber, EXECUTION_SHEET_HEADER_ROW), column: columns.length },
  }
  // Sans mot de passe : guide le testeur sans le bloquer, la vraie garantie est la validation à
  // l'import. Excel refuse le tri d'une plage contenant des cellules verrouillées même avec
  // `sort: true` (filtre OK) — sans effet sur l'import, qui identifie les lignes par leur clé.
  await sheet.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatColumns: true,
    formatRows: true,
    autoFilter: true,
    sort: true,
  })

  const meta = workbook.addWorksheet(EXECUTION_SHEET_META_NAME, { state: 'veryHidden' })
  meta.addRow(['formatVersion', EXECUTION_SHEET_FORMAT_VERSION])
  meta.addRow(['campaignId', model.campaignId])
  meta.addRow(['exportedAt', model.exportedAt])
  meta.addRow(['locale', model.locale])
  // GH196 — carte des colonnes de la feuille de saisie : la lecture d'un v3 se fait par elle.
  meta.addRow(['columns', ...columns.map(columnId)])
  meta.addRow([])
  // GH196 — signature des valeurs pré-remplies, relues comme à l'import : une instance non modifiée
  // dans le fichier rempli est reconnue et ignorée.
  const { rows: written } = readSheetRows(sheet, columns.map(columnId))
  const signatureOf = (entryId: string) =>
    instanceSignature(written.filter(r => r.key === entryId || r.key.startsWith(`${entryId}#`)))
  meta.addRow(['entryId', 'testCaseId', 'orders', 'testFound', 'fingerprint', 'prefill'])
  for (const inst of model.instances) {
    meta.addRow([inst.entryId, inst.testCaseId, inst.orders.join(','), inst.testFound ? 1 : 0, inst.fingerprint ?? '',
      inst.prefilled ? signatureOf(inst.entryId) : ''])
  }

  return workbook
}
