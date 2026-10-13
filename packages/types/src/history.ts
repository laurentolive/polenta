import { parseMultiEnumValue } from './schema'
import type { ObjectTypeDefinition, SchemaFieldType } from './schema'

// GH77 — historique configurable des champs (specs/GH77.md, specs/GH77-design.md §1.2).
// Logique pure, partagée par le main (écriture, lecture effective), le serveur MCP, le renderer et
// le futur graphe de données (#74). Aucune lecture de fichier ni d'horloge ici : l'appelant fournit
// l'acteur, la date et le repli (dernier commit du fichier).

/** Origine d'une entrée ; absente = saisie dans l'application. */
export type HistorySource = 'mcp' | 'git' | 'schema'

export interface HistoryEntry {
  /** Clé technique (statut, valeur d'enum, valeur brute) ; absente pour un champ « événement seul ». */
  value?: unknown
  /** ISO 8601 UTC à la seconde. */
  at: string
  /** Login ; absent seulement pour une entrée implicite d'un fichier jamais commité. */
  by?: string
  source?: HistorySource
  /** Lecture seulement (spec §7) : valeur constatée dont la date de changement est inconnue. Jamais écrit. */
  implicit?: true
}

/** Une liste par champ suivi : `status` pour le statut, le nom du champ pour un champ de `fields`. */
export type ObjectHistory = Record<string, HistoryEntry[]>

export interface HistoryActor {
  by: string
  source?: HistorySource
}

/** Date et auteur du dernier commit du fichier, pour dater une valeur dont on ignore le moment de pose. */
export interface HistoryFallback {
  at: string | null
  by: string | null
}

export type HistoryMode = 'value' | 'event'

export interface TrackedKey {
  key: string
  mode: HistoryMode
  type: SchemaFieldType | 'status'
}

/** Objet portant un historique : exigence, test ou campagne. */
export interface HistoryCarrier {
  status: string
  fields: Record<string, unknown>
  history?: ObjectHistory
}

export const STATUS_HISTORY_KEY = 'status'

const EVENT_ONLY_TYPES: ReadonlySet<SchemaFieldType> = new Set<SchemaFieldType>(['textarea', 'richtext', 'drawio'])

/** Types de champ acceptant `trackHistory` (spec §3) — aujourd'hui tous. */
export const HISTORY_TRACKABLE_TYPES: SchemaFieldType[] = [
  'text', 'textarea', 'number', 'enum', 'multi_enum', 'boolean', 'date', 'datetime', 'richtext', 'user', 'drawio',
]

/** Valeur enregistrée, ou événement seul (date et auteur) quand le contenu est déjà dans git. */
export function historyModeFor(type: SchemaFieldType): HistoryMode {
  return EVENT_ONLY_TYPES.has(type) ? 'event' : 'value'
}

/**
 * Clés suivies d'un type : le statut sauf `trackStatusHistory: false`, puis les champs `trackHistory`.
 * Type introuvable : statut seul. Un champ de `fields` nommé `status` n'est jamais suivi — sa clé
 * d'historique se confondrait avec celle du statut.
 */
export function trackedKeys(typeDef: Pick<ObjectTypeDefinition, 'fields' | 'trackStatusHistory'> | null | undefined): TrackedKey[] {
  const keys: TrackedKey[] = []
  if (typeDef?.trackStatusHistory !== false) keys.push({ key: STATUS_HISTORY_KEY, mode: 'value', type: 'status' })
  for (const field of typeDef?.fields ?? []) {
    if (!field.trackHistory || field.name === STATUS_HISTORY_KEY) continue
    if (!HISTORY_TRACKABLE_TYPES.includes(field.type)) continue
    keys.push({ key: field.name, mode: historyModeFor(field.type), type: field.type })
  }
  return keys
}

/** Date ISO UTC à la seconde (`2026-10-13T09:47:50Z`). */
export function historyTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

/**
 * Valeur telle qu'enregistrée, indépendante de sa forme dans le YAML : vide → null ; date YAML non
 * quotée (chargée en `Date`) → `YYYY-MM-DD` pour un champ `date`, ISO sinon ; nombre saisi en texte
 * → nombre pour un champ `number`.
 */
function storedValue(type: TrackedKey['type'], v: unknown): unknown {
  if (isEmptyValue(v)) return null
  if (v instanceof Date) return type === 'date' ? v.toISOString().slice(0, 10) : v.toISOString()
  if (type === 'number' && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return v
}

/** Forme comparable : `storedValue`, et multi_enum → ensemble trié. */
function comparable(type: TrackedKey['type'], v: unknown): unknown {
  v = storedValue(type, v)
  if (v === null) return null
  if (type === 'multi_enum') {
    const set = [...new Set(parseMultiEnumValue(v))].sort()
    return set.length === 0 ? null : set
  }
  return v
}

function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    }
    return x
  }) ?? 'undefined'
}

/** Égalité de valeur au sens de l'historique (vide = vide, multi_enum sans ordre). */
export function sameHistoryValue(type: TrackedKey['type'], a: unknown, b: unknown): boolean {
  return canonical(comparable(type, a)) === canonical(comparable(type, b))
}

function currentValue(obj: HistoryCarrier, key: string): unknown {
  return key === STATUS_HISTORY_KEY ? obj.status : obj.fields?.[key]
}

function entry(base: Omit<HistoryEntry, 'by' | 'source'>, by: string | null | undefined, source: HistorySource | undefined): HistoryEntry {
  const e: HistoryEntry = { ...base }
  if (by) e.by = by
  if (source) e.source = source
  return e
}

/**
 * La dernière valeur connue de la liste diffère-t-elle de `value` ? Une liste vide « diffère »
 * d'une valeur non vide (historique jamais commencé : ancienne app, suivi activé après coup).
 */
function hasGap(list: HistoryEntry[], key: TrackedKey, value: unknown): boolean {
  if (key.mode !== 'value') return false
  const last = list[list.length - 1]
  return last ? !sameHistoryValue(key.type, last.value, value) : !isEmptyValue(value)
}

/**
 * Date d'une valeur constatée dont on ignore le moment de pose : le dernier commit du fichier, mais
 * jamais avant la dernière entrée de la liste (une écriture non commitée peut être plus récente que
 * le commit) — la liste reste triée et sa dernière entrée reste la valeur courante.
 */
function gapTime(list: HistoryEntry[], fallbackAt: string | null, now: string): string {
  const candidate = fallbackAt ?? now
  const last = list[list.length - 1]?.at
  return last && String(last) > candidate ? String(last) : candidate
}

/**
 * Cœur de l'alimentation (spec §4) : compare l'objet avant et après une écriture et renvoie `after`
 * avec une entrée par champ suivi dont la valeur a changé. `before` null = création.
 *
 * Avant d'ajouter le changement, le trou est comblé (spec §7) : si la dernière entrée ne correspond
 * pas à la valeur *avant* (YAML modifié à la main, ancienne app, `git revert`), cette valeur est
 * inscrite datée du dernier commit (`fallback`) — `source: 'schema'` quand la clé n'avait encore
 * aucune entrée (démarrage du suivi, spec §6.1). Toute écriture comble le trou, même sans changement
 * de valeur suivie. Ne supprime jamais une clé, ne mute pas les objets reçus.
 */
export function applyHistory<T extends HistoryCarrier>(
  before: HistoryCarrier | null,
  after: T,
  typeDef: Pick<ObjectTypeDefinition, 'fields' | 'trackStatusHistory'> | null | undefined,
  actor: HistoryActor,
  now: Date,
  fallback: HistoryFallback = { at: null, by: null },
): T {
  const history: ObjectHistory = { ...(after.history ?? before?.history ?? {}) }
  const at = historyTimestamp(now)
  let touched = false

  for (const key of trackedKeys(typeDef)) {
    const existing = history[key.key] ?? []
    const list = [...existing]
    const cur = currentValue(after, key.key)

    if (!before) {
      if (isEmptyValue(cur)) continue
      list.push(entry(key.mode === 'value' ? { value: storedValue(key.type, cur), at } : { at }, actor.by, actor.source))
    } else {
      const prev = currentValue(before, key.key)
      if (hasGap(list, key, prev)) {
        list.push(entry({ value: storedValue(key.type, prev), at: gapTime(list, fallback.at, at) }, fallback.by, list.length === 0 ? 'schema' : undefined))
      }
      if (!sameHistoryValue(key.type, prev, cur)) {
        list.push(entry(key.mode === 'value' ? { value: storedValue(key.type, cur), at } : { at }, actor.by, actor.source))
      }
    }

    if (list.length > existing.length) {
      history[key.key] = list
      touched = true
    }
  }

  if (!touched) return after
  return { ...after, history }
}

/**
 * Lecture (spec §7) : l'historique enregistré, plus une entrée `implicit: true` pour chaque champ
 * suivi à valeur dont la valeur courante diffère de la dernière entrée. Rien n'est écrit.
 */
export function effectiveHistory(
  obj: HistoryCarrier,
  typeDef: Pick<ObjectTypeDefinition, 'fields' | 'trackStatusHistory'> | null | undefined,
  fallback: HistoryFallback,
  now: Date,
): ObjectHistory {
  const history: ObjectHistory = {}
  for (const [k, list] of Object.entries(obj.history ?? {})) history[k] = [...(list ?? [])]
  for (const key of trackedKeys(typeDef)) {
    const list = history[key.key] ?? []
    const cur = currentValue(obj, key.key)
    if (!hasGap(list, key, cur)) continue
    const implicitEntry: HistoryEntry = { value: storedValue(key.type, cur), at: gapTime(list, fallback.at, historyTimestamp(now)), implicit: true }
    if (fallback.by) implicitEntry.by = fallback.by
    history[key.key] = [...list, implicitEntry]
  }
  return history
}

/**
 * Un champ suivi de `obj` a-t-il une valeur courante absente de la fin de son historique ? Permet à
 * l'appelant de ne chercher la date du dernier commit (`fallback`, coûteux) que quand elle servira.
 */
export function hasHistoryGap(
  obj: HistoryCarrier,
  typeDef: Pick<ObjectTypeDefinition, 'fields' | 'trackStatusHistory'> | null | undefined,
): boolean {
  return trackedKeys(typeDef).some(key => hasGap(obj.history?.[key.key] ?? [], key, currentValue(obj, key.key)))
}

/** Copie figée d'un test dans une campagne (spec §11) : sans historique. */
export function withoutHistory<T extends { history?: unknown }>(obj: T): Omit<T, 'history'> {
  const { history: _history, ...rest } = obj
  return rest
}
