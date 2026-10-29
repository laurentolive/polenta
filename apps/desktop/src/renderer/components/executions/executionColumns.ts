import type { ExecutionHistory, ExecutionHistoryRow, SchemaField } from '@polenta/types'

// GH197 — colonnes de la grille d'historique des exécutions (specs/GH197.md §2). Une colonne a une clé
// stable (préférence `executions`), un groupe (panneau ⚙️) et un libellé (clé i18n, ou libellé du champ
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
  { key: 'campaign', group: 'campaign', label: 'campaign' },
  { key: 'campaignStatus', group: 'campaign', label: 'campaignStatus' },
  { key: 'baseline', group: 'campaign', label: 'baseline' },
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

/** Défaut (Q2) : verdict, date, testeur, campagne, entrée (+ test pour une exigence) et champs `defaultVisible`. */
export function defaultExecutionColumns(history: ExecutionHistory, withTestColumn: boolean): string[] {
  return [
    ...(withTestColumn ? ['test'] : []),
    'verdict', 'date', 'tester', 'campaign', 'entry',
    ...unionRunFields(history.runFieldDefs, 'runFields').filter(f => f.defaultVisible).map(f => `run:${f.name}`),
  ]
}

const UNSORTABLE = new Set(['notes', 'equipment', 'params', 'carriedFrom'])

/** En-tête triable (texte libre ou valeurs composées : non). */
export function isSortable(key: string): boolean {
  return !UNSORTABLE.has(key)
}

/** Valeur triable d'une colonne (texte, ou date ISO ; nombres comparés numériquement par la grille). */
export function sortValue(row: ExecutionHistoryRow, key: string): string {
  switch (key) {
    case 'verdict': return row.run?.result ?? 'pending'
    case 'date': return row.run?.executedAt ?? ''
    case 'tester': return row.run?.executedBy ?? ''
    case 'duration': return String(row.run?.duration ?? '')
    case 'origin': return row.run?.origin ?? ''
    case 'campaign': return row.campaign?.id ?? ''
    case 'campaignStatus': return row.campaign?.status ?? ''
    case 'baseline': return row.campaign?.baselineRef ?? ''
    case 'entry': return row.entry?.entryId ?? ''
    case 'entryRequirement': return row.entry?.requirementId ?? ''
    case 'testVersion': return String(row.entry?.testVersion ?? '')
    case 'test': return row.testCaseId
    default:
      if (key.startsWith('run:')) return String(row.run?.fields?.[key.slice(4)] ?? '')
      if (key.startsWith('campaign:')) return String(row.campaign?.fields[key.slice(9)] ?? '')
      return ''
  }
}
