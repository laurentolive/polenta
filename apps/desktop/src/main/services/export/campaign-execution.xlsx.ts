import ExcelJS from 'exceljs'
import {
  EXECUTION_SHEET_COLUMNS, EXECUTION_SHEET_FORMAT_VERSION, EXECUTION_SHEET_HEADER_ROW,
  EXECUTION_SHEET_LABELS, EXECUTION_SHEET_META_NAME, substituteRunParams,
} from '@polenta/types'
import type {
  CampaignTestRun, ExecutionSheetColumn, ExecutionSheetLabels, ExecutionSheetLocale, TestCampaign, TestCase,
} from '@polenta/types'
import { markdownToPlainText } from './template/markdown-to-text'

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
    }
  | {
      kind: 'step'
      key: string
      order: number
      text: string
      expected: string
    }

export interface ExecutionSheetModel {
  locale: ExecutionSheetLocale
  campaignId: string
  title: string
  baselineRef?: string
  exportedAt: string
  rows: ExecutionSheetRow[]
  /** Une entrée par instance, dans l'ordre de la campagne — recopiée dans `_polenta`. */
  instances: { entryId: string; testCaseId: string; orders: number[]; testFound: boolean }[]
}

export interface ExecutionSheetEntry {
  run: CampaignTestRun
  /** `testSnapshot` sinon test live ; absent : test source introuvable. Paramètres non substitués. */
  test?: TestCase
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

  for (const { run, test } of input.entries) {
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
    })
    for (const step of steps) {
      rows.push({
        kind: 'step',
        key: stepRowKey(run.entryId, step.order),
        order: step.order,
        text: text(step.action),
        expected: text(step.expectedResult),
      })
    }
    instances.push({ entryId: run.entryId, testCaseId: run.testCaseId, orders: steps.map(s => s.order), testFound: !!test })
  }

  return {
    locale: input.locale,
    campaignId: input.campaign.id,
    title: input.campaign.title,
    baselineRef: input.campaign.baselineRef || undefined,
    exportedAt: input.exportedAt,
    rows,
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

const colIndex = (c: ExecutionSheetColumn) => EXECUTION_SHEET_COLUMNS.indexOf(c) + 1
const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

/** Formule d'une liste déroulante Excel : valeurs entre guillemets, séparées par des virgules. */
function listFormula(values: string[]): string {
  return `"${values.map(v => v.replace(/"/g, '""')).join(',')}"`
}

export async function writeExecutionWorkbook(model: ExecutionSheetModel, destPath: string): Promise<void> {
  const workbook = await buildExecutionWorkbook(model)
  await workbook.xlsx.writeFile(destPath)
}

/** Classeur en mémoire (séparé de l'écriture pour le script de contrôle). */
export async function buildExecutionWorkbook(model: ExecutionSheetModel): Promise<ExcelJS.Workbook> {
  const labels = EXECUTION_SHEET_LABELS[model.locale]
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Polenta'
  const sheet = workbook.addWorksheet(labels.sheetName, {
    // Volet figé : en-têtes + colonnes Clé/Instance/Étape (repère en défilement horizontal).
    views: [{ state: 'frozen', ySplit: EXECUTION_SHEET_HEADER_ROW, xSplit: EXECUTION_SHEET_COLUMNS.indexOf('step') + 1 }],
    properties: { outlineProperties: { summaryBelow: false, summaryRight: false } },
  })

  EXECUTION_SHEET_COLUMNS.forEach((c, i) => {
    const column = sheet.getColumn(i + 1)
    column.width = COLUMN_WIDTHS[c]
    if (c === 'key') column.hidden = true
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
  EXECUTION_SHEET_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = labels.headers[c]
    cell.font = { bold: true, color: { argb: FONT_HEADER } }
    cell.fill = solid(INPUT_COLUMNS.has(c) ? FILL_INPUT_HEADER : FILL_HEADER)
    cell.alignment = { vertical: 'middle', wrapText: true }
  })

  const globalList = listFormula(Object.values(labels.globalVerdicts))
  const stepList = listFormula(Object.values(labels.stepVerdicts))

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

    const editable = new Set(EDITABLE[r.kind])
    EXECUTION_SHEET_COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      const value = values[c]
      if (value !== undefined && value !== '') cell.value = value
      cell.alignment = { vertical: 'top', wrapText: WRAPPED.includes(c) }
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } }
      if (editable.has(c)) {
        cell.protection = { locked: false }
        cell.fill = solid(FILL_INPUT)
      } else {
        cell.fill = solid(r.kind === 'instance' ? FILL_INSTANCE : FILL_LOCKED)
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
    to: { row: Math.max(rowNumber, EXECUTION_SHEET_HEADER_ROW), column: EXECUTION_SHEET_COLUMNS.length },
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
  meta.addRow([])
  meta.addRow(['entryId', 'testCaseId', 'orders', 'testFound'])
  for (const inst of model.instances) {
    meta.addRow([inst.entryId, inst.testCaseId, inst.orders.join(','), inst.testFound ? 1 : 0])
  }

  return workbook
}
