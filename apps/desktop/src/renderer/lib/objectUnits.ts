import { deepEqual, unitValue } from '@polenta/merge-core'
import { linkPlainText, parseMultiEnumValue, readLinkValues, type ObjectTypeDefinition, type SchemaField } from '@polenta/types'

/**
 * GH178 — unités d'un objet typé (exigence, test) pour le mode Rendu des vues de diff : clés racine
 * et `fields.<nom>` (même découpage que `@polenta/merge-core` / la résolution de conflits), dans
 * l'ordre d'affichage de l'éditeur.
 */

type Obj = Record<string, unknown>

export type UnitKind = 'title' | 'status' | 'richtext' | 'field' | 'steps' | 'raw'

export interface DiffUnit {
  key: string
  kind: UnitKind
  /** Libellé du schéma (champ), ou nom technique (propriété inconnue). */
  label?: string
  /** Clé i18n du libellé d'une unité système (titre, statut, étapes…). */
  labelKey?: string
  field?: SchemaField
}

/** Not shown: identity of the object (in the column title) and `history`, which changes on every
 *  write and repeats the status — both stay visible in Raw. */
const HIDDEN_ROOT = new Set(['id', 'projectId', 'branchId', 'objectTypeRef', 'history'])
const SPECIAL_ROOT = new Set(['title', 'status', 'fields', 'preconditions', 'steps', 'postconditions'])
const FIELD_PREFIX = 'fields.'

function fieldNames(o: Obj | null): string[] {
  const f = o?.fields
  return f && typeof f === 'object' && !Array.isArray(f) ? Object.keys(f as Obj) : []
}

/** Units present on at least one side, in display order: title, status, (preconditions), schema
 *  fields in schema order, fields unknown to the schema, (steps, postconditions), other root keys. */
export function diffUnits(before: Obj | null, after: Obj | null, typeDef: ObjectTypeDefinition | undefined): DiffUnit[] {
  const isTest = typeDef?.category === 'test'
    || [before, after].some(o => !!o && ('steps' in o || 'preconditions' in o || 'postconditions' in o))
  const fields = (typeDef?.fields ?? []) as SchemaField[]
  const known = new Set(fields.map(f => f.name))
  const units: DiffUnit[] = [
    { key: 'title', kind: 'title', labelKey: 'diffView.unit.title' },
    { key: 'status', kind: 'status', labelKey: 'diffView.unit.status' },
  ]
  if (isTest) units.push({ key: 'preconditions', kind: 'richtext', labelKey: 'diffView.unit.preconditions' })
  for (const f of fields) {
    units.push({ key: FIELD_PREFIX + f.name, kind: f.type === 'richtext' ? 'richtext' : 'field', label: f.label ?? f.name, field: f })
  }
  for (const n of unique([...fieldNames(after), ...fieldNames(before)])) {
    if (!known.has(n)) units.push({ key: FIELD_PREFIX + n, kind: 'raw', label: n })
  }
  if (isTest) {
    units.push({ key: 'steps', kind: 'steps', labelKey: 'diffView.unit.steps' })
    units.push({ key: 'postconditions', kind: 'richtext', labelKey: 'diffView.unit.postconditions' })
  }
  for (const k of unique([...Object.keys(after ?? {}), ...Object.keys(before ?? {})])) {
    if (!HIDDEN_ROOT.has(k) && !SPECIAL_ROOT.has(k)) units.push({ key: k, kind: 'raw', label: k })
  }
  return units
}

/** The unit's value differs between the two sides (absent on one side counts as a change). */
export function unitChanged(before: Obj | null, after: Obj | null, key: string): boolean {
  return !deepEqual(unitValue(before, key), unitValue(after, key))
}

/** Status shown by its schema label, else its technical name. */
export function statusLabel(typeDef: ObjectTypeDefinition | undefined, status: unknown): string {
  return typeDef?.statuses?.find(s => s.name === status)?.label ?? String(status ?? '')
}

/** Display text of a scalar field value: enum / multi_enum by their labels when the schema has
 *  some (`valueLabels`), other types as is. */
export function scalarLabel(field: SchemaField | undefined, value: unknown): string {
  if (value === undefined || value === null) return ''
  const label = (v: string) => field?.valueLabels?.[v] ?? v
  if (field?.type === 'multi_enum') return parseMultiEnumValue(value).map(label).join(', ')
  if (field?.type === 'enum') return label(String(value))
  if (field?.type === 'link') return readLinkValues(value).map(linkPlainText).join('\n')
  return String(value)
}

function unique(keys: string[]): string[] {
  return [...new Set(keys)]
}
