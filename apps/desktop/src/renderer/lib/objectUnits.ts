import { deepEqual, unitValue } from '@polenta/merge-core'
import { linkPlainText, parseMultiEnumValue, readLinkValues, type ObjectTypeDefinition, type SchemaField } from '@polenta/types'

/**
 * GH178 — libellés des valeurs d'un objet typé dans les vues de diff (statut, valeurs d'enum).
 * GH222 : l'ordre et les libellés des nœuds sont dans `components/treediff/presentation.ts`.
 */

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

