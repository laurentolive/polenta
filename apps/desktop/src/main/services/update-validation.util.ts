import { parseMultiEnumValue, prepareFieldsWrite } from '@polenta/types'
import type { ObjectCategory, ProjectSchema } from '@polenta/types'
import { findLocalNodeByRefPrefix, findObjectTypeDef, findOwningNode } from './schema-lookup.util'
import { isEarsCompliant, isFilled } from './field-checks.util'
import { mergeFields } from './field-merge.util'

/**
 * GH150 — validation d'une entrée `update_requirements` / `update_tests` (MCP) contre l'objet
 * existant et son type. Logique pure, comme `bulk-import-validation.util.ts` : la lecture du schéma
 * et de l'objet reste à l'appelant. Première règle en échec :
 *
 * 1. type de l'objet connu (`'unresolvable'` — ref cross-composant — accepté, sans contrôle de champs) ;
 * 2. nœud propriétaire pas `readonly` ;
 * 3. `status` parmi les statuts du type (s'il en déclare) ;
 * 4. chaque clé de `fields` déclarée par le type, valeurs d'`enum` / `multi_enum` dans `values` ;
 * 5. champs **modifiés** : un champ `required` n'est pas vidé, un champ `validator: EARS` reste conforme.
 *    Seuls les champs touchés par l'entrée sont contrôlés : un énoncé existant non conforme ne bloque
 *    pas la modification d'un autre champ.
 * 6. GH195 — champs `link` modifiés normalisés (URL contrôlées), `requiredWhen` touchés satisfaits
 *    (`prepareFieldsWrite`, même contrôle que l'écriture réelle).
 */

export interface UpdateEntryBase {
  id: string
  title?: string
  status?: string
  fields?: Record<string, unknown>
}

export interface UpdatableObject {
  objectTypeRef: string
  title: string
  status: string
  fields?: Record<string, unknown>
}

export interface FieldChange {
  before: unknown
  after: unknown
}

export type UpdatePlan =
  | { ok: true; changes: Record<string, FieldChange> }
  | { ok: false; reason: string; field?: string }

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * @param extraKeys champs de structure modifiables en plus de `title` (tests : `preconditions`,
 *        `postconditions`, `steps`, `equipment`) — remplacés en bloc, sans contrôle de schéma.
 */
export function planUpdate(
  schema: ProjectSchema,
  category: ObjectCategory,
  existing: UpdatableObject,
  entry: UpdateEntryBase & Record<string, unknown>,
  extraKeys: readonly string[] = [],
): UpdatePlan {
  const resolved = findObjectTypeDef(schema, existing.objectTypeRef, category)
  if (resolved === null) {
    return { ok: false, reason: `type de l'objet introuvable dans schema.yaml : "${existing.objectTypeRef}"` }
  }
  const node = resolved === 'unresolvable'
    ? findLocalNodeByRefPrefix(schema, existing.objectTypeRef)
    : findOwningNode(schema, existing.objectTypeRef, resolved)
  if (node?.readonly) return { ok: false, reason: `nœud '${node.name}' en lecture seule — écriture refusée` }

  if (resolved !== 'unresolvable') {
    // Même règle que `isUnknownStatus` de GH149 (#160), recopiée ici tant que #160 n'est pas mergée.
    if (entry.status !== undefined && resolved.statuses?.length && !resolved.statuses.some(s => s.name === entry.status)) {
      return {
        ok: false, field: 'status',
        reason: `statut inconnu : "${entry.status}" (statuts du type : ${resolved.statuses!.map(s => s.name).join(', ')})`,
      }
    }
    for (const [name, value] of Object.entries(entry.fields ?? {})) {
      const def = resolved.fields.find(f => f.name === name)
      if (!def) return { ok: false, field: name, reason: `champ '${name}' non déclaré par le type ${existing.objectTypeRef}` }
      if (value === null || !def.values?.length) continue
      const values = def.type === 'enum' ? [value] : def.type === 'multi_enum' ? parseMultiEnumValue(value) : []
      const bad = values.find(v => !def.values!.includes(String(v)))
      if (bad !== undefined) {
        return { ok: false, field: name, reason: `valeur "${String(bad)}" hors liste pour '${name}' (${def.values.join(', ')})` }
      }
    }
    for (const name of Object.keys(entry.fields ?? {})) {
      const def = resolved.fields.find(f => f.name === name)!
      const value = entry.fields![name]
      if (def.required && !isFilled(value)) return { ok: false, field: name, reason: `champ requis vidé : ${name}` }
      if (def.validator === 'EARS' && value !== null && !isEarsCompliant(value)) {
        return {
          ok: false, field: name,
          reason: `le champ '${name}' ne respecte pas la syntaxe EARS (WHEN/WHILE/WHERE/IF...THEN/THE ... SHALL ...)`,
        }
      }
    }
  }

  const changes: Record<string, FieldChange> = {}
  if (entry.title !== undefined && entry.title !== existing.title) changes.title = { before: existing.title, after: entry.title }
  const current = existing as unknown as Record<string, unknown>
  for (const key of extraKeys) {
    if (entry[key] !== undefined && !same(current[key], entry[key])) changes[key] = { before: current[key], after: entry[key] }
  }
  let merged = mergeFields(existing.fields, entry.fields)
  if (resolved !== 'unresolvable') {
    const prepared = prepareFieldsWrite(resolved, existing, { status: entry.status ?? existing.status, fields: merged })
    if (!prepared.ok) return { ok: false, field: prepared.field, reason: prepared.reason }
    merged = prepared.fields
  }
  for (const name of Object.keys(entry.fields ?? {})) {
    const before = existing.fields?.[name]
    if (!same(before, merged[name])) changes[`fields.${name}`] = { before, after: merged[name] }
  }
  if (entry.status !== undefined && entry.status !== existing.status) {
    changes.status = { before: existing.status, after: entry.status }
  }
  return { ok: true, changes }
}
