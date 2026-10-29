import type { ObjectTypeDefinition, SchemaField } from './schema'
import { parseMultiEnumValue } from './schema'
import { normalizeLinkField } from './field-links'
import { sameHistoryValue } from './history'

// GH195 — obligation conditionnelle `requiredWhen` (specs/GH195.md §2) et préparation des `fields`
// à l'écriture (normalisation des liens). Le moteur est indépendant de la source des valeurs : un
// `FieldValueReader` lit la valeur d'un champ de référence. `objectFieldReader` couvre les objets
// (statut + champs) ; les runs (L2, pseudo-champ `result`) et les décisions (L5) fourniront le leur.

/** Valeurs d'un champ de référence, sous forme de chaînes (multi_enum : une par valeur cochée). */
export type FieldValueReader = (name: string) => string[]

/** Pseudo-champ statut, référence admise sur tout type d'objet. */
export const REQUIRED_WHEN_STATUS = 'status'

/** Statuts fixes d'une campagne (le champ `statuses` du type est ignoré pour cette catégorie). */
export const CAMPAIGN_STATUS_NAMES = ['planned', 'in_progress', 'completed', 'abandoned'] as const

const REFERENCE_TYPES: ReadonlySet<SchemaField['type']> = new Set<SchemaField['type']>(['enum', 'multi_enum', 'boolean'])

type TypeDefLike = Pick<ObjectTypeDefinition, 'fields' | 'statuses' | 'category'>

interface ObjectLike {
  status?: string
  fields?: Record<string, unknown>
}

function asStrings(def: SchemaField | undefined, v: unknown): string[] {
  if (v === undefined || v === null || v === '') return []
  if (def?.type === 'multi_enum') return parseMultiEnumValue(v)
  if (def?.type === 'boolean') {
    if (v === true || v === 'true') return ['true']
    if (v === false || v === 'false') return ['false']
    return []
  }
  if (Array.isArray(v)) return v.map(String)
  return [String(v)]
}

export function objectFieldReader(typeDef: Pick<ObjectTypeDefinition, 'fields'> | null | undefined, obj: ObjectLike): FieldValueReader {
  return (name) => {
    if (name === REQUIRED_WHEN_STATUS) return obj.status ? [obj.status] : []
    return asStrings(typeDef?.fields.find(f => f.name === name), obj.fields?.[name])
  }
}

/** Clé de la première condition vraie de `field.requiredWhen`, ou null. */
export function activeRequiredWhen(field: Pick<SchemaField, 'requiredWhen'>, read: FieldValueReader): string | null {
  for (const [key, values] of Object.entries(field.requiredWhen ?? {})) {
    if (!Array.isArray(values) || values.length === 0) continue
    const wanted = new Set(values.map(String))
    if (read(key).some(v => wanted.has(v))) return key
  }
  return null
}

/** Obligatoire maintenant : `required`, ou une condition `requiredWhen` vraie. */
export function isFieldRequiredNow(field: Pick<SchemaField, 'required' | 'requiredWhen'>, read: FieldValueReader): boolean {
  return !!field.required || activeRequiredWhen(field, read) !== null
}

/** Valeur renseignée (même règle que `isFilled` du main). */
export function isFieldValueFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

function statusNames(typeDef: TypeDefLike): string[] | null {
  if (typeDef.category === 'campaign') return [...CAMPAIGN_STATUS_NAMES]
  return typeDef.statuses?.length ? typeDef.statuses.map(s => s.name) : null
}

function valueLabel(typeDef: TypeDefLike, key: string, value: string): string {
  if (key === REQUIRED_WHEN_STATUS) return typeDef.statuses?.find(s => s.name === value)?.label ?? value
  if (value === 'true') return 'oui'
  if (value === 'false') return 'non'
  return value
}

/** Message de refus : `« Justification » est obligatoire quand Statut = Approuvé`. */
export function requiredWhenMessage(typeDef: TypeDefLike, field: SchemaField, key: string): string {
  const ref = key === REQUIRED_WHEN_STATUS ? 'Statut' : (typeDef.fields.find(f => f.name === key)?.label ?? key)
  const values = (field.requiredWhen?.[key] ?? []).map(v => valueLabel(typeDef, key, String(v))).join(' ou ')
  return `« ${field.label ?? field.name} » est obligatoire quand ${ref} = ${values}`
}

export interface RequiredWhenIssue {
  field: string
  /** `error` : refusé à la sauvegarde du schéma ; `warning` : condition inerte, signalée (⚠). */
  level: 'error' | 'warning'
  message: string
}

/**
 * Cohérence des `requiredWhen` d'un type (spec §2.3, design §2.3). Erreurs : structure invalide,
 * auto-référence, liste vide, référence d'un type non admis. Avertissements : champ de référence
 * absent, valeur inconnue — une évolution du schéma rend la condition inerte sans rien bloquer.
 */
export function requiredWhenIssues(typeDef: TypeDefLike): RequiredWhenIssue[] {
  const issues: RequiredWhenIssue[] = []
  for (const field of typeDef.fields) {
    const rw = field.requiredWhen as unknown
    if (rw === undefined) continue
    const push = (level: RequiredWhenIssue['level'], message: string) => issues.push({ field: field.name, level, message })
    if (!rw || typeof rw !== 'object' || Array.isArray(rw)) {
      push('error', `requiredWhen de '${field.name}' : objet { champ: [valeurs] } attendu`)
      continue
    }
    for (const [key, values] of Object.entries(rw as Record<string, unknown>)) {
      if (!Array.isArray(values) || values.length === 0) {
        push('error', `requiredWhen de '${field.name}' : liste de valeurs vide pour '${key}'`)
        continue
      }
      if (key === field.name) {
        push('error', `requiredWhen de '${field.name}' : un champ ne peut pas dépendre de lui-même`)
        continue
      }
      let known: string[] | null
      if (key === REQUIRED_WHEN_STATUS) {
        known = statusNames(typeDef)
      } else {
        const ref = typeDef.fields.find(f => f.name === key)
        if (!ref) {
          push('warning', `requiredWhen de '${field.name}' : champ de référence '${key}' absent du type`)
          continue
        }
        if (!REFERENCE_TYPES.has(ref.type)) {
          push('error', `requiredWhen de '${field.name}' : '${key}' est de type ${ref.type} (admis : statut, enum, multi_enum, boolean)`)
          continue
        }
        known = ref.type === 'boolean' ? ['true', 'false'] : (ref.values?.length ? ref.values : null)
      }
      if (!known) continue
      const unknown = values.map(String).filter(v => !known!.includes(v))
      if (unknown.length > 0) {
        push('warning', `requiredWhen de '${field.name}' : valeur(s) inconnue(s) pour '${key}' : ${unknown.join(', ')}`)
      }
    }
  }
  return issues
}

function canonical(v: unknown): string {
  return JSON.stringify(v ?? null, (_k, x: unknown) => {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    }
    return x
  })
}

export type FieldsWriteResult =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; field: string; reason: string }

/**
 * Préparation des `fields` d'une écriture d'objet (design §1) : normalise les champs `link`
 * modifiés, puis contrôle les `requiredWhen` dont le champ ou une référence a changé (Q2 : un objet
 * ancien reste modifiable sur ses autres champs). `before` null = création (tout est contrôlé).
 * Les champs non modifiés ne sont jamais réécrits.
 */
export function prepareFieldsWrite(
  typeDef: TypeDefLike | null | undefined,
  before: ObjectLike | null,
  after: ObjectLike,
): FieldsWriteResult {
  const fields: Record<string, unknown> = { ...(after.fields ?? {}) }
  if (!typeDef) return { ok: true, fields }

  // Comparaison au sens de la valeur, pas de la forme : les formulaires renvoient tous les champs en
  // chaînes à chaque sauvegarde ('' pour absent, 'true' pour true, liens en forme texte).
  const fieldChanged = (name: string) => {
    if (before === null) return true
    const def = typeDef.fields.find(f => f.name === name)
    const [a, b] = [before.fields?.[name], after.fields?.[name]]
    if (!def) return canonical(a) !== canonical(b)
    if (def.type === 'boolean') return asStrings(def, a).join() !== asStrings(def, b).join()
    return !sameHistoryValue(def.type, a, b)
  }
  const keyChanged = (name: string) => name === REQUIRED_WHEN_STATUS
    ? before === null || before.status !== after.status
    : fieldChanged(name)

  for (const def of typeDef.fields) {
    if (def.type !== 'link' || !(def.name in fields)) continue
    // Lien inchangé : valeur stockée conservée telle quelle (jamais réécrite depuis la forme texte).
    if (!fieldChanged(def.name)) {
      if (before?.fields && def.name in before.fields) fields[def.name] = before.fields[def.name]
      else delete fields[def.name]
      continue
    }
    const n = normalizeLinkField(def, fields[def.name])
    if (!n.ok) return { ok: false, field: def.name, reason: n.reason }
    if (n.value === undefined) delete fields[def.name]
    else fields[def.name] = n.value
  }

  const read = objectFieldReader(typeDef, { status: after.status, fields })
  for (const def of typeDef.fields) {
    if (!def.requiredWhen) continue
    const touched = fieldChanged(def.name) || Object.keys(def.requiredWhen).some(keyChanged)
    if (!touched) continue
    const key = activeRequiredWhen(def, read)
    if (key !== null && !isFieldValueFilled(fields[def.name])) {
      return { ok: false, field: def.name, reason: requiredWhenMessage(typeDef, def, key) }
    }
  }
  return { ok: true, fields }
}
