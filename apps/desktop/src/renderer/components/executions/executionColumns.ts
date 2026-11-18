import type { ExecutionHistory, SchemaField } from '@polenta/types'

// GH197 — colonnes de la grille d'historique des exécutions (specs/GH197.md §2). Une colonne a une clé
// stable (préférence `executions`), un groupe (panneau 👁 Colonnes) et un libellé (clé i18n, ou libellé du champ
// pour un champ d'exécution `run:<nom>` / un champ de campagne `campaign:<nom>`).

export type ExecutionColumnGroup = 'execution' | 'campaign' | 'entry' | 'test'

export interface ExecutionColumn {
  key: string
  group: ExecutionColumnGroup
  /** Clé i18n (`executionHistory.col.*`) ou libellé littéral (`literal`). */
  label: string
  literal?: boolean
  /** Champ d'exécution : définition pour le rendu typé. */
  field?: SchemaField
}

const FIXED: ExecutionColumn[] = [
  { key: 'verdict', group: 'execution', label: 'verdict' },
  { key: 'date', group: 'execution', label: 'date' },
  { key: 'tester', group: 'execution', label: 'tester' },
  { key: 'duration', group: 'execution', label: 'duration' },
  { key: 'origin', group: 'execution', label: 'origin' },
  { key: 'notes', group: 'execution', label: 'notes' },
  { key: 'equipment', group: 'execution', label: 'equipment' },
  { key: 'testedVersion', group: 'execution', label: 'testedVersion' },
  { key: 'testedStructure', group: 'execution', label: 'testedStructure' },
  { key: 'testedCommit', group: 'execution', label: 'testedCommit' },
  { key: 'testedDeviations', group: 'execution', label: 'testedDeviations' },
  { key: 'campaign', group: 'campaign', label: 'campaign' },
  { key: 'campaignStatus', group: 'campaign', label: 'campaignStatus' },
  { key: 'entry', group: 'entry', label: 'entry' },
  { key: 'entryRequirement', group: 'entry', label: 'entryRequirement' },
  { key: 'params', group: 'entry', label: 'params' },
  { key: 'testVersion', group: 'entry', label: 'testVersion' },
  { key: 'carriedFrom', group: 'entry', label: 'carriedFrom' },
  { key: 'test', group: 'test', label: 'test' },
]

/** Union des champs d'exécution des types présents (un nom = un champ, GH196 Q6). */
export function unionRunFields(defs: ExecutionHistory['runFieldDefs'], list: 'runFields' | 'stepFields'): SchemaField[] {
  const out: SchemaField[] = []
  for (const d of Object.values(defs)) for (const f of d[list]) if (!out.some(o => o.name === f.name)) out.push(f)
  return out
}

/** Colonnes disponibles pour un historique : fixes, champs d'exécution, champs de campagne présents. */
export function availableColumns(history: ExecutionHistory, withTestColumn: boolean): ExecutionColumn[] {
  const runFields = unionRunFields(history.runFieldDefs, 'runFields')
  const campaignKeys = [...new Set(history.rows.flatMap(r => Object.keys(r.campaign?.fields ?? {})))].sort()
  return [
    ...FIXED.filter(c => withTestColumn || c.group !== 'test'),
    ...runFields.map((f): ExecutionColumn => ({ key: `run:${f.name}`, group: 'execution', label: f.label ?? f.name, literal: true, field: f })),
    ...campaignKeys.map((k): ExecutionColumn => ({ key: `campaign:${k}`, group: 'campaign', label: k, literal: true })),
  ]
}

const defaultVisibleRunFields = (history: ExecutionHistory) =>
  unionRunFields(history.runFieldDefs, 'runFields').filter(f => f.defaultVisible).map(f => `run:${f.name}`)

/** Défaut (Q2) : verdict, date, testeur, campagne, entrée (+ test pour une exigence) et champs `defaultVisible`. */
export function defaultExecutionColumns(history: ExecutionHistory, withTestColumn: boolean): string[] {
  return [
    ...(withTestColumn ? ['test'] : []),
    'verdict', 'date', 'tester', 'testedVersion', 'campaign', 'entry',
    ...defaultVisibleRunFields(history),
  ]
}

// GH400 — vue Exécutions (specs/GH400-design.md §6, §8).

/** Pseudo-colonne du Document : tableau des étapes de la fiche. */
export const STEPS_KEY = 'steps'
/** En-tête d'une fiche du Document : jamais proposé dans l'onglet Document. */
export const DOC_HEADER_KEYS: readonly string[] = ['test', 'campaign', 'entry', 'verdict', 'date', 'tester']

/** Tableau de la vue (préférence `runExcel`). */
export function defaultRunExcelColumns(history: ExecutionHistory): string[] {
  return ['test', 'entryRequirement', 'campaign', 'entry', 'verdict', 'date', 'tester', 'testedVersion', ...defaultVisibleRunFields(history)]
}

/** Document de la vue (préférence `runWord`). */
export function defaultRunWordColumns(history: ExecutionHistory): string[] {
  return ['duration', 'testedVersion', 'origin', ...defaultVisibleRunFields(history), STEPS_KEY]
}
