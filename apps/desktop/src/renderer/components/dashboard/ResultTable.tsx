/**
 * ResultTable — lignes produites par un script de la vue Suivi (vue Requêtes, widget table). État
 * vide explicite. `_ids` (identifiants des objets d'origine) n'est pas une colonne affichée : une
 * ligne qui en porte s'ouvre (double-clic, Entrée) quand `onRowClick` est fourni (GH74).
 *
 * GH389 §4 — grille commune (`DataGrid`), colonnes = celles du script (pas de 👁) : page Requête
 * avec barre d'outils (filtre par colonne, largeurs, gel, ordre, hauteur, export) ; widget (`compact`)
 * avec liens et clavier seulement. L'impression garde un tableau statique.
 */

import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { QueryResult } from '@polenta/types'
import { useElementNav } from '../../contexts/ElementNavContext'
import { ElementLink } from '../element/ElementLink'
import { ElementRefText } from '../element/elementRefDelegation'
import { DataGrid } from '../grid/DataGrid'
import type { GridColumn } from '../grid/gridTypes'
import type { GridPrefsSource } from '../grid/useGridPrefs'
import { useGridScrollKey } from '../grid/useGridScrollKey'

type BooleanLabels = { true: string; false: string }

function formatCell(v: unknown, booleanLabels: BooleanLabels): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? booleanLabels.true : booleanLabels.false
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** GH229 — cellule : un ID d'élément existant est un lien, les ID écrits dans un texte aussi. */
function ResultCell({ value, booleanLabels }: { value: unknown; booleanLabels: BooleanLabels }) {
  const nav = useElementNav()
  const text = formatCell(value, booleanLabels)
  if (typeof value !== 'string') return <>{text}</>
  if (nav?.resolve(value)) return <ElementLink id={value} />
  return <ElementRefText text={text} />
}

/** Ligne qui désigne des objets (drill-down) : `_ids` non vide. */
export function rowHasIds(row: Record<string, unknown>): boolean {
  return Array.isArray(row._ids) && row._ids.length > 0
}

interface ResultRow { key: string; row: Record<string, unknown> }
const rowKey = (r: ResultRow) => r.key
const splitKeys = (joined: string) => (joined ? joined.split('\n') : [])
/** Colonnes du script dans l'ordre enregistré ; une colonne nouvelle du script s'ajoute à la fin. */
const withScriptColumns = (keys: readonly string[]) => (stored: string[]) => [
  ...stored.filter(k => keys.includes(k)),
  ...keys.filter(k => !stored.includes(k)),
]

export function ResultTable({ result, onRowClick, compact = false, print = false, repoPath, title }: {
  result: QueryResult | null
  onRowClick?: (row: Record<string, unknown>) => void
  /** Widget table : la grille occupe la carte, liens et clavier seulement. */
  compact?: boolean
  /** Route d'impression : tableau statique, sans grille. */
  print?: boolean
  /** Repo des préférences (`grid::query-result`) et de l'export ; absent : préférences locales, pas d'export. */
  repoPath?: string
  /** Nom de feuille et de fichier de l'export. */
  title?: string
}) {
  const { t } = useTranslation()
  const booleanLabels = useMemo(() => ({ true: t('dashboardPage.resultTable.booleanTrue'), false: t('dashboardPage.resultTable.booleanFalse') }), [t])
  const scrollKey = useGridScrollKey('query-result')
  const names = useMemo(() => (result?.columns ?? []).map(c => c.name).filter(n => n !== '_ids'), [result])
  const namesKey = names.join('\n')
  const rows = useMemo<ResultRow[]>(() => (result?.rows ?? []).map((row, i) => ({ key: String(i), row })), [result])

  const columns = useMemo<GridColumn<ResultRow>[]>(() => splitKeys(namesKey).map(name => ({
    key: name,
    label: name,
    getText: r => formatCell(r.row[name], booleanLabels),
    render: r => <ResultCell value={r.row[name]} booleanLabels={booleanLabels} />,
  })), [namesKey, booleanLabels])
  const prefs = useMemo<GridPrefsSource>(() => (repoPath && !compact
    ? { repoPath, prefKey: 'grid::query-result', view: 'columns', defaults: splitKeys(namesKey) }
    : { local: true, defaults: splitKeys(namesKey) }), [repoPath, compact, namesKey])
  const migrateColumns = useMemo(() => withScriptColumns(splitKeys(namesKey)), [namesKey])
  const clickRef = useRef(onRowClick)
  clickRef.current = onRowClick
  const onActivate = useCallback((r: ResultRow) => { if (rowHasIds(r.row)) clickRef.current?.(r.row) }, [])

  if (!result) {
    return <p className="text-xs text-ink-3 py-6 text-center">{t('dashboardPage.resultTable.executeQueryHint')}</p>
  }
  if (result.rows.length === 0) {
    return <p className="text-xs text-ink-3 py-6 text-center">{t('dashboardPage.resultTable.noRowForQuery')}</p>
  }

  if (print) {
    return (
      <div className="overflow-auto border border-edge rounded-lg">
        <table className="min-w-full text-xs">
          <thead className="bg-canvas">
            <tr>
              {names.map(name => (
                <th key={name} className="text-left font-medium text-ink-2 px-3 py-2 border-b border-edge whitespace-nowrap">{name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="border-b border-edge-subtle last:border-0">
                {names.map(name => (
                  <td key={name} className="px-3 py-1.5 text-ink whitespace-nowrap"><ResultCell value={row[name]} booleanLabels={booleanLabels} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className={`flex flex-col min-h-0 ${compact ? 'h-full' : 'max-h-[60vh]'}`} data-testid="query-result">
      <DataGrid
        gridId="query-result"
        title={title ?? t('dashboardPage.resultTable.gridTitle')}
        rows={rows}
        getRowId={rowKey}
        columns={columns}
        prefs={prefs}
        migrateColumns={migrateColumns}
        onActivate={onRowClick ? onActivate : undefined}
        compact={compact}
        noColumnPicker
        exportRepoPath={repoPath}
        scrollMemoryKey={compact ? null : scrollKey}
      />
    </div>
  )
}
