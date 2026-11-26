import type { TFunction } from 'i18next'
import type {
  TableExportPayload, TablesExportPayload, VersionAnalysis, VersionPage, VersionRequirementsPage, VersionTestsToRun,
} from '@polenta/types'
import { fieldValueToText } from '@polenta/types'
import { htmlToCellText } from '../grid/cellText'
import { sheetNameOf } from '../grid/exportTable'
import type { GridColumn } from '../grid/gridTypes'
import { VERSION_ANALYSIS_DEFAULTS, buildVersionAnalysisColumns } from './versionAnalysisColumns'
import { INERT_CHANGE_GESTURES, VERSION_CHANGE_DEFAULTS, VERSION_CHANGE_GESTURE_COLUMNS, buildVersionChangeColumns } from './versionChangeColumns'
import { buildVersionRequirementColumns, versionRequirementDefaults } from './versionRequirementColumns'
import { VERSION_TEST_DEFAULTS, buildVersionTestColumns } from './versionTestColumns'

// GH439 §5 — export global de la page d'une version : une table par section cochée. Fonction pure (ni DOM, ni
// réseau) partagée par l'export Excel et par la route imprimable `/print/version` : mêmes sections, mêmes
// colonnes, mêmes lignes, même texte que les grilles de la page (colonnes extraites, pas dupliquées).

/** Sections de la page, dans l'ordre de la page. */
export const VERSION_SECTIONS = ['info', 'components', 'changes', 'analysis', 'tests', 'requirements'] as const
export type VersionSectionId = typeof VERSION_SECTIONS[number]

/** Sections dont le tableau est une grille à préférences (colonnes visibles, largeurs). */
export type VersionGridSectionId = 'changes' | 'analysis' | 'tests' | 'requirements'
/** Clé de préférence (`grid::<id>`) de chaque grille de la page. */
export const VERSION_GRID_PREF_KEYS: Record<VersionGridSectionId, string> = {
  changes: 'grid::version-changes',
  analysis: 'grid::version-analysis',
  tests: 'grid::version-tests',
  requirements: 'grid::version-requirements',
}

export interface VersionGridPrefs {
  /** Colonnes visibles, dans l'ordre, telles qu'enregistrées ; absent : colonnes par défaut de la grille. */
  columns?: string[]
  /** Largeurs à l'écran (px). */
  widths?: Record<string, number>
}

export interface SectionTable {
  id: VersionSectionId
  title: string
  columns: { key: string; label: string; width?: number }[]
  rows: Record<string, string>[]
}

export interface VersionSectionTablesInput {
  selected: readonly VersionSectionId[]
  page: VersionPage
  impact?: { analysis: VersionAnalysis; tests: VersionTestsToRun | null }
  requirements?: VersionRequirementsPage
  /** Préférences de colonnes de chaque grille (celles de l'écran). */
  grids?: Partial<Record<VersionGridSectionId, VersionGridPrefs>>
  t: TFunction
  language: string
  exportedAt?: Date
}

/** Sections que la page propose à l'export : celles qu'elle affiche. */
export function availableVersionSections(page: Pick<VersionPage, 'state' | 'components' | 'version'>): VersionSectionId[] {
  const abandoned = page.state === 'abandoned'
  return VERSION_SECTIONS.filter(id => {
    if (id === 'components') return page.components.length > 0
    if (id === 'analysis' || id === 'tests') return !abandoned
    if (id === 'requirements') return !(abandoned && !page.version.freeze)
    return true
  })
}

/** Libellé de chaque section (en-tête de page, nom d'onglet). */
export function versionSectionLabel(t: TFunction, id: VersionSectionId): string {
  switch (id) {
    case 'info': return t('versions.info.title')
    case 'components': return t('versions.components')
    case 'changes': return t('versions.page.changes')
    case 'analysis': return t('versions.analysis.title')
    case 'tests': return t('versions.tests.title')
    case 'requirements': return t('versions.requirements.title')
  }
}

/**
 * Colonnes exportées d'une grille : celles que l'utilisateur voit, dans son ordre (préférences, à défaut les
 * colonnes par défaut), colonnes verrouillées en tête comme à l'écran ; colonnes de gestes exclues.
 */
function exportedColumns<R>(all: GridColumn<R>[], visible: string[] | undefined, defaults: string[]): GridColumn<R>[] {
  const byKey = new Map(all.map(c => [c.key, c]))
  const known = [...new Set(visible ?? defaults)].filter(k => byKey.has(k))
  const locked = all.filter(c => c.locked && !known.includes(c.key)).map(c => c.key)
  return [...locked, ...known].filter(k => !VERSION_CHANGE_GESTURE_COLUMNS.includes(k)).map(k => byKey.get(k)!)
}

function gridTable<R>(
  id: VersionSectionId, title: string, all: GridColumn<R>[], rows: readonly R[], prefs: VersionGridPrefs | undefined, defaults: string[],
): SectionTable {
  const columns = exportedColumns(all, prefs?.columns, defaults)
  return {
    id, title,
    columns: columns.map(c => ({ key: c.key, label: c.label, ...(prefs?.widths?.[c.key] ? { width: prefs.widths[c.key] } : {}) })),
    // Toutes les lignes : ni filtre de colonne, ni tri (l'export est un livrable).
    rows: rows.map(row => Object.fromEntries(columns.map(c => [c.key, (c.exportText ?? c.getText)(row)]))),
  }
}

function infoTable(input: VersionSectionTablesInput, title: string): SectionTable {
  const { page, t, language } = input
  const { version, typeDef, state } = page
  const status = typeDef.statuses?.find(s => s.name === version.status)?.label || version.status
  const rows: Array<[string, string]> = [
    [t('versions.label'), version.title],
    [t('versions.export.info.state'), t(`versions.state.${state}`)],
    [t('versions.status'), status],
    [t('versions.basedOn'), page.basedOn ? `${page.basedOn.title} (${page.basedOn.id})` : t('versions.none')],
    ...(version.freeze ? [
      [t('versions.release.tag'), version.freeze.tag] as [string, string],
      [t('versions.export.info.frozenAt'), new Date(version.freeze.at).toLocaleString(language)] as [string, string],
      [t('versions.export.info.commit'), version.freeze.sha.slice(0, 7)] as [string, string],
    ] : []),
    ...(typeDef.fields ?? []).map((f): [string, string] => [f.label || f.name, htmlToCellText(fieldValueToText(version.fields?.[f.name]))]),
    [t('versions.export.info.component'), page.component.label],
    [t('versions.export.info.exportedAt'), (input.exportedAt ?? new Date()).toLocaleString(language)],
  ]
  return {
    id: 'info', title,
    columns: [{ key: 'field', label: t('versions.export.info.field') }, { key: 'value', label: t('versions.export.info.value') }],
    rows: rows.map(([field, value]) => ({ field, value })),
  }
}

function componentsTable(input: VersionSectionTablesInput, title: string): SectionTable {
  const { page, t } = input
  return {
    id: 'components', title,
    columns: [
      { key: 'component', label: t('versions.columns.component') },
      { key: 'version', label: t('versions.columns.version') },
      { key: 'state', label: t('versions.status') },
    ],
    rows: page.components.map(c => ({
      component: c.label,
      version: !c.versionType ? t('versions.noType') : c.selected ? `${c.selected.title} (${c.selected.id})` : t('versions.none'),
      state: c.selected ? t(`versions.state.${c.selected.state}`) : '',
    })),
  }
}

/**
 * Tables des sections cochées, dans l'ordre de la page. Une section dont les données manquent est omise
 * (`analysis` / `tests` sans analyse, `requirements` sans lecture) ; `analysis` et `tests` ne sont jamais
 * produites pour une version abandonnée, même demandées.
 */
export function buildVersionSectionTables(input: VersionSectionTablesInput): SectionTable[] {
  const { page, t, grids } = input
  const wanted = new Set(input.selected)
  const available = new Set(availableVersionSections(page))
  const tables: SectionTable[] = []
  for (const id of VERSION_SECTIONS) {
    if (!wanted.has(id) || !available.has(id)) continue
    const title = versionSectionLabel(t, id)
    switch (id) {
      case 'info': tables.push(infoTable(input, title)); break
      case 'components': tables.push(componentsTable(input, title)); break
      case 'changes':
        tables.push(gridTable(id, title, buildVersionChangeColumns({ t, gestures: INERT_CHANGE_GESTURES, removable: false }), page.rows, grids?.changes, VERSION_CHANGE_DEFAULTS))
        break
      case 'analysis': {
        if (!input.impact) break
        const { analysis } = input.impact
        const titleOf = new Map<string, string>([
          ...analysis.roots.map(r => [r.elementId, r.title] as [string, string]),
          ...analysis.rows.map(r => [r.id, r.title ?? ''] as [string, string]),
        ])
        tables.push(gridTable(id, title, buildVersionAnalysisColumns({ t, titleOf }), analysis.rows, grids?.analysis, VERSION_ANALYSIS_DEFAULTS))
        break
      }
      case 'tests':
        if (input.impact) tables.push(gridTable(id, title, buildVersionTestColumns({ t }), input.impact.tests?.tests ?? [], grids?.tests, VERSION_TEST_DEFAULTS))
        break
      case 'requirements':
        if (input.requirements) {
          tables.push(gridTable(id, title, buildVersionRequirementColumns({ page: input.requirements, t }), input.requirements.rows, grids?.requirements,
            versionRequirementDefaults(input.requirements.requirementFields)))
        }
        break
    }
  }
  return tables
}

/** Une table sous forme de feuille Excel (largeurs enregistrées reprises). */
export function toTableExportPayload(table: SectionTable): TableExportPayload {
  return { sheetName: sheetNameOf(table.title), columns: table.columns, rows: table.rows }
}

/** Classeur de la page : une feuille par table (le générateur rend les noms uniques, `exportTablesXlsx`). */
export function toTablesExportPayload(tables: readonly SectionTable[]): TablesExportPayload {
  return { sheets: tables.map(toTableExportPayload) }
}
