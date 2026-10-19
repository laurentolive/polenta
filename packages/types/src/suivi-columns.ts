import type { GraphRow } from './graph'
import type { SchemaField, SchemaFieldType } from './schema'
import type { ParamLabel } from './suivi-params'
import { labelText, validLabel } from './suivi-params'

// GH70 — colonnes calculées définies par le projet (specs/GH70.md, GH70-design.md §1.1). Une colonne
// est une requête partagée qui porte une déclaration `column` ; son script renvoie une ligne par
// élément (`id`, `value`, `tooltip?`, `_ids?`). Logique pure partagée par le main (enregistrement),
// le serveur MCP et le renderer (vues). Aucune connaissance des campagnes ici : le calcul est
// entièrement dans le script du projet.

export type ComputedColumnCategory = 'requirement' | 'test'
export type ComputedColumnType = Exclude<SchemaFieldType, 'drawio'>

/** Déclaration `column` d'une requête partagée. */
export interface QueryColumnDef {
  /** Libellé de la colonne (en-tête, panneau ⚙️, exports) : bilingue ou texte unique. */
  label: ParamLabel
  /** Types d'objet pour lesquels la colonne est proposée : catégorie OU type précis. */
  appliesTo: { categories: ComputedColumnCategory[]; objectTypes: string[] }
  /** Type de champ qui gouverne le rendu de la cellule. */
  type: ComputedColumnType
  /** `enum` / `multi_enum` : valeurs possibles (obligatoire, non vide). */
  values?: string[]
}

export const COMPUTED_COLUMN_TYPES: readonly ComputedColumnType[] = [
  'text', 'textarea', 'number', 'enum', 'multi_enum', 'boolean', 'date', 'datetime', 'richtext', 'user',
]
export const COMPUTED_COLUMN_CATEGORIES: readonly ComputedColumnCategory[] = ['requirement', 'test']
const CATEGORIES = COMPUTED_COLUMN_CATEGORIES

export const COMPUTED_COLUMN_PREFIX = 'query::'

/** Clé de la colonne dans `fieldVisibility` et dans les objets affichés. */
export function computedColumnKey(queryId: string): string {
  return `${COMPUTED_COLUMN_PREFIX}${queryId}`
}

export function isComputedColumnKey(col: string): boolean {
  return col.startsWith(COMPUTED_COLUMN_PREFIX)
}

type Raw = Record<string, unknown>
const isObject = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)

function stringList(v: unknown): string[] | null {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return null
  return [...new Set(v.map((x) => x.trim()).filter(Boolean))]
}

/**
 * Déclaration lue (fichier, MCP, éditeur) : normalisée (propriétés connues seulement) et erreurs
 * lisibles. Absente (`undefined` / `null`) → `{ decl: null, errors: [] }`.
 */
export function validateColumnDecl(raw: unknown): { decl: QueryColumnDef | null; errors: string[] } {
  if (raw === undefined || raw === null) return { decl: null, errors: [] }
  if (!isObject(raw)) return { decl: null, errors: ['column : objet attendu'] }
  const errors: string[] = []
  const label = validLabel(raw.label)
  if (!label) errors.push('column : libellé manquant')

  let categories: ComputedColumnCategory[] = []
  let objectTypes: string[] = []
  if (raw.appliesTo !== undefined && !isObject(raw.appliesTo)) {
    errors.push('column.appliesTo : objet attendu')
  } else {
    const a = (raw.appliesTo ?? {}) as Raw
    const cats = stringList(a.categories)
    if (!cats) errors.push('column.appliesTo.categories : liste attendue')
    else {
      const unknown = cats.filter((c) => !CATEGORIES.includes(c as ComputedColumnCategory))
      if (unknown.length) errors.push(`column.appliesTo.categories : catégorie inconnue (${unknown.join(', ')})`)
      categories = cats.filter((c): c is ComputedColumnCategory => CATEGORIES.includes(c as ComputedColumnCategory))
    }
    const types = stringList(a.objectTypes)
    if (!types) errors.push('column.appliesTo.objectTypes : liste attendue')
    else {
      const bad = types.filter((t) => !/^[^:\s]+::[^:\s]+$/.test(t))
      if (bad.length) errors.push(`column.appliesTo.objectTypes : référence <nœud>::<type> attendue (${bad.join(', ')})`)
      objectTypes = types
    }
  }

  const type = raw.type as ComputedColumnType
  if (!COMPUTED_COLUMN_TYPES.includes(type)) errors.push(`column.type : type de champ non pris en charge (${String(raw.type)})`)
  let values: string[] | undefined
  if (type === 'enum' || type === 'multi_enum') {
    const vs = stringList(raw.values)
    if (!vs || vs.length === 0) errors.push('column.values : valeurs manquantes')
    else values = vs
  } else if (raw.values !== undefined && raw.values !== null) {
    errors.push('column.values : réservé aux types enum et multi_enum')
  }

  if (errors.length) return { decl: null, errors }
  return {
    decl: { label: label!, appliesTo: { categories, objectTypes }, type, ...(values ? { values } : {}) },
    errors: [],
  }
}

/** Colonne proposée pour le type affiché : sa catégorie OU son `objectTypeRef` est déclaré. */
export function columnAppliesTo(decl: QueryColumnDef, category: string | undefined, objectTypeRef: string | undefined): boolean {
  return (!!category && decl.appliesTo.categories.includes(category as ComputedColumnCategory))
    || (!!objectTypeRef && decl.appliesTo.objectTypes.includes(objectTypeRef))
}

export function columnLabel(decl: QueryColumnDef, locale: 'fr' | 'en'): string {
  return labelText(decl.label, locale)
}

/** `SchemaField` synthétique : la cellule est rendue comme un champ de ce type. */
export function columnFieldDef(queryId: string, decl: QueryColumnDef, locale: 'fr' | 'en'): SchemaField {
  return {
    name: computedColumnKey(queryId),
    label: columnLabel(decl, locale),
    type: decl.type,
    ...(decl.values ? { values: decl.values } : {}),
  }
}

/** Valeur d'une cellule calculée. */
export interface ComputedCell {
  value: string
  tooltip?: string
  /** Premier `_ids` de la ligne : objet ouvert au double-clic. */
  target?: string
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(cellText).join(', ')
  return String(v)
}

/**
 * Valeurs d'une colonne à partir des lignes du script (spec §4). Première ligne d'un `id` retenue ;
 * ligne sans `id` ou sans `value` → `error` (aucune valeur rendue).
 */
export function columnValuesFromRows(rows: readonly GraphRow[]): { values: Map<string, ComputedCell>; error?: string } {
  const values = new Map<string, ComputedCell>()
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Raw
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    if (!id) return { values: new Map(), error: `Ligne ${i + 1} : colonne « id » manquante (ID de l'élément attendu).` }
    if (!Object.prototype.hasOwnProperty.call(r, 'value')) return { values: new Map(), error: `Ligne ${i + 1} (${id}) : colonne « value » manquante.` }
    if (values.has(id)) continue
    const ids = Array.isArray(r._ids) ? r._ids.filter((x): x is string => typeof x === 'string' && !!x) : []
    values.set(id, {
      value: cellText(r.value),
      ...(typeof r.tooltip === 'string' && r.tooltip ? { tooltip: r.tooltip } : {}),
      ...(ids.length ? { target: ids[0] } : {}),
    })
  }
  return { values }
}
