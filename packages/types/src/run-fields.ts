import type { ObjectTypeDefinition, SchemaField } from './schema'
import { parseMultiEnumValue, serializeMultiEnumValue } from './schema'
import { normalizeLinkField } from './field-links'
import {
  activeRequiredWhen, isFieldValueFilled, objectFieldReader, requiredWhenIssues,
  type FieldValueReader, type RequiredWhenIssue,
} from './required-when'
import { EXECUTION_SHEET_LABELS } from './campaign-execution-sheet'

// GH196 — champs personnalisés des exécutions (specs/GH196.md) : `runFields` (un bloc `fields` par run)
// et `stepFields` (un bloc par étape exécutée), déclarés sur les types de test. Conversion des saisies
// (formulaire, classeur Excel : chaînes), contrôle `required` / `requiredWhen` sur le verdict, cohérence
// du schéma (unicité des noms, Q6). Logique pure, partagée par le main (écriture du run, import) et le
// renderer (astérisque dynamique).

export type RunFieldList = 'runFields' | 'stepFields'

/** Pseudo-champ des listes d'exécution : le verdict global (run) ou de l'étape. */
export const RUN_RESULT_KEY = 'result'
export const RUN_RESULT_VALUES = ['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE'] as const
export const STEP_RESULT_VALUES = ['PASS', 'FAIL', 'BLOCKED', 'SKIP', 'NOT_EXECUTED'] as const

/** Types de champ admis dans une liste d'exécution (Q2 : tous sauf `drawio`). */
export function isRunFieldTypeAllowed(type: SchemaField['type']): boolean {
  return type !== 'drawio'
}

/** Lecteur `requiredWhen` d'un run ou d'une étape : `result` = verdict, autres noms = champs de la liste. */
export function runFieldReader(defs: SchemaField[], result: string, fields: Record<string, unknown> | undefined): FieldValueReader {
  const read = objectFieldReader({ fields: defs }, { fields })
  return name => (name === RUN_RESULT_KEY ? (result ? [result] : []) : read(name))
}

export type FieldConversion = { ok: true; value: unknown } | { ok: false; reason: string }

const TRUE_WORDS = new Set(['true', 'oui', 'yes', 'vrai', '1', 'x'])
const FALSE_WORDS = new Set(['false', 'non', 'no', 'faux', '0'])

function isEmpty(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && raw.length === 0)
}

/**
 * Valeur saisie → valeur stockée, selon le type du champ (spec §2, §5.2). Vide → `undefined`.
 * `number` : virgule décimale et espaces acceptés ; `boolean` : oui / non / yes / no / true / false / 1 / 0 ;
 * `enum` / `multi_enum` : valeurs de la liste ; `link` : #195 ; dates : chaîne (ISO pour une `Date`).
 */
export function convertFieldValue(def: SchemaField, raw: unknown): FieldConversion {
  if (isEmpty(raw)) return { ok: true, value: undefined }
  const label = def.label ?? def.name
  const refuse = (expected: string): FieldConversion =>
    ({ ok: false, reason: `valeur refusée pour « ${label} » : "${typeof raw === 'object' ? JSON.stringify(raw) : String(raw)}" (${expected})` })
  switch (def.type) {
    case 'number': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? { ok: true, value: raw } : refuse('nombre attendu')
      const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'))
      return Number.isFinite(n) ? { ok: true, value: n } : refuse('nombre attendu')
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      const word = String(raw).trim().toLowerCase()
      if (TRUE_WORDS.has(word)) return { ok: true, value: true }
      if (FALSE_WORDS.has(word)) return { ok: true, value: false }
      return refuse('oui / non attendu')
    }
    case 'enum': {
      const v = String(raw).trim()
      return !def.values?.length || def.values.includes(v) ? { ok: true, value: v } : refuse(`valeurs : ${def.values.join(', ')}`)
    }
    case 'multi_enum': {
      const values = parseMultiEnumValue(raw)
      const bad = def.values?.length ? values.filter(v => !def.values!.includes(v)) : []
      return bad.length ? refuse(`valeurs : ${def.values!.join(', ')}`) : { ok: true, value: serializeMultiEnumValue(values) }
    }
    case 'link': {
      const n = normalizeLinkField(def, raw)
      return n.ok ? { ok: true, value: n.value } : { ok: false, reason: n.reason }
    }
    case 'date': {
      const d = parseDateParts(raw)
      return d ? { ok: true, value: `${d.y}-${pad(d.mo)}-${pad(d.d)}` } : refuse('date AAAA-MM-JJ ou JJ/MM/AAAA attendue')
    }
    case 'datetime': {
      const d = parseDateParts(raw)
      if (!d) return refuse('date et heure attendues')
      const local = new Date(d.y, d.mo - 1, d.d, d.h, d.mi)
      return Number.isNaN(local.getTime()) ? refuse('date et heure attendues') : { ok: true, value: local.toISOString() }
    }
    default:
      return { ok: true, value: typeof raw === 'string' ? raw : String(raw) }
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Composantes d'une date saisie : `Date` d'une cellule Excel (sans fuseau, lue en UTC : composantes
 * UTC = heure locale saisie), ou texte `AAAA-MM-JJ[ HH:mm]` / `JJ/MM/AAAA[ HH:mm]` / ISO complet.
 */
function parseDateParts(raw: unknown): { y: number; mo: number; d: number; h: number; mi: number } | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null
    return { y: raw.getUTCFullYear(), mo: raw.getUTCMonth() + 1, d: raw.getUTCDate(), h: raw.getUTCHours(), mi: raw.getUTCMinutes() }
  }
  const text = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const t = new Date(text)
    if (Number.isNaN(t.getTime())) return null
    return { y: t.getFullYear(), mo: t.getMonth() + 1, d: t.getDate(), h: t.getHours(), mi: t.getMinutes() }
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(text)
  const parts = m ? { y: +m[1], mo: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0 } : null
  m = parts ? null : /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(text)
  const result = parts ?? (m ? { y: +m[3], mo: +m[2], d: +m[1], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0 } : null)
  if (!result) return null
  const check = new Date(result.y, result.mo - 1, result.d, result.h, result.mi)
  return check.getFullYear() === result.y && check.getMonth() === result.mo - 1 && check.getDate() === result.d ? result : null
}

function verdictLabel(value: string): string {
  const fr = EXECUTION_SHEET_LABELS.fr
  return (fr.globalVerdicts as Record<string, string>)[value] ?? (fr.stepVerdicts as Record<string, string>)[value] ?? value
}

function missingMessage(def: SchemaField, defs: SchemaField[], key: string | null): string {
  const label = `« ${def.label ?? def.name} » est obligatoire`
  if (key === null) return label
  const values = (def.requiredWhen?.[key] ?? []).map(String)
  if (key === RUN_RESULT_KEY) return `${label} quand Verdict = ${values.map(verdictLabel).join(' ou ')}`
  const ref = defs.find(f => f.name === key)
  return `${label} quand ${ref?.label ?? key} = ${values.join(' ou ')}`
}

type BlockResult = { ok: true; fields?: Record<string, unknown> } | { ok: false; field: string; reason: string }

/** Convertit et contrôle un bloc `fields` (run ou étape) avec le verdict qui le gouverne. */
function prepareBlock(defs: SchemaField[], raw: Record<string, unknown> | undefined, result: string): BlockResult {
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(raw ?? {})) {
    const def = defs.find(f => f.name === name)
    if (!def) return { ok: false, field: name, reason: `champ inconnu '${name}'` }
    const c = convertFieldValue(def, value)
    if (!c.ok) return { ok: false, field: name, reason: c.reason }
    if (c.value !== undefined) out[name] = c.value
  }
  const read = runFieldReader(defs, result, out)
  for (const def of defs) {
    if (isFieldValueFilled(out[def.name])) continue
    const key = activeRequiredWhen(def, read)
    if (def.required || key !== null) return { ok: false, field: def.name, reason: missingMessage(def, defs, def.required ? null : key) }
  }
  return { ok: true, ...(Object.keys(out).length > 0 && { fields: out }) }
}

export interface RunFieldsInput {
  result: string
  fields?: Record<string, unknown>
  stepResults: { order: number; result: string; fields?: Record<string, unknown> }[]
}

export type RunFieldsResult =
  | { ok: true; fields?: Record<string, unknown>; stepFields: (Record<string, unknown> | undefined)[] }
  | { ok: false; field: string; step?: number; reason: string }

/**
 * Champs d'un run à écrire (spec §3) : conversion, clés inconnues refusées, `required` / `requiredWhen`
 * sur le verdict final (run) ou de l'étape. Étape `NOT_EXECUTED` : ni champs ni obligation (Q3).
 * `stepFields` est aligné sur `stepResults`. Type introuvable : valeurs reprises telles quelles.
 */
export function prepareRunFields(typeDef: Pick<ObjectTypeDefinition, 'runFields' | 'stepFields'> | null | undefined, run: RunFieldsInput): RunFieldsResult {
  if (!typeDef) {
    const keep = (f?: Record<string, unknown>) => (f && Object.keys(f).length > 0 ? f : undefined)
    return { ok: true, fields: keep(run.fields), stepFields: run.stepResults.map(s => keep(s.fields)) }
  }
  const runBlock = prepareBlock(typeDef.runFields ?? [], run.fields, run.result)
  if (!runBlock.ok) return runBlock
  const stepFields: (Record<string, unknown> | undefined)[] = []
  for (const step of run.stepResults) {
    if (step.result === 'NOT_EXECUTED') { stepFields.push(undefined); continue }
    const b = prepareBlock(typeDef.stepFields ?? [], step.fields, step.result)
    if (!b.ok) return { ok: false, field: b.field, step: step.order, reason: `Étape ${step.order} : ${b.reason}` }
    stepFields.push(b.fields)
  }
  return { ok: true, fields: runBlock.fields, stepFields }
}

export interface RunFieldIssue extends RequiredWhenIssue {
  typeName: string
  list: RunFieldList
}

/**
 * Cohérence des listes d'exécution de tous les types d'un schéma : listes hors type de test, type de
 * champ non admis, nom en double dans une liste, `requiredWhen` (#195, pseudo-champ `result`), et
 * **unicité du nom dans le projet** (Q6) : même nom = même liste et même type de champ.
 */
export function runFieldIssues(types: ObjectTypeDefinition[]): RunFieldIssue[] {
  const issues: RunFieldIssue[] = []
  const seen = new Map<string, { list: RunFieldList; type: SchemaField['type']; typeName: string }>()
  for (const t of types) {
    for (const list of ['runFields', 'stepFields'] as const) {
      const defs = t[list] ?? []
      if (defs.length === 0) continue
      const push = (field: string, message: string, level: RequiredWhenIssue['level'] = 'error') =>
        issues.push({ typeName: t.name, list, field, level, message: `Type "${t.name}" (${list}) : ${message}` })
      if (t.category !== 'test') { push('', `réservé aux types de test`); continue }
      const names = new Set<string>()
      for (const def of defs) {
        if (!isRunFieldTypeAllowed(def.type)) push(def.name, `'${def.name}' : type ${def.type} non admis`)
        if (def.name === RUN_RESULT_KEY) push(def.name, `'${RUN_RESULT_KEY}' est réservé (verdict)`)
        if (names.has(def.name)) push(def.name, `'${def.name}' déclaré deux fois`)
        names.add(def.name)
        const prev = seen.get(def.name)
        if (prev && (prev.list !== list || prev.type !== def.type)) {
          push(def.name, `'${def.name}' est déjà déclaré par le type "${prev.typeName}" (${prev.list}, ${prev.type}) : un nom de champ d'exécution désigne un seul champ dans le projet`)
        } else if (!prev) {
          seen.set(def.name, { list, type: def.type, typeName: t.name })
        }
      }
      const values = list === 'runFields' ? [...RUN_RESULT_VALUES] : [...STEP_RESULT_VALUES]
      for (const i of requiredWhenIssues({ category: 'test', fields: defs }, { key: RUN_RESULT_KEY, values })) {
        push(i.field, i.message, i.level)
      }
    }
  }
  return issues
}
