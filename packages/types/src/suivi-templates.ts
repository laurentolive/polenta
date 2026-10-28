// GH74 — modèles de la vue Suivi (specs/GH74.md §7, GH74-design.md §1.4) : un formulaire produit
// le code (script de données, ou transformation + spec Vega-Lite d'un widget). Logique pure,
// partagée par le main (enregistrement, migrations, seeds, MCP) et le renderer (formulaires).
//
// Les générateurs sont DÉTERMINISTES (mêmes paramètres → même texte) : l'empreinte du code généré,
// stockée avec l'objet, permet de savoir s'il a été modifié à la main (« personnalisé »).
// Le code généré n'importe rien de la bibliothèque projet, sauf « Avancement dans le temps »
// (`lib/campaign.js`) : un projet sans bibliothèque reste utilisable.
//
// GH93 : une requête générée peut aussi déclarer des paramètres choisis à l'affichage (options
// « … choisi(e) à l'affichage ») ; le code lit alors `polenta.params`.

import type { QueryParameterDef } from './suivi-params'
import type { QueryColumnDef } from './suivi-columns'

export interface TemplateRef {
  id: string
  version: number
  params: Record<string, unknown>
  /** Empreinte du code généré : SHA-256 de `hashableText(code)` (cf. `queryCode` / `widgetCode`). */
  hash: string
}

export type TemplateParamKind =
  | 'objectType' | 'component' | 'conditions' | 'combinator' | 'columns' | 'column' | 'enum'
  | 'multiEnum' | 'campaigns' | 'boolean' | 'text'

export interface TemplateParamDef {
  name: string
  label: { fr: string; en: string }
  kind: TemplateParamKind
  required?: boolean
  /** Valeurs possibles (`enum`, `multiEnum`). */
  values?: { value: string; label: { fr: string; en: string } }[]
  /** Affiché seulement si le paramètre nommé a une valeur (ex. `series` → `stacked`). */
  dependsOn?: string
}

export interface QueryTemplate {
  id: QueryTemplateId
  version: number
  label: { fr: string; en: string }
  params: TemplateParamDef[]
  generate(params: Record<string, unknown>): string
  /** GH93 — paramètres choisis à l'affichage déclarés par la requête générée (déterministe). */
  parameters(params: Record<string, unknown>): QueryParameterDef[]
  /** GH70 — colonne calculée de la Vue Système déclarée par la requête générée, sinon absent. */
  column?(params: Record<string, unknown>): QueryColumnDef | null
}

export interface WidgetCode {
  transform?: string
  /** Spec Vega-Lite (texte JSON). */
  spec: string
}

export interface WidgetTemplate {
  id: WidgetTemplateId
  version: number
  label: { fr: string; en: string }
  params: TemplateParamDef[]
  generate(params: Record<string, unknown>): WidgetCode
}

export type QueryTemplateId = 'filtered-list' | 'campaign-entries' | 'campaign-timeline' | 'campaign-last-result' | 'campaign-results'
export type WidgetTemplateId = 'bar' | 'pie' | 'line' | 'kpi' | 'table' | 'matrix' | 'stacked-area'

/** Condition du modèle « Liste filtrée » (ex-builder). */
export interface FilterCondition {
  field: string
  operator: '=' | '!=' | '>' | '<' | 'contains' | 'in'
  value: unknown
}

export type MeasureOp = 'count' | 'sum' | 'min' | 'max' | 'distinct' | 'worst'

const ENTRY_ORDER = ['pending', 'INCOMPLETE', 'BLOCKED', 'FAIL', 'PASS']
const ENTRY_COLORS = [
  'var(--status-neutral-solid)', 'var(--chart-series-3)', 'var(--status-warning-solid)',
  'var(--status-danger-solid)', 'var(--status-success-solid)',
]

// ─── Outils de génération ───────────────────────────────────────────────────

/** JSON à clés triées (sortie stable, indépendante de l'ordre de saisie). */
export function stableJson(value: unknown, indent = 0): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]))
    }
    return v
  }
  return JSON.stringify(sort(value), null, indent || undefined)
}

/** Paramètres retenus (clés connues seulement, valeurs vides retirées), pour un code stable. */
function pick(params: Record<string, unknown>, defs: TemplateParamDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const d of defs) {
    const v = params[d.name]
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    out[d.name] = v
  }
  return out
}

function header(kind: 'Modèle' | 'Transformation', id: string, version: number): string {
  return `// @polenta contract 1\n// ${kind} « ${id} » v${version}, généré par Polenta. Modifier ce code détache l'objet de son modèle.\n`
}

const L = (fr: string, en: string) => ({ fr, en })

// ─── Paramètres choisis à l'affichage (GH93) ────────────────────────────────

const CAMPAIGN_PARAM: QueryParameterDef = { name: 'campaign', kind: 'campaign', label: L('Campagne', 'Campaign') }
const PERIOD_PARAM: QueryParameterDef = { name: 'period', kind: 'period', label: L('Période', 'Period') }
const COMPONENT_PARAM: QueryParameterDef = { name: 'component', kind: 'component', label: L('Composant', 'Component') }
const OBJECT_TYPE_PARAM: QueryParameterDef = { name: 'objectType', kind: 'objectType', label: L('Type d\'objet', 'Object type') }

const CAMPAIGN_AT_DISPLAY: TemplateParamDef = { name: 'campaignAtDisplay', label: L('Campagne choisie à l\'affichage', 'Campaign chosen when displayed'), kind: 'boolean' }

/** Retire une option booléenne des paramètres retenus ; vrai si elle était cochée. */
function takeFlag(p: Record<string, unknown>, name: string): boolean {
  const on = p[name] === true
  delete p[name]
  return on
}

/** Campagnes retenues : campagne choisie à l'affichage (filtres ignorés), sinon filtres du modèle. */
function campaignFilter(atDisplay: boolean): string {
  return atDisplay
    ? `  // Campagne choisie à l'affichage : ses seules entrées, filtres de campagne ignorés ; « Toutes » → filtres.
  const chosen = polenta.params.campaign
  const campaigns = chosen
    ? data.campaigns.filter((c) => c.id === chosen)
    : data.campaigns.filter((c) =>
      (!P.campaignStatuses || P.campaignStatuses.includes(c.status)) && (!P.campaignIds || P.campaignIds.includes(c.id)))`
    : `  const campaigns = data.campaigns.filter((c) =>
    (!P.campaignStatuses || P.campaignStatuses.includes(c.status)) && (!P.campaignIds || P.campaignIds.includes(c.id)))`
}

// ─── Code commun des scripts de données ─────────────────────────────────────

/** Valeur scalaire pour une ligne (tableau → « a, b », objet → JSON). */
const SCALAR = `function scalar(v) {
  if (v === undefined || v === null) return null
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x))).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}`

/** Jour local d'un instant, d'après les décalages fournis par l'hôte (pas d'Intl dans le moteur). */
const DAY_OF = `function dayOf(instant, polenta) {
  const t = Date.parse(instant)
  let off = 0
  for (const o of polenta.timezoneOffsets) { if (Date.parse(o.from) <= t) off = o.offsetMinutes; else break }
  return new Date(t + off * 60000).toISOString().slice(0, 10)
}`

const ENTRY_ROWS = `function entryRows(data, campaigns, polenta) {
  const tests = new Map(data.tests.map((t) => [t.id, t]))
  const rows = []
  for (const c of campaigns) {
    const custom = {}
    for (const k of Object.keys(c.fields || {})) custom['campaign_' + k] = scalar(c.fields[k])
    for (const e of c.entries) {
      const live = tests.get(e.testCaseId)
      rows.push(Object.assign({}, custom, {
        campaignId: c.id, campaignTitle: c.title, campaignStatus: c.status, campaignCreatedAt: c.createdAt,
        objectTypeRef: c.objectTypeRef, baselineRef: c.baselineRef, level: c.level, campaignComponent: c.targetComponent,
        component: c.component, entryId: e.entryId, testCaseId: e.testCaseId, requirementId: e.requirementId,
        testTitle: e.snapshot ? e.snapshot.title : (live ? live.title : null),
        status: e.status, executed: e.status !== 'pending', addedAt: e.addedAt, executedAt: e.executedAt,
        executedDay: e.executedAt ? dayOf(e.executedAt, polenta) : null, executedBy: e.executedBy, runId: e.runId,
        _ids: [c.id + '/' + e.entryId],
      }))
    }
  }
  return rows
}`

// ─── « Liste filtrée » (ex-builder) ─────────────────────────────────────────

const CATEGORY_VALUES = [
  { value: 'requirement', label: L('Exigences', 'Requirements') },
  { value: 'test', label: L('Tests', 'Tests') },
  { value: 'campaign', label: L('Entrées de campagne', 'Campaign entries') },
]

const FILTERED_LIST_PARAMS: TemplateParamDef[] = [
  { name: 'category', label: L('Tous les objets de la catégorie', 'All objects of category'), kind: 'enum', values: CATEGORY_VALUES },
  { name: 'objectTypeRef', label: L('Type d\'objet', 'Object type'), kind: 'objectType' },
  { name: 'component', label: L('Composant', 'Component'), kind: 'component' },
  { name: 'conditions', label: L('Conditions', 'Conditions'), kind: 'conditions' },
  { name: 'combinator', label: L('Combinaison', 'Combine'), kind: 'combinator' },
  { name: 'groupBy', label: L('Regrouper par (comptage)', 'Group by (count)'), kind: 'columns' },
  { name: 'componentAtDisplay', label: L('Composant choisi à l\'affichage', 'Component chosen when displayed'), kind: 'boolean' },
  { name: 'objectTypeAtDisplay', label: L('Type d\'objet choisi à l\'affichage', 'Object type chosen when displayed'), kind: 'boolean' },
]

function filteredListParameters(raw: Record<string, unknown>): QueryParameterDef[] {
  return [...(raw.componentAtDisplay === true ? [COMPONENT_PARAM] : []), ...(raw.objectTypeAtDisplay === true ? [OBJECT_TYPE_PARAM] : [])]
}

function generateFilteredList(raw: Record<string, unknown>): string {
  const p = pick(raw, FILTERED_LIST_PARAMS)
  const componentAtDisplay = takeFlag(p, 'componentAtDisplay')
  const objectTypeAtDisplay = takeFlag(p, 'objectTypeAtDisplay')
  if (!p.combinator) p.combinator = 'AND'
  if (!p.conditions) p.conditions = []
  return `${header('Modèle', 'filtered-list', 1)}
const P = ${stableJson(p, 2)}

${SCALAR}

${DAY_OF}

${ENTRY_ROWS}

function num(v) {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v)
  return null
}

function eq(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined || b === ''
  const na = num(a)
  const nb = num(b)
  if (na !== null && nb !== null) return na === nb
  return String(a) === String(b)
}

function lt(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false
  const na = num(a)
  const nb = num(b)
  if (na !== null && nb !== null) return na < nb
  return String(a) < String(b)
}

const OPS = {
  '=': eq,
  '!=': (a, b) => !eq(a, b),
  '>': (a, b) => lt(b, a),
  '<': lt,
  contains: (a, b) => String(a === null || a === undefined ? '' : a).toLowerCase().includes(String(b === null || b === undefined ? '' : b).toLowerCase()),
  in: (a, b) => (Array.isArray(b) ? b : String(b).split(',').map((s) => s.trim()).filter((s) => s)).some((x) => eq(a, x)),
}

function objectRow(o, extra) {
  const row = {}
  for (const k of Object.keys(o.fields || {})) row[k] = scalar(o.fields[k])
  Object.assign(row, {
    id: o.id, objectTypeRef: o.objectTypeRef, title: o.title, status: o.status, version: o.version,
    needsRevalidation: o.needsRevalidation, createdAt: o.createdAt, createdBy: o.createdBy,
    updatedAt: o.updatedAt, updatedBy: o.updatedBy, component: o.component,
  }, extra, { _ids: [o.id] })
  return row
}

export default function (data, polenta) {
${componentAtDisplay || objectTypeAtDisplay ? `  // Choisi à l'affichage : remplace la valeur fixée ; « Tous » → valeur fixée, sinon aucun filtre.
` : ''}  const component = ${componentAtDisplay ? 'polenta.params.component || P.component' : 'P.component'}
  const objectTypeRef = ${objectTypeAtDisplay ? 'polenta.params.objectType || P.objectTypeRef' : 'P.objectTypeRef'}
  // Un type d'objet précis, ou tous les objets d'une catégorie (P.category, sans type).
  const types = data.schema.objectTypes.filter((t) => t.ref === objectTypeRef && (!component || t.component === component))
  const category = objectTypeRef ? (types.length ? types[0].category : 'requirement') : (P.category || 'requirement')
  const ofType = (o) => (!objectTypeRef || o.objectTypeRef === objectTypeRef) && (!component || o.component === component)
  let rows
  if (category === 'campaign') {
    rows = entryRows(data, data.campaigns.filter(ofType), polenta)
  } else if (category === 'test') {
    const latest = new Map()
    for (const r of data.runs) {
      const k = latest.get(r.testCaseId)
      if (!k || r.executedAt > k.executedAt) latest.set(r.testCaseId, r)
    }
    rows = data.tests
      .filter(ofType)
      .map((t) => {
        const run = latest.get(t.id)
        return objectRow(t, { latestRunResult: run ? run.result : null, latestRunDate: run ? run.executedAt : null })
      })
  } else {
    rows = data.requirements
      .filter(ofType)
      .map((r) => objectRow(r, { coverageStatus: r.coverageStatus }))
  }
  if (P.conditions.length) {
    const test = (row) => {
      const results = P.conditions.map((c) => OPS[c.operator](row[c.field], c.value))
      return P.combinator === 'OR' ? results.some(Boolean) : results.every(Boolean)
    }
    rows = rows.filter(test)
  }
  if (!P.groupBy) return rows
  const groups = new Map()
  for (const row of rows) {
    const key = JSON.stringify(P.groupBy.map((f) => (row[f] === undefined ? null : row[f])))
    let g = groups.get(key)
    if (!g) {
      g = { count: 0, _ids: [] }
      for (const f of P.groupBy) g[f] = row[f] === undefined ? null : row[f]
      groups.set(key, g)
    }
    g.count++
    g._ids = g._ids.concat(row._ids)
  }
  return Array.from(groups.values()).map((g) => {
    const out = {}
    for (const f of P.groupBy) out[f] = g[f]
    out.count = g.count
    out._ids = g._ids
    return out
  })
}
`
}

// ─── « Entrées de campagne » ────────────────────────────────────────────────

const CAMPAIGN_STATUS_VALUES = [
  { value: 'planned', label: L('Planifiée', 'Planned') },
  { value: 'in_progress', label: L('En cours', 'In progress') },
  { value: 'completed', label: L('Terminée', 'Completed') },
  { value: 'abandoned', label: L('Abandonnée', 'Abandoned') },
]

const CAMPAIGN_FILTER_PARAMS: TemplateParamDef[] = [
  { name: 'campaignStatuses', label: L('Statuts de campagne', 'Campaign statuses'), kind: 'multiEnum', values: CAMPAIGN_STATUS_VALUES },
  { name: 'campaignIds', label: L('Campagnes', 'Campaigns'), kind: 'campaigns' },
]

const ENTRY_STATUS_VALUES = ENTRY_ORDER.map((s) => ({ value: s, label: L(s, s) }))

const CAMPAIGN_ENTRIES_PARAMS: TemplateParamDef[] = [
  ...CAMPAIGN_FILTER_PARAMS,
  { name: 'entryStatuses', label: L('Statuts d\'entrée', 'Entry statuses'), kind: 'multiEnum', values: ENTRY_STATUS_VALUES },
  { name: 'withStep', label: L('Étape d\'avancement (bibliothèque projet)', 'Progress step (project library)'), kind: 'boolean' },
  CAMPAIGN_AT_DISPLAY,
]

function campaignEntriesParameters(raw: Record<string, unknown>): QueryParameterDef[] {
  return raw.campaignAtDisplay === true ? [CAMPAIGN_PARAM] : []
}

function generateCampaignEntries(raw: Record<string, unknown>): string {
  const p = pick(raw, CAMPAIGN_ENTRIES_PARAMS)
  const withStep = takeFlag(p, 'withStep')
  const campaignAtDisplay = takeFlag(p, 'campaignAtDisplay')
  // Étape d'avancement (`entryStep`, ex-GH71) : colonnes step / stepLabel / stepRank, calculées par la
  // bibliothèque projet (dashboards/lib/campaign.js).
  const stepImport = withStep
    ? `// Nécessite la bibliothèque projet (dashboards/lib/campaign.js).
import { entryStep, stepContext, stepLabel, stepRank } from 'lib/campaign.js'

`
    : ''
  const stepRows = withStep
    ? `  const ctx = stepContext(data)
  const byId = new Map()
  for (const c of campaigns) for (const e of c.entries) byId.set(c.id + '/' + e.entryId, e)
  for (const r of rows) {
    const step = entryStep(data, byId.get(r._ids[0]), ctx)
    r.step = step
    r.stepLabel = stepLabel(data, step, ctx, polenta.locale === 'en' ? 'en' : 'fr')
    r.stepRank = stepRank(step, ctx)
  }
  // Couleur de l'étape (jeton du thème) : préparation en nuances, selon son rang parmi les étapes
  // de préparation présentes ; prêt et résultats, couleurs fixes.
  const prep = Array.from(new Set(rows.filter((r) => r.step.startsWith('prep:')).map((r) => r.step)))
    .sort((a, b) => stepRank(a, ctx) - stepRank(b, ctx))
  const STEP_COLORS = { ready: 'ready', INCOMPLETE: 'incomplete', BLOCKED: 'blocked', FAIL: 'fail', PASS: 'pass' }
  for (const r of rows) {
    const shade = prep.indexOf(r.step)
    r.stepColor = 'var(--chart-progress-' + (shade >= 0 ? 'prep-' + Math.min(shade + 1, 4) : (STEP_COLORS[r.step] || 'ready')) + ')'
  }
`
    : ''
  return `${header('Modèle', 'campaign-entries', 1)}${stepImport}
const P = ${stableJson(p, 2)}

${SCALAR}

${DAY_OF}

${ENTRY_ROWS}

export default function (data, polenta) {
${campaignFilter(campaignAtDisplay)}
  const rows = entryRows(data, campaigns, polenta)
${stepRows}  return P.entryStatuses ? rows.filter((r) => P.entryStatuses.includes(r.status)) : rows
}
`
}

// ─── « Avancement dans le temps » ───────────────────────────────────────────

const CAMPAIGN_TIMELINE_PARAMS: TemplateParamDef[] = [
  ...CAMPAIGN_FILTER_PARAMS,
  {
    name: 'step', label: L('Pas', 'Step'), kind: 'enum',
    values: [{ value: '1', label: L('Jour', 'Day') }, { value: '7', label: L('Semaine', 'Week') }],
  },
  { name: 'withStep', label: L('Étape d\'avancement (préparation du test avant exécution)', 'Progress step (test preparation before execution)'), kind: 'boolean' },
  CAMPAIGN_AT_DISPLAY,
  { name: 'periodAtDisplay', label: L('Période choisie à l\'affichage', 'Period chosen when displayed'), kind: 'boolean' },
]

function campaignTimelineParameters(raw: Record<string, unknown>): QueryParameterDef[] {
  return [...(raw.campaignAtDisplay === true ? [CAMPAIGN_PARAM] : []), ...(raw.periodAtDisplay === true ? [PERIOD_PARAM] : [])]
}

function generateCampaignTimeline(raw: Record<string, unknown>): string {
  const p = pick(raw, CAMPAIGN_TIMELINE_PARAMS)
  const step = Number(p.step ?? 1) === 7 ? 7 : 1
  delete p.step
  const campaignAtDisplay = takeFlag(p, 'campaignAtDisplay')
  const periodAtDisplay = takeFlag(p, 'periodAtDisplay')
  // GH112 — étapes d'avancement (préparation du test d'après son historique, puis résultats).
  const withStep = takeFlag(p, 'withStep')
  return `${header('Modèle', 'campaign-timeline', 1)}
// Nécessite la bibliothèque projet (dashboards/lib/campaign.js).
import { campaignsTimeline } from 'lib/campaign.js'

const P = ${stableJson(p, 2)}

export default function (data, polenta) {
${campaignFilter(campaignAtDisplay)}
  const campaignIds = campaigns.map((c) => c.id)
${periodAtDisplay ? `  // Période choisie à l'affichage ; borne absente → création de la plus ancienne campagne / aujourd'hui.
  const period = polenta.params.period
  const from = (period && period.from) || undefined
  const to = (period && period.to) || undefined
` : ''}  // Pas d'_ids sur chaque point (série longue) : ils sont calculés au clic (polenta.drill).
  return campaignsTimeline(data, { polenta, campaignIds, step: ${step}${periodAtDisplay ? ', from, to' : ''}${withStep ? ', withStep: true' : ''} })
}
`
}

// ─── « Dernier résultat de campagne » (colonne calculée, GH70) ───────────────

function generateCampaignLastResult(): string {
  return `${header('Modèle', 'campaign-last-result', 1)}// Colonne calculée de la Vue Système : une ligne par test exécuté en campagne.
// Règles (dans lib/campaign.js, modifiables par le projet) : entrée exécutée la plus récente,
// toutes campagnes, abandonnées comprises ; runs hors campagne ignorés.
import { lastEntryResults } from 'lib/campaign.js'
import { dayOf } from 'lib/time.js'

export default function (data, polenta) {
  const rows = []
  for (const [testId, r] of lastEntryResults(data)) {
    rows.push({
      id: testId,
      value: r.status,
      tooltip: r.campaignId + ' — ' + r.campaignTitle + ' · ' + dayOf(r.executedAt, polenta) + (r.executedBy ? ' · ' + r.executedBy : ''),
      _ids: [r.campaignId + '/' + r.entryId],
    })
  }
  return rows
}
`
}

function campaignLastResultColumn(): QueryColumnDef {
  return {
    label: L('Dernier résultat', 'Last result'),
    appliesTo: { categories: ['test'], objectTypes: [] },
    type: 'enum',
    values: ['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE'],
  }
}

// ─── « Résultat par campagne » (colonne calculée éclatée, GH126) ─────────────

function generateCampaignResults(): string {
  return `${header('Modèle', 'campaign-results', 1)}// Colonne calculée éclatée de la Vue Système : une sous-colonne par campagne, une ligne par
// (campagne, test). Règles (dans lib/campaign.js, modifiables par le projet) : toutes les campagnes,
// abandonnées comprises, par date de création ; test itérant : pire statut des instances.
import { entryResultsByCampaign } from 'lib/campaign.js'
import { dayOf } from 'lib/time.js'

export default function (data, polenta) {
  return entryResultsByCampaign(data).map((r) => ({
    id: r.testId,
    value: r.status,
    campaignId: r.campaignId,
    campaignTitle: r.campaignTitle,
    tooltip: r.campaignId + ' — ' + r.campaignTitle
      + (r.executedAt ? ' · ' + dayOf(r.executedAt, polenta) + (r.executedBy ? ' · ' + r.executedBy : '') : polenta.locale === 'en' ? ' · not executed' : ' · non exécuté')
      + (r.statuses.length > 1 ? ' · ' + r.statuses.join(', ') : ''),
    _ids: [r.campaignId + '/' + r.entryId],
  }))
}
`
}

function campaignResultsColumn(): QueryColumnDef {
  return {
    label: L('Résultat par campagne', 'Result by campaign'),
    appliesTo: { categories: ['test'], objectTypes: [] },
    type: 'enum',
    values: ['PASS', 'FAIL', 'BLOCKED', 'INCOMPLETE', 'pending'],
    splitColumn: 'campaignId',
    splitLabelColumn: 'campaignTitle',
  }
}

// ─── Transformations des widgets ────────────────────────────────────────────

const MEASURE_VALUES = [
  { value: 'count', label: L('Nombre de lignes', 'Row count') },
  { value: 'sum', label: L('Somme', 'Sum') },
  { value: 'min', label: L('Minimum', 'Minimum') },
  { value: 'max', label: L('Maximum', 'Maximum') },
  { value: 'distinct', label: L('Valeurs distinctes', 'Distinct values') },
  { value: 'worst', label: L('Pire statut', 'Worst status') },
]

/** Nom de la colonne de valeur produite par une mesure. */
export function measureColumn(op: MeasureOp, column?: string): string {
  return op === 'count' || !column ? 'count' : `${op}_${column}`
}

/** Fonctions communes des transformations : agrégation, pire statut, tri naturel. */
const AGGREGATE = `const SEVERITY = { FAIL: 4, BLOCKED: 3, INCOMPLETE: 2, pending: 1, PASS: 0 }
const ENTRY_ORDER = ${JSON.stringify(ENTRY_ORDER)}

function measure(op, values) {
  if (op === 'count') return values.length
  const present = values.filter((v) => v !== null && v !== undefined)
  if (op === 'worst') {
    let w = null
    for (const v of present) if (w === null || (SEVERITY[v] ?? -1) > (SEVERITY[w] ?? -1)) w = v
    return w
  }
  if (op === 'distinct') return Array.from(new Set(present.map(String))).join(', ')
  const nums = present.map(Number).filter((n) => !isNaN(n))
  if (op === 'sum') return nums.reduce((a, b) => a + b, 0)
  if (!nums.length) return null
  return op === 'min' ? Math.min.apply(null, nums) : Math.max.apply(null, nums)
}

/** Regroupe les lignes par \`keys\` ; une ligne par groupe (ordre de première apparition), union des _ids. */
function groupRows(rows, keys, op, column, valueName) {
  const groups = new Map()
  for (const r of rows) {
    const k = JSON.stringify(keys.map((f) => (r[f] === undefined ? null : r[f])))
    let g = groups.get(k)
    if (!g) {
      g = { row: {}, values: [], ids: [] }
      for (const f of keys) g.row[f] = r[f] === undefined ? null : r[f]
      groups.set(k, g)
    }
    g.values.push(op === 'count' ? 1 : r[column])
    if (r._ids) for (const id of r._ids) g.ids.push(id)
  }
  return Array.from(groups.values()).map((g) => {
    const out = Object.assign({}, g.row)
    out[valueName] = measure(op, g.values)
    out._ids = Array.from(new Set(g.ids))
    return out
  })
}

/** Tri : statuts d'entrée dans leur ordre, sinon ordre naturel (« TEST-2 » avant « TEST-10 »). */
function compare(a, b) {
  const ia = ENTRY_ORDER.indexOf(a)
  const ib = ENTRY_ORDER.indexOf(b)
  if (ia >= 0 && ib >= 0) return ia - ib
  if (a === null) return 1
  if (b === null) return -1
  const pa = String(a).split(/(\\d+)/)
  const pb = String(b).split(/(\\d+)/)
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue
    const na = Number(pa[i])
    const nb = Number(pb[i])
    if (i % 2 === 1 && !isNaN(na) && !isNaN(nb)) return na - nb
    return pa[i] < pb[i] ? -1 : 1
  }
  return pa.length - pb.length
}`

function transformCode(id: string, p: Record<string, unknown>, body: string): string {
  return `${header('Transformation', id, 1)}
const P = ${stableJson(p, 2)}

${AGGREGATE}

export default function (rows, polenta) {
${body}
}
`
}

function opOf(p: Record<string, unknown>): MeasureOp {
  const op = String(p.measure ?? 'count') as MeasureOp
  return (MEASURE_VALUES.some((v) => v.value === op) ? op : 'count')
}

const DATA = { name: 'rows' }

/** Échelle de couleurs des statuts d'entrée (jetons du thème). */
const ENTRY_SCALE = { domain: ENTRY_ORDER, range: ENTRY_COLORS }

function colorEncoding(field: string, title: string, entryColors: boolean): Record<string, unknown> {
  return { field, type: 'nominal', sort: null, title, ...(entryColors ? { scale: ENTRY_SCALE } : {}) }
}

const CATEGORY_PARAMS = (categoryLabel: { fr: string; en: string }): TemplateParamDef[] => [
  { name: 'category', label: categoryLabel, kind: 'column', required: true },
  { name: 'series', label: L('Série (couleur)', 'Series (colour)'), kind: 'column' },
  { name: 'measure', label: L('Mesure', 'Measure'), kind: 'enum', values: MEASURE_VALUES },
  { name: 'measureColumn', label: L('Colonne mesurée', 'Measured column'), kind: 'column', dependsOn: 'measure' },
  { name: 'entryColors', label: L('Couleurs des statuts d\'exécution', 'Execution status colours'), kind: 'boolean' },
]

function groupedTransform(id: string, p: Record<string, unknown>, withSeries: boolean): { code: string; valueName: string } {
  const op = opOf(p)
  const valueName = measureColumn(op, p.measureColumn as string | undefined)
  const order = withSeries && p.series && p.seriesOrder ? p.seriesOrder : undefined
  const color = withSeries && p.series && p.seriesColor ? p.seriesColor : undefined
  const keys = [p.category, ...(withSeries && p.series ? [p.series] : []), ...(order ? [order] : []), ...(color ? [color] : [])]
  // Ordre des séries par colonne : porté par la spec (tri de la couleur), les catégories gardent
  // leur ordre d'apparition.
  const sortSeries = withSeries && p.series && !order
    ? `  out.sort((a, b) => compare(a[P.series], b[P.series]))\n`
    : ''
  return {
    valueName,
    code: transformCode(id, p, `  const out = groupRows(rows, ${JSON.stringify(keys)}, ${JSON.stringify(op)}, P.measureColumn, ${JSON.stringify(valueName)})
${sortSeries}  return out`),
  }
}

const BAR_PARAMS: TemplateParamDef[] = [
  ...CATEGORY_PARAMS(L('Catégorie (axe)', 'Category (axis)')),
  { name: 'stacked', label: L('Empiler les séries', 'Stack series'), kind: 'boolean', dependsOn: 'series' },
  { name: 'seriesOrder', label: L('Ordre des séries (colonne numérique)', 'Series order (numeric column)'), kind: 'column', dependsOn: 'series' },
  { name: 'seriesColor', label: L('Couleur des séries (colonne)', 'Series colour (column)'), kind: 'column', dependsOn: 'series' },
]

function generateBar(raw: Record<string, unknown>): WidgetCode {
  const p = pick(raw, BAR_PARAMS)
  const { code, valueName } = groupedTransform('bar', p, true)
  const encoding: Record<string, unknown> = {
    x: { field: p.category, type: 'nominal', sort: null, title: p.category, axis: { labelAngle: -30 } },
    y: { field: valueName, type: 'quantitative', title: valueName, ...(p.series && !p.stacked ? { stack: null } : {}) },
  }
  if (p.series) {
    encoding.color = colorEncoding(p.series as string, p.series as string, !!p.entryColors)
    const seriesSort = p.seriesOrder ? { field: p.seriesOrder, op: 'min' } : null
    if (seriesSort) {
      (encoding.color as Record<string, unknown>).sort = seriesSort
      encoding.order = { field: p.seriesOrder, type: 'quantitative' }
    }
    if (!p.stacked) encoding.xOffset = { field: p.series, sort: seriesSort }
  }
  // Couleurs portées par les lignes : échelle construite par l'hôte (`usermeta.polenta.seriesColors`).
  const usermeta = p.series && p.seriesColor
    ? { usermeta: { polenta: { seriesColors: { field: p.series, color: p.seriesColor, ...(p.seriesOrder ? { order: p.seriesOrder } : {}) } } } }
    : {}
  return { transform: code, spec: stableJson({ data: DATA, mark: { type: 'bar', tooltip: true }, encoding, ...usermeta }, 2) }
}

const PIE_PARAMS: TemplateParamDef[] = CATEGORY_PARAMS(L('Catégorie (parts)', 'Category (slices)')).filter((d) => d.name !== 'series')

function generatePie(raw: Record<string, unknown>): WidgetCode {
  const p = pick(raw, PIE_PARAMS)
  const { code, valueName } = groupedTransform('pie', p, false)
  return {
    transform: code,
    spec: stableJson({
      data: DATA,
      mark: { type: 'arc', tooltip: true },
      encoding: {
        theta: { field: valueName, type: 'quantitative', stack: true },
        color: colorEncoding(p.category as string, p.category as string, !!p.entryColors),
      },
    }, 2),
  }
}

const LINE_PARAMS: TemplateParamDef[] = [
  ...CATEGORY_PARAMS(L('Abscisse', 'X axis')),
  { name: 'temporal', label: L('Abscisse temporelle (dates)', 'Time axis (dates)'), kind: 'boolean' },
]

function generateLine(raw: Record<string, unknown>): WidgetCode {
  const p = pick(raw, LINE_PARAMS)
  const { code, valueName } = groupedTransform('line', p, true)
  const encoding: Record<string, unknown> = {
    x: { field: p.category, type: p.temporal ? 'temporal' : 'ordinal', sort: p.temporal ? 'ascending' : null, title: p.category },
    y: { field: valueName, type: 'quantitative', title: valueName },
  }
  if (p.series) encoding.color = colorEncoding(p.series as string, p.series as string, !!p.entryColors)
  return { transform: code, spec: stableJson({ data: DATA, mark: { type: 'line', point: true, tooltip: true }, encoding }, 2) }
}

const KPI_PARAMS: TemplateParamDef[] = [
  {
    name: 'measure', label: L('Mesure', 'Measure'), kind: 'enum',
    values: [...MEASURE_VALUES.filter((v) => ['count', 'sum', 'min', 'max'].includes(v.value)), { value: 'ratio', label: L('Pourcentage de lignes', 'Percentage of rows') }],
  },
  { name: 'measureColumn', label: L('Colonne', 'Column'), kind: 'column', dependsOn: 'measure' },
  { name: 'ratioValues', label: L('Valeurs comptées (pourcentage)', 'Counted values (percentage)'), kind: 'text', dependsOn: 'measureColumn' },
]

function generateKpi(raw: Record<string, unknown>): WidgetCode {
  const p = pick(raw, KPI_PARAMS)
  const ratio = p.measure === 'ratio'
  const op: MeasureOp = ratio ? 'count' : opOf(p)
  const body = ratio
    ? `  if (!rows.length) return []
  const wanted = String(P.ratioValues === undefined ? '' : P.ratioValues).split(',').map((s) => s.trim())
  const hits = rows.filter((r) => wanted.includes(String(r[P.measureColumn])))
  const ids = []
  for (const r of hits) if (r._ids) for (const id of r._ids) ids.push(id)
  return [{ value: Math.round(1000 * hits.length / rows.length) / 10, _ids: ids }]`
    : `  if (!rows.length) return []
  const ids = []
  for (const r of rows) if (r._ids) for (const id of r._ids) ids.push(id)
  return [{ value: measure(${JSON.stringify(op)}, rows.map((r) => (${JSON.stringify(op)} === 'count' ? 1 : r[P.measureColumn]))), _ids: ids }]`
  return {
    transform: transformCode('kpi', p, body),
    spec: stableJson({
      data: DATA,
      mark: { type: 'text' },
      encoding: { text: { field: 'value' } },
      usermeta: { polenta: { view: 'kpi', field: 'value', ...(ratio ? { suffix: '%' } : {}) } },
    }, 2),
  }
}

const TABLE_PARAMS: TemplateParamDef[] = [
  { name: 'columns', label: L('Colonnes affichées', 'Displayed columns'), kind: 'columns' },
]

function generateTable(raw: Record<string, unknown>): WidgetCode {
  const p = pick(raw, TABLE_PARAMS)
  const body = p.columns
    ? `  return rows.map((r) => {
    const out = {}
    for (const c of P.columns) out[c] = r[c] === undefined ? null : r[c]
    if (r._ids) out._ids = r._ids
    return out
  })`
    : '  return rows.slice()'
  return {
    transform: transformCode('table', p, body),
    spec: stableJson({
      data: DATA,
      mark: { type: 'text' },
      usermeta: { polenta: { view: 'table', ...(p.columns ? { columns: p.columns } : {}) } },
    }, 2),
  }
}

const MATRIX_PARAMS: TemplateParamDef[] = [
  { name: 'row', label: L('Lignes', 'Rows'), kind: 'column', required: true },
  { name: 'label', label: L('Libellé de ligne', 'Row label'), kind: 'column' },
  { name: 'column', label: L('Colonnes', 'Columns'), kind: 'column', required: true },
  { name: 'value', label: L('Valeur des cellules', 'Cell value'), kind: 'column', required: true },
  { name: 'entryColors', label: L('Couleurs des statuts d\'exécution', 'Execution status colours'), kind: 'boolean' },
]

function generateMatrix(raw: Record<string, unknown>): WidgetCode {
  const p = pick(raw, MATRIX_PARAMS)
  const body = `  // Cellule = lignes portant ce couple : pire statut si ce sont des statuts d'exécution,
  // somme si ce sont des nombres, sinon valeurs distinctes.
  const labels = new Map()
  for (const r of rows) if (P.label) labels.set(r[P.row], r[P.label])
  const cells = new Map()
  for (const r of rows) {
    const k = JSON.stringify([r[P.row], r[P.column]])
    let c = cells.get(k)
    if (!c) {
      c = { row: r[P.row] === undefined ? null : r[P.row], column: r[P.column] === undefined ? null : r[P.column], values: [], ids: [] }
      cells.set(k, c)
    }
    c.values.push(r[P.value])
    if (r._ids) for (const id of r._ids) c.ids.push(id)
  }
  const out = []
  for (const c of cells.values()) {
    const present = c.values.filter((v) => v !== null && v !== undefined)
    const op = present.length && present.every((v) => v in SEVERITY) ? 'worst'
      : present.length && present.every((v) => !isNaN(Number(v))) ? 'sum' : 'distinct'
    const value = measure(op, c.values)
    const label = labels.get(c.row)
    out.push({
      row: c.row,
      rowTitle: label ? String(c.row) + ' — ' + String(label) : (c.row === null ? '—' : String(c.row)),
      column: c.column === null ? '—' : String(c.column),
      value: value,
      text: c.values.length > 1 && op === 'worst' ? String(value) + ' ×' + c.values.length : (value === null ? '' : String(value)),
      _ids: Array.from(new Set(c.ids)),
    })
  }
  out.sort((a, b) => compare(a.row, b.row))
  return out`
  const color = p.entryColors
    ? { field: 'value', type: 'nominal', scale: ENTRY_SCALE, legend: null }
    : { value: 'var(--surface)' }
  return {
    transform: transformCode('matrix', p, body),
    spec: stableJson({
      data: DATA,
      encoding: {
        x: { field: 'column', type: 'nominal', sort: null, title: p.column, axis: { orient: 'top', labelAngle: -30 } },
        y: { field: 'rowTitle', type: 'nominal', sort: null, title: p.row },
      },
      layer: [
        { mark: { type: 'rect', tooltip: true, stroke: 'var(--edge)' }, encoding: { color } },
        { mark: { type: 'text', fontSize: 11 }, encoding: { text: { field: 'text' } } },
      ],
    }, 2),
  }
}

const STACKED_AREA_PARAMS: TemplateParamDef[] = [
  { name: 'x', label: L('Date (abscisse)', 'Date (x axis)'), kind: 'column', required: true },
  { name: 'series', label: L('Série (couches)', 'Series (layers)'), kind: 'column', required: true },
  { name: 'value', label: L('Valeur', 'Value'), kind: 'column', required: true },
  { name: 'entryColors', label: L('Couleurs des statuts d\'exécution', 'Execution status colours'), kind: 'boolean' },
  { name: 'seriesOrder', label: L('Ordre des séries (colonne numérique)', 'Series order (numeric column)'), kind: 'column', dependsOn: 'series' },
  { name: 'seriesColor', label: L('Couleur des séries (colonne)', 'Series colour (column)'), kind: 'column', dependsOn: 'series' },
]

function generateStackedArea(raw: Record<string, unknown>): WidgetCode {
  const p = pick(raw, STACKED_AREA_PARAMS)
  const bySeries = p.seriesOrder
    ? 'Number(a[P.seriesOrder]) - Number(b[P.seriesOrder]) || compare(a[P.series], b[P.series])'
    : 'compare(a[P.series], b[P.series])'
  const body = `  // Lignes déjà agrégées par le script (une par date × série) : ordre des séries seulement.
  // Les _ids éventuels sont conservés ; sinon l'application relance le script au clic (polenta.drill).
  return rows.slice().sort((a, b) => (a[P.x] < b[P.x] ? -1 : a[P.x] > b[P.x] ? 1 : ${bySeries}))`
  const x = { field: p.x, type: 'temporal', title: p.x }
  const y = { field: p.value, type: 'quantitative', stack: 'zero', title: p.value }
  // Légende : symboles opaques (la couche de clic, quasi transparente, la partage).
  const color: Record<string, unknown> = { ...colorEncoding(p.series as string, p.series as string, !!p.entryColors), legend: { symbolOpacity: 1 } }
  // GH112 — ordre des couches (empilement des deux couches, légende) par colonne, comme « Barres ».
  if (p.seriesOrder) color.sort = { field: p.seriesOrder, op: 'min' }
  const order = p.seriesOrder ? { order: { field: p.seriesOrder, type: 'quantitative' } } : {}
  // Couleurs portées par les lignes : échelle construite par l'hôte (`usermeta.polenta.seriesColors`).
  const usermeta = p.seriesColor
    ? { usermeta: { polenta: { seriesColors: { field: p.series, color: p.seriesColor, ...(p.seriesOrder ? { order: p.seriesOrder } : {}) } } } }
    : {}
  return {
    transform: transformCode('stacked-area', p, body),
    spec: stableJson({
      data: DATA,
      ...usermeta,
      encoding: { x, y, color, ...order },
      layer: [
        { mark: { type: 'area', interpolate: 'monotone' } },
        // Une aire est une seule marque : une couche de barres quasi transparentes rend chaque point
        // cliquable (drill-down), avec les colonnes de la ligne.
        { mark: { type: 'bar', opacity: 0.01, tooltip: true } },
      ],
    }, 2),
  }
}

// ─── Catalogue ──────────────────────────────────────────────────────────────

export const QUERY_TEMPLATES: QueryTemplate[] = [
  { id: 'filtered-list', version: 1, label: L('Liste filtrée', 'Filtered list'), params: FILTERED_LIST_PARAMS, generate: generateFilteredList, parameters: filteredListParameters },
  { id: 'campaign-entries', version: 1, label: L('Entrées de campagne', 'Campaign entries'), params: CAMPAIGN_ENTRIES_PARAMS, generate: generateCampaignEntries, parameters: campaignEntriesParameters },
  { id: 'campaign-timeline', version: 1, label: L('Avancement dans le temps', 'Progress over time'), params: CAMPAIGN_TIMELINE_PARAMS, generate: generateCampaignTimeline, parameters: campaignTimelineParameters },
  {
    id: 'campaign-last-result', version: 1, label: L('Dernier résultat de campagne (colonne)', 'Last campaign result (column)'), params: [],
    generate: generateCampaignLastResult, parameters: () => [], column: campaignLastResultColumn,
  },
  {
    id: 'campaign-results', version: 1, label: L('Résultat par campagne (colonnes)', 'Result by campaign (columns)'), params: [],
    generate: generateCampaignResults, parameters: () => [], column: campaignResultsColumn,
  },
]

export const WIDGET_TEMPLATES: WidgetTemplate[] = [
  { id: 'bar', version: 1, label: L('Barres', 'Bars'), params: BAR_PARAMS, generate: generateBar },
  { id: 'pie', version: 1, label: L('Camembert', 'Pie'), params: PIE_PARAMS, generate: generatePie },
  { id: 'line', version: 1, label: L('Courbe', 'Line'), params: LINE_PARAMS, generate: generateLine },
  { id: 'kpi', version: 1, label: L('Indicateur', 'KPI'), params: KPI_PARAMS, generate: generateKpi },
  { id: 'table', version: 1, label: L('Table', 'Table'), params: TABLE_PARAMS, generate: generateTable },
  { id: 'matrix', version: 1, label: L('Matrice', 'Matrix'), params: MATRIX_PARAMS, generate: generateMatrix },
  { id: 'stacked-area', version: 1, label: L('Aire empilée (dans le temps)', 'Stacked area (over time)'), params: STACKED_AREA_PARAMS, generate: generateStackedArea },
]

export function findQueryTemplate(id: string): QueryTemplate | undefined {
  return QUERY_TEMPLATES.find((t) => t.id === id)
}

export function findWidgetTemplate(id: string): WidgetTemplate | undefined {
  return WIDGET_TEMPLATES.find((t) => t.id === id)
}

/** Définitions sérialisables (sans les fonctions), pour le renderer et le MCP. */
export function describeTemplates(): {
  queries: Omit<QueryTemplate, 'generate' | 'parameters' | 'column'>[]
  widgets: Omit<WidgetTemplate, 'generate'>[]
} {
  return {
    queries: QUERY_TEMPLATES.map(({ generate: _g, parameters: _p, column: _c, ...t }) => t),
    widgets: WIDGET_TEMPLATES.map(({ generate: _g, ...t }) => t),
  }
}

/**
 * Texte normalisé soumis à l'empreinte (SHA-256, calculée par l'appelant) : fins de ligne LF, sans
 * espaces de fin de ligne, une seule fin de ligne finale. Partagé par l'application et par le
 * générateur du projet de démo (`scripts/demo-lave-linge`).
 */
export function hashableText(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n*$/, '\n')
}

/** Script, déclaration de paramètres et colonne (GH70) générés par un modèle de requête, et sa
 *  référence ; `hash` = empreinte de `hashableText(queryCodeForHash(…))`. */
export function queryCode(input: { id: string; params: Record<string, unknown> }, hash: (text: string) => string): { script: string; parameters: QueryParameterDef[]; column: QueryColumnDef | null; template: TemplateRef } {
  const tpl = findQueryTemplate(input.id)
  if (!tpl) throw new Error(`Modèle de requête inconnu : ${input.id}`)
  const script = tpl.generate(input.params)
  const parameters = tpl.parameters(input.params)
  const column = tpl.column?.(input.params) ?? null
  return { script, parameters, column, template: { id: tpl.id, version: tpl.version, params: input.params, hash: hash(hashableText(queryCodeForHash(script, parameters))) } }
}

/** Texte soumis à l'empreinte d'une requête : script, plus la déclaration de paramètres s'il y en a
 *  (GH93 — modifier la déclaration détache aussi la requête de son modèle). La colonne calculée
 *  (GH70) n'en fait pas partie : la déclarer ou la modifier ne détache pas la requête. */
export function queryCodeForHash(script: string, parameters: readonly QueryParameterDef[] | undefined): string {
  return parameters && parameters.length ? `${script}\n\u0000\n${stableJson(parameters, 2)}` : script
}

/** GH70 — empreinte telle que calculée pendant les sprints 1–2 (colonne comprise) : une requête
 *  enregistrée alors n'est pas vue comme personnalisée. */
export function legacyQueryCodeForHashWithColumn(script: string, parameters: readonly QueryParameterDef[] | undefined, column: QueryColumnDef): string {
  return `${queryCodeForHash(script, parameters)}\n\u0000column\n${stableJson(column, 2)}`
}

/** Code généré par un modèle de widget et sa référence. */
export function widgetCode(input: { id: string; params: Record<string, unknown> }, hash: (text: string) => string): { code: WidgetCode; template: TemplateRef } {
  const tpl = findWidgetTemplate(input.id)
  if (!tpl) throw new Error(`Modèle de widget inconnu : ${input.id}`)
  const code = tpl.generate(input.params)
  return { code, template: { id: tpl.id, version: tpl.version, params: input.params, hash: hash(hashableText(widgetCodeForHash(code))) } }
}

/** Texte soumis à l'empreinte d'un widget : transformation + spec. */
export function widgetCodeForHash(code: WidgetCode): string {
  return `${code.transform ?? ''}\n\u0000\n${code.spec}`
}
