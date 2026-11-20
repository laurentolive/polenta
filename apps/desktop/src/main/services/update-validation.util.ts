import { prepareFieldsWrite } from '@polenta/types'
import type { ObjectCategory, ProjectSchema } from '@polenta/types'
import { findLocalNodeByRefPrefix, findObjectTypeDef, findOwningNode } from './schema-lookup.util'
import { isEarsCompliant, isFilled } from './field-checks.util'
import { mergeFields } from './field-merge.util'
import { fieldValuesErrors } from './field-values.util'

/**
 * GH150 — validation d'une entrée `update_requirements` / `update_tests` (MCP) contre l'objet
 * existant et son type. Logique pure, comme `bulk-import-validation.util.ts` : la lecture du schéma
 * et de l'objet reste à l'appelant. Les règles 1-2 arrêtent le contrôle ; les règles 3-5 sont
 * indépendantes et toutes leurs erreurs sont rapportées (`errors`, GH384), la règle 6 n'est
 * contrôlée que si elles passent :
 *
 * 1. type de l'objet connu (`'unresolvable'` — ref cross-composant — accepté, sans contrôle de champs) ;
 * 2. nœud propriétaire pas `readonly` ;
 * 3. `status` parmi les statuts du type (s'il en déclare) ;
 * 4. valeurs de `fields` : `field-values.util.ts::fieldValuesError` (GH372, même règle que l'import) ;
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
  | { ok: false; reason: string; field?: string; errors: Array<{ reason: string; field?: string }> }

/** Refus : première erreur en `reason` / `field`, toutes dans `errors`. */
function refused(errors: Array<{ reason: string; field?: string }>): UpdatePlan & { ok: false } {
  return { ok: false, ...errors[0], errors }
}

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
    return refused([{ reason: `type de l'objet introuvable dans schema.yaml : "${existing.objectTypeRef}"` }])
  }
  const node = resolved === 'unresolvable'
    ? findLocalNodeByRefPrefix(schema, existing.objectTypeRef)
    : findOwningNode(schema, existing.objectTypeRef, resolved)
  if (node?.readonly) return refused([{ reason: `nœud '${node.name}' en lecture seule — écriture refusée` }])

  if (resolved !== 'unresolvable') {
    const errors: Array<{ reason: string; field?: string }> = []
    // Même règle que `isUnknownStatus` de GH149 (#160), recopiée ici tant que #160 n'est pas mergée.
    if (entry.status !== undefined && resolved.statuses?.length && !resolved.statuses.some(s => s.name === entry.status)) {
      errors.push({
        field: 'status',
        reason: `statut inconnu : "${entry.status}" (statuts du type : ${resolved.statuses!.map(s => s.name).join(', ')})`,
      })
    }
    const valueErrors = fieldValuesErrors(schema, resolved, existing.objectTypeRef, entry.fields)
    errors.push(...valueErrors)
    for (const name of Object.keys(entry.fields ?? {})) {
      const def = resolved.fields.find(f => f.name === name)
      // Champ non déclaré ou valeur mal formée : déjà signalé.
      if (!def || valueErrors.some(e => e.field === name)) continue
      const value = entry.fields![name]
      if (def.required && !isFilled(value)) errors.push({ field: name, reason: `champ requis vidé : ${name}` })
      else if (def.validator === 'EARS' && value !== null && !isEarsCompliant(value)) {
        errors.push({
          field: name,
          reason: `le champ '${name}' ne respecte pas la syntaxe EARS (WHEN/WHILE/WHERE/IF...THEN/THE ... SHALL ...)`,
        })
      }
    }
    if (errors.length > 0) return refused(errors)
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
    if (!prepared.ok) return refused([{ field: prepared.field, reason: prepared.reason }])
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
