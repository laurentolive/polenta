import { parseMultiEnumValue, resolveMultiEnumOptions, serializeMultiEnumValue } from '@polenta/types'
import type { ObjectTypeDefinition, ProjectSchema, SchemaField } from '@polenta/types'

/**
 * GH372 — contrôle des valeurs de `fields` d'une écriture sans interface (MCP : `bulk_import_*`,
 * `update_requirements` / `update_tests`) contre le type de l'objet. Une seule règle pour l'import et la
 * modification : avant GH372, seule la modification contrôlait (champ déclaré, enum), l'import rien.
 *
 * Refusé (GH384 : toutes les erreurs, une par champ, dans l'ordre des clés de `fields`) :
 * - clé absente des `fields` du type ;
 * - `enum` hors `values`, élément de `multi_enum` hors `values` (catalogue de rôles pour `roles`, T110) ;
 * - `number` : ni nombre fini, ni chaîne numérique (l'éditeur enregistre la saisie en chaîne) ;
 * - `boolean` : autre chose que `true` / `false` ;
 * - `date` : autre chose qu'une chaîne `AAAA-MM-JJ` valide (format de l'`<input type="date">`).
 *
 * Valeur vide (`null`, `undefined`, chaîne blanche, liste vide) : rien à contrôler ici — l'obligation
 * est le contrôle `required` de l'appelant, et `null` retire le champ en modification.
 * Liste de valeurs non déclarée (`values` vide) : pas de contrôle de liste. Autres types (texte,
 * richtext, user, link, drawio, datetime) : non contrôlés ici (`link` : `prepareFieldsWrite`).
 */
export function fieldValuesErrors(
  schema: Pick<ProjectSchema, 'roles'>,
  typeDef: Pick<ObjectTypeDefinition, 'fields'>,
  objectTypeRef: string,
  fields: Record<string, unknown> | undefined,
): Array<{ field: string; reason: string }> {
  const roles = schema.roles?.map(r => r.name)
  const errors: Array<{ field: string; reason: string }> = []
  for (const [name, value] of Object.entries(fields ?? {})) {
    const def = typeDef.fields.find(f => f.name === name)
    if (!def) {
      const declared = typeDef.fields.map(f => f.name).join(', ') || 'aucun'
      errors.push({ field: name, reason: `champ '${name}' non déclaré par le type ${objectTypeRef} (champs du type : ${declared})` })
      continue
    }
    if (isEmpty(value)) continue
    const reason = valueError(def, value, roles)
    if (reason) errors.push({ field: name, reason })
  }
  return errors
}

/** Première erreur de `fieldValuesErrors`, null si aucune. */
export function fieldValuesError(
  ...args: Parameters<typeof fieldValuesErrors>
): { field: string; reason: string } | null {
  return fieldValuesErrors(...args)[0] ?? null
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function valueError(def: SchemaField, value: unknown, roles: string[] | undefined): string | null {
  const shown = typeof value === 'string' ? `"${value}"` : JSON.stringify(value)
  switch (def.type) {
    case 'enum':
    case 'multi_enum': {
      const options = def.type === 'multi_enum' ? resolveMultiEnumOptions(def, roles) : (def.values ?? [])
      if (options.length === 0) return null
      if (def.type === 'enum' && typeof value !== 'string' && typeof value !== 'number') {
        return `valeur ${shown} invalide pour '${def.name}' : une seule valeur attendue parmi ${options.join(', ')}`
      }
      if (def.type === 'multi_enum' && !Array.isArray(value) && typeof value !== 'string') {
        return `valeur ${shown} invalide pour '${def.name}' : liste attendue, valeurs parmi ${options.join(', ')}`
      }
      const values = def.type === 'enum' ? [String(value)] : multiEnumItems(value)
      const bad = values.find(v => !options.includes(v))
      return bad === undefined ? null : `valeur "${bad}" hors liste pour '${def.name}' (${options.join(', ')})`
    }
    case 'number': {
      const ok = typeof value === 'number' ? Number.isFinite(value)
        : typeof value === 'string' && Number.isFinite(Number(value.trim()))
      return ok ? null : `valeur ${shown} invalide pour '${def.name}' : nombre attendu`
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `valeur ${shown} invalide pour '${def.name}' : true ou false attendu`
    case 'date': {
      const m = typeof value === 'string' ? DATE_PATTERN.exec(value.trim()) : null
      const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
      const ok = !!d && d.getUTCFullYear() === +m![1] && d.getUTCMonth() === +m![2] - 1 && d.getUTCDate() === +m![3]
      return ok ? null : `valeur ${shown} invalide pour '${def.name}' : date AAAA-MM-JJ attendue`
    }
    default:
      return null
  }
}

/** Éléments d'un multi_enum, non-chaînes comprises (`parseMultiEnumValue` les écarte sans le dire). */
function multiEnumItems(value: unknown): string[] {
  return Array.isArray(value) ? value.map(v => String(v)) : parseMultiEnumValue(value)
}

/**
 * GH384 — `multi_enum` d'une écriture sans interface (MCP) au format de l'application : la chaîne
 * « a, b » (`serializeMultiEnumValue`, celle des cases à cocher, des vues Excel / Word et des champs
 * d'exécution). Une liste, ou une chaîne mal espacée, est réécrite ; une liste aux éléments non
 * chaînes est laissée telle quelle pour que `fieldValuesErrors` la refuse. Autres champs inchangés.
 */
export function canonicalMultiEnumFields(
  typeDef: Pick<ObjectTypeDefinition, 'fields'> | null | undefined,
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!typeDef || !fields) return fields
  let out: Record<string, unknown> | undefined
  for (const def of typeDef.fields) {
    if (def.type !== 'multi_enum' || !(def.name in fields)) continue
    const value = fields[def.name]
    if (Array.isArray(value) ? !value.every(v => typeof v === 'string') : typeof value !== 'string') continue
    const canonical = serializeMultiEnumValue(parseMultiEnumValue(value))
    if (canonical === value) continue
    out ??= { ...fields }
    out[def.name] = canonical
  }
  return out ?? fields
}
