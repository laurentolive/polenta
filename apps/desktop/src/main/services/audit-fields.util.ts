/**
 * GH340 — dates de création / modification (« champs d'audit ») stockées dans le YAML des
 * exigences, tests et issues, posées par l'application (annule T112). Une seule règle : la
 * modification avance quand le contenu hors clés de l'application change (spec §4, design §1) —
 * une revalidation, un changement de type, un renommage ne les touchent donc pas.
 */

import { canonical } from '@polenta/merge-core'

export const AUDIT_KEYS = ['createdAt', 'createdBy', 'updatedAt', 'updatedBy'] as const
type AuditKey = typeof AUDIT_KEYS[number]

export interface AuditFields {
  createdAt: string | null
  createdBy: string | null
  updatedAt: string | null
  updatedBy: string | null
}

/**
 * Clés posées par l'application, qui ne sont pas un changement de contenu de l'objet. Liste propre
 * aux dates : `version-tracking` garde la sienne, où une `version` qui change compte (GH201).
 */
const APP_KEYS = [
  ...AUDIT_KEYS, 'history', 'needsRevalidation', 'version', 'objectTypeRef', 'projectId', 'branchId',
  // Notifications rendues à l'appelant (GH206), jamais écrites.
  'transitionWarnings',
]

/** Vrai si le contenu de l'objet (hors clés de l'application) diffère — forme canonique de merge-core. */
export function contentChanged(before: object, after: object): boolean {
  return canonical(before, APP_KEYS) !== canonical(after, APP_KEYS)
}

/**
 * Dates de `after` après une écriture : création (`before` null) → les quatre ; contenu changé →
 * modification avancée, création reprise de `before` ; sinon les valeurs de `before`, inchangées.
 * `changed` : résultat de `contentChanged` si l'appelant l'a déjà calculé.
 */
export function applyAudit<T extends object>(
  before: object | null, after: T, by: string, at: string,
  changed = before === null || contentChanged(before, after),
): T & AuditFields {
  if (!before) return { ...after, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by }
  const kept = readAuditFields(before)
  if (!changed) return { ...after, ...kept }
  return { ...after, createdAt: kept.createdAt, createdBy: kept.createdBy, updatedAt: at, updatedBy: by }
}

/** Payload écrit : une date inconnue n'est jamais écrite (`null` n'apparaît pas dans le fichier). */
export function auditForWrite<T extends object>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>
  for (const k of AUDIT_KEYS) if (out[k] === null || out[k] === undefined) delete out[k]
  return out as T
}

/**
 * Lecture : valeur absente → `null`, date YAML non quotée (objet `Date`) → chaîne ISO, sans perte :
 * les millisecondes non nulles sont gardées (une date écrite par l'application n'en a pas).
 */
export function readAuditFields(obj: object): AuditFields {
  const raw = obj as Partial<Record<AuditKey, unknown>>
  const date = (v: unknown): string | null =>
    v instanceof Date ? v.toISOString().replace(/\.000Z$/, 'Z') : typeof v === 'string' && v ? v : null
  const who = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
  return { createdAt: date(raw.createdAt), createdBy: who(raw.createdBy), updatedAt: date(raw.updatedAt), updatedBy: who(raw.updatedBy) }
}

/** Objet lu sur disque, champs d'audit normalisés. */
export function withAuditFields<T extends object>(obj: T): T & AuditFields {
  return { ...obj, ...readAuditFields(obj) }
}

/** Copie d'un objet hors de son fichier (instantané de campagne) : sans les champs d'audit. */
export function withoutAuditFields<T extends object>(obj: T): Omit<T, AuditKey> {
  const out = { ...obj } as Record<string, unknown>
  for (const k of AUDIT_KEYS) delete out[k]
  return out as Omit<T, AuditKey>
}
