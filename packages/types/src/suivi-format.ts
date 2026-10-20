// GH74 — format des requêtes et dashboards (specs/GH74.md §5.3) : migrations PURES appliquées à la
// lecture. Rien n'est réécrit sur disque ici : l'objet migré n'est enregistré qu'à la prochaine
// modification par l'utilisateur. Un fichier d'une version plus récente est lu en lecture seule.

import { SUIVI_FORMAT_VERSION } from './dashboard'
import type { WidgetSize } from './dashboard'
import { findQueryTemplate, findWidgetTemplate } from './suivi-templates'
import type { TemplateRef, WidgetCode } from './suivi-templates'
import type { QueryParameterDef } from './suivi-params'
import type { QueryColumnDef } from './suivi-columns'

/** `query.yaml` (partagé) ou entrée `savedQueries` du `.pref` (privé, avec `script`). */
export interface StoredQuery {
  id: string
  title: string
  formatVersion: number
  template?: Omit<TemplateRef, 'hash'> & { hash: string }
  /** GH93 — paramètres choisis à l'affichage (omis si aucun). */
  parameters?: QueryParameterDef[]
  /** GH70 — colonne calculée de la Vue Système (requête partagée ; omis si aucune). */
  column?: QueryColumnDef
  createdBy: string
  createdAt: string
  script?: string
}

export interface StoredWidget {
  id: string
  title: string
  queryId: string
  size: WidgetSize
  template?: TemplateRef
  transform?: string
  spec?: string
}

/** `dashboard.yaml` (partagé) ou entrée `dashboards` du `.pref` (privé, code des widgets inclus). */
export interface StoredDashboard {
  id: string
  title: string
  formatVersion: number
  widgetOrder: string[]
  widgets: StoredWidget[]
  createdBy: string
  createdAt: string
}

/** Requête lue : script résolu, modèle éventuel (sans empreinte si elle reste à calculer). */
export interface ReadQuery {
  id: string
  title: string
  formatVersion: number
  script: string
  template?: { id: string; version: number; params: Record<string, unknown>; hash?: string }
  /** GH93 — déclaration telle que lue, NON validée (le service la valide). */
  parameters?: unknown
  /** GH70 — déclaration de colonne telle que lue, NON validée (le service la valide). */
  column?: unknown
  createdBy: string
  createdAt: string
  legacySql?: string
  readOnly?: 'newer-format' | 'legacy-sql'
  legacyFormat?: boolean
}

export interface ReadWidget {
  id: string
  title: string
  queryId: string
  size: WidgetSize
  transform?: string
  spec: string
  template?: { id: string; version: number; params: Record<string, unknown>; hash?: string }
  legacyFormat?: boolean
}

export interface ReadDashboard {
  id: string
  title: string
  formatVersion: number
  widgetOrder: string[]
  widgets: ReadWidget[]
  createdBy: string
  createdAt: string
  readOnly?: 'newer-format'
  legacyFormat?: boolean
}

type Raw = Record<string, unknown>

/** Colonnes de l'ancien moteur SQL qui n'existent plus (indicateurs de suivi sortis de Polenta). */
const REMOVED_COLUMNS = new Set(['progress', 'progressRank', 'testStatus', 'campaignObjectTypeRef'])

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const sizeOf = (v: unknown): WidgetSize => (v === 'sm' || v === 'md' || v === 'lg' ? v : 'md')

/** Migrations successives du format, de la version `n` à `n + 1` (aucune en v1). */
const QUERY_MIGRATIONS: Record<number, (raw: Raw) => Raw> = {}
const DASHBOARD_MIGRATIONS: Record<number, (raw: Raw) => Raw> = {}

function upgrade(raw: Raw, migrations: Record<number, (raw: Raw) => Raw>): Raw {
  let out = raw
  let v = Number(out.formatVersion)
  while (v < SUIVI_FORMAT_VERSION && migrations[v]) {
    out = migrations[v](out)
    v++
    out = { ...out, formatVersion: v }
  }
  return out
}

/**
 * Requête lue (fichier `query.yaml` + `script.js`, entrée du `.pref`, ou fichier d'avant GH74).
 * Format d'avant GH74 (`formatVersion` absent) : `mode: builder` → modèle « Liste filtrée » aux mêmes
 * paramètres ; `mode: sql` → lecture seule (`legacy-sql`), texte SQL conservé.
 */
export function readQueryRecord(raw: Raw, script?: string): ReadQuery {
  const base = { id: str(raw.id), title: str(raw.title), createdBy: str(raw.createdBy), createdAt: str(raw.createdAt) }
  if (raw.formatVersion === undefined) {
    if (raw.mode === 'sql') {
      return { ...base, formatVersion: SUIVI_FORMAT_VERSION, script: '', legacySql: str(raw.sqlText), readOnly: 'legacy-sql', legacyFormat: true }
    }
    const params = { ...((raw.builderConfig as Raw | undefined) ?? {}) }
    // Colonnes calculées par l'ancien moteur, retirées (indicateurs de suivi, GH79) : une telle
    // requête ne peut pas être convertie sans changer de sens — lecture seule, comme le SQL.
    const used = [
      ...((params.conditions as { field?: unknown }[] | undefined) ?? []).map((c) => String(c.field)),
      ...((params.groupBy as unknown[] | undefined) ?? []).map(String),
    ]
    if (used.some((f) => REMOVED_COLUMNS.has(f) || f.startsWith('maturity'))) {
      return { ...base, formatVersion: SUIVI_FORMAT_VERSION, script: '', legacySql: `builder : ${JSON.stringify(raw.builderConfig, null, 2)}`, readOnly: 'legacy-sql', legacyFormat: true }
    }
    const tpl = findQueryTemplate('filtered-list')!
    return { ...base, formatVersion: SUIVI_FORMAT_VERSION, script: tpl.generate(params), template: { id: tpl.id, version: tpl.version, params }, legacyFormat: true }
  }
  const version = Number(raw.formatVersion)
  if (!(version <= SUIVI_FORMAT_VERSION)) {
    return { ...base, formatVersion: version, script: script ?? str(raw.script), readOnly: 'newer-format' }
  }
  const up = upgrade(raw, QUERY_MIGRATIONS)
  return {
    ...base,
    formatVersion: SUIVI_FORMAT_VERSION,
    script: script ?? str(up.script),
    ...(up.template ? { template: up.template as ReadQuery['template'] } : {}),
    ...(up.parameters !== undefined ? { parameters: up.parameters } : {}),
    ...(up.column !== undefined ? { column: up.column } : {}),
  }
}

/** Correspondance d'un widget d'avant GH74 (`type` + `fieldMapping`) avec un modèle de widget. */
export function legacyWidgetTemplate(type: string, mapping: Raw): { id: string; params: Raw } | null {
  const m = (k: string) => (typeof mapping[k] === 'string' && mapping[k] !== '' ? mapping[k] as string : undefined)
  // L'ancienne requête SQL / builder renvoyait des lignes déjà agrégées : la mesure est une colonne
  // du résultat, sommée par groupe (identique à l'ancien rendu).
  const sum = m('measure') ? { measure: 'sum', measureColumn: m('measure') } : { measure: 'count' }
  const entryColors = m('series') === 'status' || m('series') === 'progress' || undefined
  switch (type) {
    case 'bar': return { id: 'bar', params: { category: m('category'), series: m('series'), ...sum, stacked: mapping.stacked === true || undefined, entryColors } }
    case 'pie': return { id: 'pie', params: { category: m('category'), ...sum } }
    case 'line': return { id: 'line', params: { category: m('category'), series: m('series'), ...sum } }
    case 'kpi': return { id: 'kpi', params: { ...sum } }
    case 'table': return { id: 'table', params: { columns: Array.isArray(mapping.columns) ? mapping.columns : undefined } }
    case 'matrix': return { id: 'matrix', params: { row: m('category'), column: m('series'), value: m('measure'), label: m('label'), entryColors: true } }
    default: return null
  }
}

/** Code d'un widget lu : `codes` = fichiers `<id>.js` / `<id>.vl.json` (partagé) ; sinon dans l'entrée. */
function readWidget(raw: Raw, legacy: boolean, code?: Partial<WidgetCode>): ReadWidget {
  const base = { id: str(raw.id), title: str(raw.title), queryId: str(raw.queryId), size: sizeOf(raw.size) }
  if (legacy) {
    const map = legacyWidgetTemplate(str(raw.type), (raw.fieldMapping as Raw | undefined) ?? {})
    const tpl = map ? findWidgetTemplate(map.id) : undefined
    if (tpl && map) {
      const generated = tpl.generate(map.params)
      return { ...base, ...generated, template: { id: tpl.id, version: tpl.version, params: map.params }, legacyFormat: true }
    }
    return { ...base, spec: '{}', legacyFormat: true }
  }
  const transform = code?.transform ?? (typeof raw.transform === 'string' ? raw.transform : undefined)
  return {
    ...base,
    ...(transform !== undefined ? { transform } : {}),
    spec: code?.spec ?? str(raw.spec, '{}'),
    ...(raw.template ? { template: raw.template as ReadWidget['template'] } : {}),
  }
}

/** Dashboard lu ; `codes` : code des widgets d'un dashboard partagé (fichiers à côté de `dashboard.yaml`). */
export function readDashboardRecord(raw: Raw, codes: Record<string, Partial<WidgetCode>> = {}): ReadDashboard {
  const base = { id: str(raw.id), title: str(raw.title), createdBy: str(raw.createdBy), createdAt: str(raw.createdAt) }
  const widgetsRaw = (Array.isArray(raw.widgets) ? raw.widgets : []) as Raw[]
  const order = Array.isArray(raw.widgetOrder) ? (raw.widgetOrder as string[]) : widgetsRaw.map((w) => str(w.id))
  if (raw.formatVersion === undefined) {
    return {
      ...base, formatVersion: SUIVI_FORMAT_VERSION, widgetOrder: order, legacyFormat: true,
      widgets: widgetsRaw.map((w) => readWidget(w, true)),
    }
  }
  const version = Number(raw.formatVersion)
  if (!(version <= SUIVI_FORMAT_VERSION)) {
    return {
      ...base, formatVersion: version, widgetOrder: order, readOnly: 'newer-format',
      widgets: widgetsRaw.map((w) => readWidget(w, false, codes[str(w.id)])),
    }
  }
  const up = upgrade(raw, DASHBOARD_MIGRATIONS)
  const widgets = (Array.isArray(up.widgets) ? up.widgets : []) as Raw[]
  return {
    ...base, formatVersion: SUIVI_FORMAT_VERSION, widgetOrder: order,
    widgets: widgets.map((w) => readWidget(w, false, codes[str(w.id)])),
  }
}
