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
export type ComputedColumnType = Exclude<SchemaFieldType, 'drawio' | 'link'>

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
  /** Colonne du résultat qui porte l'ID de l'élément (défaut `id`). */
  idColumn?: string
  /** Colonne du résultat qui porte la valeur (défaut `value`). */
  valueColumn?: string
  /** Colonne du résultat qui porte l'infobulle (défaut `tooltip` ; absente → pas d'infobulle). */
  tooltipColumn?: string
  /** GH126 — colonne éclatée : une sous-colonne par valeur distincte de cette colonne du résultat. */
  splitColumn?: string
  /** GH126 — libellé de chaque sous-colonne (défaut : la valeur de `splitColumn`). */
  splitLabelColumn?: string
}

/** GH126 — nombre maximal de sous-colonnes d'une colonne éclatée. */
export const MAX_SPLIT_COLUMNS = 50

export const COLUMN_DEFAULT_ID = 'id'
export const COLUMN_DEFAULT_VALUE = 'value'
export const COLUMN_DEFAULT_TOOLTIP = 'tooltip'

export const COMPUTED_COLUMN_TYPES: readonly ComputedColumnType[] = [
  'text', 'textarea', 'number', 'enum', 'multi_enum', 'boolean', 'date', 'datetime', 'richtext', 'user',
]
export const COMPUTED_COLUMN_CATEGORIES: readonly ComputedColumnCategory[] = ['requirement', 'test']
const CATEGORIES = COMPUTED_COLUMN_CATEGORIES

export const COMPUTED_COLUMN_PREFIX = 'query::'

/** Clé de la colonne dans `fieldVisibility` et dans les objets affichés : `query::<ID>`, ou pour une
 *  sous-colonne d'une colonne éclatée (GH126) `query::<ID>::<valeur>`. */
export function computedColumnKey(queryId: string, split?: string): string {
  return split === undefined ? `${COMPUTED_COLUMN_PREFIX}${queryId}` : `${COMPUTED_COLUMN_PREFIX}${queryId}::${split}`
}

/** Inverse de `computedColumnKey` (`null` si ce n'est pas une clé de colonne calculée). L'ID de
 *  requête ne contient jamais `::` : tout ce qui suit le premier `::` est la valeur. */
export function parseComputedColumnKey(key: string): { queryId: string; split?: string } | null {
  if (!key.startsWith(COMPUTED_COLUMN_PREFIX)) return null
  const rest = key.slice(COMPUTED_COLUMN_PREFIX.length)
  const i = rest.indexOf('::')
  if (i === -1) return rest ? { queryId: rest } : null
  return { queryId: rest.slice(0, i), split: rest.slice(i + 2) }
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

  // Colonnes du résultat (GH70 sprint 3) : nom non vide si fourni ; vide / null = défaut.
  // Colonne éclatée (GH126) : `splitColumn` / `splitLabelColumn`, même règle.
  const mapping: Pick<QueryColumnDef, 'idColumn' | 'valueColumn' | 'tooltipColumn' | 'splitColumn' | 'splitLabelColumn'> = {}
  for (const key of ['idColumn', 'valueColumn', 'tooltipColumn', 'splitColumn', 'splitLabelColumn'] as const) {
    const v = raw[key]
    if (v === undefined || v === null || v === '') continue
    if (typeof v !== 'string' || !v.trim()) errors.push(`column.${key} : nom de colonne attendu`)
    else mapping[key] = v.trim()
  }
  if (mapping.splitLabelColumn && !mapping.splitColumn && !errors.some((e) => e.startsWith('column.splitColumn'))) {
    errors.push('column.splitLabelColumn : réservé aux colonnes éclatées (splitColumn)')
  }
  // Éclater sur l'identifiant ou la valeur n'a pas de sens (une sous-colonne par élément / par valeur).
  if (mapping.splitColumn && [mapping.idColumn || COLUMN_DEFAULT_ID, mapping.valueColumn || COLUMN_DEFAULT_VALUE].includes(mapping.splitColumn)) {
    errors.push(`column.splitColumn : doit différer des colonnes identifiant et valeur (${mapping.splitColumn})`)
  }

  if (errors.length) return { decl: null, errors }
  return {
    decl: { label: label!, appliesTo: { categories, objectTypes }, type, ...(values ? { values } : {}), ...mapping },
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

/** `SchemaField` synthétique : la cellule est rendue comme un champ de ce type. Sous-colonne d'une
 *  colonne éclatée (GH126) : `split` donne sa valeur (clé) et son libellé. */
export function columnFieldDef(queryId: string, decl: QueryColumnDef, locale: 'fr' | 'en', split?: { value: string; label: string }): SchemaField {
  return {
    name: computedColumnKey(queryId, split?.value),
    label: split ? split.label : columnLabel(decl, locale),
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
 * Valeurs d'une colonne à partir des lignes du script (spec §4, §9). Colonnes lues : `idColumn` /
 * `valueColumn` / `tooltipColumn` de la déclaration, à défaut `id` / `value` / `tooltip`. Première
 * ligne d'un ID retenue ; ligne sans ID ou sans valeur → `error` (aucune valeur rendue).
 */
export function columnValuesFromRows(
  rows: readonly GraphRow[],
  decl?: Pick<QueryColumnDef, 'idColumn' | 'valueColumn' | 'tooltipColumn'> | null,
): { values: Map<string, ComputedCell>; error?: string } {
  const read = rowReader(decl)
  const values = new Map<string, ComputedCell>()
  for (let i = 0; i < rows.length; i++) {
    const r = read(rows[i] as Raw, i)
    if ('error' in r) return { values: new Map(), error: r.error }
    if (!values.has(r.id)) values.set(r.id, r.cell)
  }
  return { values }
}

/** Sous-colonne d'une colonne éclatée (GH126). */
export interface SplitColumnValues {
  /** Valeur de `splitColumn` (texte) : suffixe de la clé `query::<ID>::<valeur>`. */
  split: string
  label: string
  values: Map<string, ComputedCell>
}

/**
 * GH126 — lignes d'une colonne éclatée → sous-colonnes, dans l'ordre de première apparition de leur
 * valeur de `splitColumn`. Libellé = premier `splitLabelColumn` non vide (texte ou nombre) parmi les
 * lignes de la sous-colonne, à défaut la valeur. Première ligne d'un couple (élément, sous-colonne)
 * retenue. Ligne sans ID, valeur ou valeur de split, ou plus de `MAX_SPLIT_COLUMNS` valeurs → `error`
 * (aucune sous-colonne rendue).
 */
export function splitColumnValuesFromRows(
  rows: readonly GraphRow[],
  decl: Pick<QueryColumnDef, 'idColumn' | 'valueColumn' | 'tooltipColumn' | 'splitColumn' | 'splitLabelColumn'>,
): { columns: SplitColumnValues[]; error?: string } {
  const splitCol = decl.splitColumn ?? ''
  const read = rowReader(decl)
  const columns = new Map<string, SplitColumnValues>()
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i] as Raw
    const r = read(raw, i)
    if ('error' in r) return { columns: [], error: r.error }
    const split = scalarText(raw[splitCol])
    if (!split) return { columns: [], error: `Ligne ${i + 1} (${r.id}) : colonne « ${splitCol} » manquante.` }
    let col = columns.get(split)
    if (!col) {
      if (columns.size >= MAX_SPLIT_COLUMNS) {
        const total = new Set(rows.map((x) => scalarText((x as Raw)[splitCol])).filter(Boolean)).size
        return { columns: [], error: `${MAX_SPLIT_COLUMNS} sous-colonnes au maximum (${total} trouvées).` }
      }
      col = { split, label: '', values: new Map() }
      columns.set(split, col)
    }
    // Libellé : premier `splitLabelColumn` non vide parmi les lignes de la sous-colonne.
    if (!col.label && decl.splitLabelColumn) col.label = scalarText(raw[decl.splitLabelColumn])
    if (!col.values.has(r.id)) col.values.set(r.id, r.cell)
  }
  for (const col of columns.values()) if (!col.label) col.label = col.split
  return { columns: [...columns.values()] }
}

/** Texte d'un scalaire (chaîne non vide après `trim`, ou nombre) ; sinon `''`. */
function scalarText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

/** Lecture d'une ligne : ID et cellule, ou l'erreur de la colonne. */
function rowReader(decl?: Pick<QueryColumnDef, 'idColumn' | 'valueColumn' | 'tooltipColumn'> | null) {
  const idCol = decl?.idColumn || COLUMN_DEFAULT_ID
  const valueCol = decl?.valueColumn || COLUMN_DEFAULT_VALUE
  const tooltipCol = decl?.tooltipColumn || COLUMN_DEFAULT_TOOLTIP
  return (r: Raw, i: number): { id: string; cell: ComputedCell } | { error: string } => {
    const id = scalarText(r[idCol])
    if (!id) return { error: `Ligne ${i + 1} : colonne « ${idCol} » manquante (ID de l'élément attendu).` }
    if (!Object.prototype.hasOwnProperty.call(r, valueCol)) return { error: `Ligne ${i + 1} (${id}) : colonne « ${valueCol} » manquante.` }
    const ids = Array.isArray(r._ids) ? r._ids.filter((x): x is string => typeof x === 'string' && !!x) : []
    const tooltip = r[tooltipCol]
    return {
      id,
      cell: {
        value: cellText(r[valueCol]),
        // Infobulle : texte ou nombre seulement (un objet s'afficherait « [object Object] »).
        ...((typeof tooltip === 'string' && tooltip) || typeof tooltip === 'number' ? { tooltip: String(tooltip) } : {}),
        ...(ids.length ? { target: ids[0] } : {}),
      },
    }
  }
}
