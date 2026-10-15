import type { GraphParamValue } from './graph'

// GH93 — paramètres de requête choisis à l'affichage (specs/GH93.md, GH93-design.md §1.2). Logique
// pure partagée par le main (enregistrement, exécution), le serveur MCP et le renderer (barre du
// dashboard) : validation d'une déclaration, format et résolution des valeurs, sélecteurs d'un
// dashboard, libellés d'affichage.

export type QueryParameterKind = 'campaign' | 'component' | 'objectType' | 'enum' | 'text' | 'period'

export const QUERY_PARAMETER_KINDS: readonly QueryParameterKind[] = ['campaign', 'component', 'objectType', 'enum', 'text', 'period']

/** Libellé bilingue, ou un seul texte utilisé pour les deux langues. */
export type ParamLabel = { fr: string; en: string } | string

export interface QueryParameterDef {
  /** Clé dans `polenta.params` : lettre puis lettres, chiffres, `_`. */
  name: string
  kind: QueryParameterKind
  label: ParamLabel
  /** `enum` seulement : valeurs possibles. */
  values?: { value: string; label?: ParamLabel }[]
  /** Valeur par défaut (format de `normalizeParamValue`). */
  default?: GraphParamValue
  /** Vrai : pas de choix « Tous / Toutes », le widget attend une valeur. */
  required?: boolean
}

/** Longueur maximale d'une valeur `text`. */
export const PARAM_TEXT_MAX = 1000

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

type Raw = Record<string, unknown>
const isObject = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)

/** Texte d'un libellé dans une langue. */
export function labelText(label: ParamLabel | undefined, locale: 'fr' | 'en'): string {
  if (label === undefined) return ''
  if (typeof label === 'string') return label
  return label[locale] || label.fr || label.en || ''
}

function validLabel(v: unknown): ParamLabel | null {
  if (typeof v === 'string') return v.trim() ? v.trim() : null
  if (isObject(v) && typeof v.fr === 'string' && typeof v.en === 'string' && (v.fr.trim() || v.en.trim())) {
    return { fr: v.fr.trim(), en: v.en.trim() }
  }
  return null
}

function isDay(v: string): boolean {
  if (!DAY_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/**
 * Format d'une valeur pour un paramètre : chaîne (espaces de bord retirés, vide → `null`) ; `enum`
 * parmi les valeurs déclarées ; `text` d'au plus `PARAM_TEXT_MAX` caractères ; `period` `{ from, to }`
 * en jours `AAAA-MM-JJ`, `from ≤ to`, les deux vides → `null`.
 */
export function normalizeParamValue(def: Pick<QueryParameterDef, 'kind' | 'values'>, v: unknown): { ok: true; value: GraphParamValue } | { ok: false; reason: string } {
  if (v === undefined || v === null) return { ok: true, value: null }
  if (def.kind === 'period') {
    if (!isObject(v)) return { ok: false, reason: 'période attendue : { from, to }' }
    const bound = (b: unknown): string | null | false => {
      if (b === undefined || b === null || b === '') return null
      return typeof b === 'string' && isDay(b) ? b : false
    }
    const from = bound(v.from)
    const to = bound(v.to)
    if (from === false || to === false) return { ok: false, reason: 'dates attendues au format AAAA-MM-JJ' }
    if (from && to && from > to) return { ok: false, reason: 'la date de début est postérieure à la date de fin' }
    return { ok: true, value: from === null && to === null ? null : { from, to } }
  }
  if (typeof v !== 'string') return { ok: false, reason: 'texte attendu' }
  const s = v.trim()
  if (!s) return { ok: true, value: null }
  if (def.kind === 'text' && s.length > PARAM_TEXT_MAX) return { ok: false, reason: `au plus ${PARAM_TEXT_MAX} caractères` }
  if (def.kind === 'enum' && !(def.values ?? []).some((x) => x.value === s)) return { ok: false, reason: `valeur non déclarée : ${s}` }
  return { ok: true, value: s }
}

/**
 * Déclaration lue (fichier, MCP, éditeur) : déclarations normalisées (propriétés connues seulement)
 * et erreurs lisibles. Absente → `[]`.
 */
export function validateParameterDecls(raw: unknown): { decls: QueryParameterDef[]; errors: string[] } {
  if (raw === undefined || raw === null) return { decls: [], errors: [] }
  if (!Array.isArray(raw)) return { decls: [], errors: ['parameters : liste attendue'] }
  const decls: QueryParameterDef[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  raw.forEach((item, i) => {
    const where = `paramètre ${i + 1}`
    if (!isObject(item)) { errors.push(`${where} : objet attendu`); return }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const at = name ? `paramètre « ${name} »` : where
    let ok = true
    if (!NAME_RE.test(name)) { errors.push(`${at} : nom invalide (lettre puis lettres, chiffres ou _)`); ok = false }
    else if (seen.has(name)) { errors.push(`${at} : nom en double`); ok = false }
    seen.add(name)
    const kind = item.kind as QueryParameterKind
    if (!QUERY_PARAMETER_KINDS.includes(kind)) { errors.push(`${at} : type inconnu (${String(item.kind)})`); ok = false }
    const label = validLabel(item.label)
    if (!label) { errors.push(`${at} : libellé manquant`); ok = false }
    let values: QueryParameterDef['values']
    if (kind === 'enum') {
      if (!Array.isArray(item.values) || item.values.length === 0) { errors.push(`${at} : valeurs manquantes`); ok = false }
      else {
        values = []
        const vs = new Set<string>()
        for (const x of item.values) {
          const value = isObject(x) && typeof x.value === 'string' ? x.value.trim() : typeof x === 'string' ? x.trim() : ''
          if (!value || vs.has(value)) { errors.push(`${at} : valeur vide ou en double`); ok = false; continue }
          vs.add(value)
          const l = isObject(x) ? validLabel(x.label) : null
          values.push(l ? { value, label: l } : { value })
        }
      }
    } else if (item.values !== undefined) {
      errors.push(`${at} : valeurs réservées au type enum`); ok = false
    }
    if (item.required !== undefined && typeof item.required !== 'boolean') { errors.push(`${at} : required doit être un booléen`); ok = false }
    let def: GraphParamValue = null
    if (ok && item.default !== undefined && item.default !== null) {
      const n = normalizeParamValue({ kind, values }, item.default)
      if (!n.ok) { errors.push(`${at} : défaut invalide (${n.reason})`); ok = false }
      else def = n.value
    }
    if (!ok) return
    decls.push({
      name, kind, label: label!,
      ...(values ? { values } : {}),
      ...(def !== null ? { default: def } : {}),
      ...(item.required === true ? { required: true } : {}),
    })
  })
  return { decls: errors.length ? [] : decls, errors }
}

/**
 * Valeurs passées au script. Clé non déclarée → refus ; clé fournie (même `null` : « Tous / Toutes »
 * choisi) → valeur normalisée ; absente → `default`, sinon `null` ; `required` sans valeur → refus.
 */
export function resolveRunParams(
  decls: QueryParameterDef[],
  given: Record<string, unknown> | undefined,
): { ok: true; params: Record<string, GraphParamValue> } | { ok: false; message: string; missing?: string[] } {
  const known = new Set(decls.map((d) => d.name))
  const extra = Object.keys(given ?? {}).filter((k) => !known.has(k))
  if (extra.length) return { ok: false, message: `Paramètre(s) non déclaré(s) : ${extra.join(', ')}.` }
  const params: Record<string, GraphParamValue> = {}
  const missing: string[] = []
  for (const d of decls) {
    const provided = given !== undefined && Object.prototype.hasOwnProperty.call(given, d.name)
    const n = normalizeParamValue(d, provided ? given![d.name] : d.default)
    if (!n.ok) return { ok: false, message: `Paramètre « ${d.name} » : ${n.reason}.` }
    if (d.required && n.value === null) missing.push(d.name)
    params[d.name] = n.value
  }
  if (missing.length) return { ok: false, message: `Paramètre(s) obligatoire(s) sans valeur : ${missing.join(', ')}.`, missing }
  return { ok: true, params }
}

// ─── Sélecteurs d'un dashboard ──────────────────────────────────────────────

/** Clé d'un sélecteur de la barre : deux requêtes déclarant le même couple le partagent. */
export function selectorKey(d: Pick<QueryParameterDef, 'name' | 'kind'>): string {
  return `${d.name}:${d.kind}`
}

export interface DashboardSelector {
  key: string
  name: string
  kind: QueryParameterKind
  label: ParamLabel
  values?: { value: string; label?: ParamLabel }[]
  /** Premier défaut valide parmi les déclarations regroupées. */
  default: GraphParamValue
  /** Vrai si l'une des déclarations l'exige. */
  required: boolean
  /** Widgets dont la requête déclare ce couple. */
  widgetIds: string[]
}

/**
 * Sélecteurs d'un dashboard, dans l'ordre de première apparition (widgets dans l'ordre fourni, puis
 * ordre de déclaration). Libellé : celui de la première déclaration ; `enum` : union des valeurs.
 */
export function dashboardSelectors(
  widgets: readonly { id: string; queryId: string }[],
  declsOf: (queryId: string) => readonly QueryParameterDef[] | undefined,
): DashboardSelector[] {
  const out = new Map<string, DashboardSelector>()
  for (const w of widgets) {
    for (const d of declsOf(w.queryId) ?? []) {
      const key = selectorKey(d)
      let s = out.get(key)
      if (!s) {
        s = { key, name: d.name, kind: d.kind, label: d.label, default: null, required: false, widgetIds: [] }
        if (d.kind === 'enum') s.values = []
        out.set(key, s)
      }
      if (!s.widgetIds.includes(w.id)) s.widgetIds.push(w.id)
      if (d.required) s.required = true
      if (s.values) for (const v of d.values ?? []) if (!s.values.some((x) => x.value === v.value)) s.values.push(v)
      if (s.default === null && d.default !== undefined && d.default !== null) s.default = d.default
    }
  }
  return [...out.values()]
}

/**
 * Valeurs de la requête d'un widget, à partir des valeurs des sélecteurs (clé `name:kind`) : un
 * sélecteur sans valeur choisie n'est pas transmis (le main applique le défaut de la déclaration),
 * ni une valeur d'énumération que cette requête ne déclare pas (sélecteur partagé dont les valeurs
 * sont l'union des requêtes, ou valeur retirée de la déclaration depuis le choix).
 */
export function paramsForQuery(
  decls: readonly QueryParameterDef[] | undefined,
  values: Readonly<Record<string, GraphParamValue>>,
): Record<string, GraphParamValue> {
  const out: Record<string, GraphParamValue> = {}
  for (const d of decls ?? []) {
    const key = selectorKey(d)
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue
    const v = values[key]
    if (d.kind === 'enum' && v !== null && !(d.values ?? []).some((x) => x.value === v)) continue
    out[d.name] = v
  }
  return out
}

// ─── Affichage ──────────────────────────────────────────────────────────────

/** « Toutes » / « Tous » selon le type (campagne, valeurs : féminin). */
export function noneText(kind: QueryParameterKind, locale: 'fr' | 'en'): string {
  if (locale === 'en') return 'All'
  return kind === 'component' || kind === 'objectType' ? 'Tous' : 'Toutes'
}

/**
 * Valeur lisible (impression, docx). `titleOf` donne le libellé d'une campagne, d'un composant ou
 * d'un type d'objet (sinon la valeur brute).
 */
export function paramValueText(
  sel: Pick<DashboardSelector, 'kind' | 'values'>,
  v: GraphParamValue,
  locale: 'fr' | 'en',
  titleOf?: (kind: QueryParameterKind, value: string) => string | undefined,
): string {
  if (v === null) return sel.kind === 'text' ? '—' : noneText(sel.kind, locale)
  if (typeof v !== 'string') {
    const en = locale === 'en'
    if (v.from && v.to) return en ? `from ${v.from} to ${v.to}` : `du ${v.from} au ${v.to}`
    if (v.from) return en ? `from ${v.from}` : `à partir du ${v.from}`
    return en ? `until ${v.to}` : `jusqu'au ${v.to}`
  }
  if (sel.kind === 'enum') {
    const found = sel.values?.find((x) => x.value === v)
    return found?.label ? labelText(found.label, locale) : v
  }
  if (sel.kind === 'text') return v
  return titleOf?.(sel.kind, v) ?? v
}
