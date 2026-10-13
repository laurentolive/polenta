import type { TestRunStatus } from '@polenta/types'
import { isTestRunStatus, worstRunStatus } from '../../../lib/runStatus'
import { toLabel } from './numeric'

/**
 * GH69 — tableau croisé du widget matrice : une ligne par valeur du champ Lignes (`category`), une
 * colonne par valeur du champ Colonnes (`series`), cellule = agrégation des valeurs (`measure`) des
 * lignes du résultat portant ce couple. Pur (pas de React) pour être testé seul.
 *
 * Agrégation d'une cellule : que des statuts d'exécution → pire statut + répartition ; sinon que des
 * nombres → somme ; sinon valeurs distinctes jointes par « , ». Aucune ligne → cellule vide (le test
 * n'est pas dans la campagne), distincte de `pending`.
 */

export type MatrixCell =
  | { kind: 'empty' }
  | { kind: 'status'; status: TestRunStatus; count: number; breakdown: Partial<Record<TestRunStatus, number>> }
  | { kind: 'number'; value: number; count: number }
  | { kind: 'text'; value: string; count: number }

/** `key` = libellé (`toLabel`), `raw` = valeur brute de la première ligne qui le porte (drill-down). */
export interface MatrixAxisItem {
  key: string
  raw: unknown
  /** Lignes seulement : valeur du champ Libellé de la DERNIÈRE ligne du résultat portant cette valeur
   *  (requête triée chronologiquement → titre le plus récent, `testTitle` étant un snapshot par entrée). */
  label?: string
}

export interface Matrix {
  rows: MatrixAxisItem[]
  columns: MatrixAxisItem[]
  cell(rowKey: string, colKey: string): MatrixCell
}

export interface MatrixMapping {
  category: string
  series: string
  measure: string
  label?: string
}

const EMPTY: MatrixCell = { kind: 'empty' }
const NULL_LABEL = toLabel(null)
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function aggregateCell(values: unknown[]): MatrixCell {
  if (values.length === 0) return EMPTY
  const count = values.length
  if (values.every(isTestRunStatus)) {
    const statuses = values as TestRunStatus[]
    const breakdown: Partial<Record<TestRunStatus, number>> = {}
    for (const s of statuses) breakdown[s] = (breakdown[s] ?? 0) + 1
    return { kind: 'status', status: worstRunStatus(statuses), count, breakdown }
  }
  const numbers = values.map(asNumber)
  if (numbers.every((n) => n !== null)) {
    return { kind: 'number', value: (numbers as number[]).reduce((a, b) => a + b, 0), count }
  }
  return { kind: 'text', value: Array.from(new Set(values.map(toLabel))).join(', '), count }
}

export function buildMatrix(rows: Record<string, unknown>[], m: MatrixMapping): Matrix {
  const rowItems = new Map<string, MatrixAxisItem>()
  const colItems = new Map<string, MatrixAxisItem>()
  const cells = new Map<string, Map<string, unknown[]>>()

  for (const r of rows) {
    const rowKey = toLabel(r[m.category])
    const colKey = toLabel(r[m.series])
    const rowItem = rowItems.get(rowKey)
    if (!rowItem) rowItems.set(rowKey, { key: rowKey, raw: r[m.category] ?? null, ...(m.label ? { label: toLabel(r[m.label]) } : {}) })
    else if (m.label) rowItem.label = toLabel(r[m.label])
    if (!colItems.has(colKey)) colItems.set(colKey, { key: colKey, raw: r[m.series] ?? null })
    let byCol = cells.get(rowKey)
    if (!byCol) cells.set(rowKey, (byCol = new Map()))
    const values = byCol.get(colKey)
    if (values) values.push(r[m.measure])
    else byCol.set(colKey, [r[m.measure]])
  }

  // Lignes : ordre naturel du libellé (`TEST-0002` avant `TEST-0010`), « — » en dernier. Colonnes :
  // ordre de première apparition — l'utilisateur le maîtrise par l'ORDER BY de sa requête.
  const sortedRows = Array.from(rowItems.values()).sort((a, b) => {
    if (a.key === NULL_LABEL) return b.key === NULL_LABEL ? 0 : 1
    if (b.key === NULL_LABEL) return -1
    return collator.compare(a.key, b.key)
  })

  const aggregated = new Map<string, MatrixCell>()
  return {
    rows: sortedRows,
    columns: Array.from(colItems.values()),
    cell(rowKey, colKey) {
      const id = `${rowKey}\u0000${colKey}`
      let c = aggregated.get(id)
      if (!c) {
        c = aggregateCell(cells.get(rowKey)?.get(colKey) ?? [])
        aggregated.set(id, c)
      }
      return c
    },
  }
}
