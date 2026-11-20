/**
 * ComplianceMatrix — T69 Sprint 4
 *
 * Displays the compliance matrix for a single interface repo:
 *   Rows    = approved requirements of the interface, grouped by role
 *   Columns = component repos that declared implementing this interface
 *   Cells   = covered / missing / validated / na (greyed-out)
 */

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, XCircle, AlertCircle, Minus } from 'lucide-react'
import type { ComplianceMatrix as ComplianceMatrixData, ComplianceCellStatus } from '@polenta/types'
import { ElementLink } from './element/ElementLink'
import { DataGrid } from './grid/DataGrid'
import type { GridColumn } from './grid/gridTypes'
import type { GridPrefsSource } from './grid/useGridPrefs'
import { useGridScrollKey } from './grid/useGridScrollKey'

interface ComplianceMatrixProps {
  matrix: ComplianceMatrixData
  /** Repo des préférences de la grille et de l'export ; absent : préférences locales, pas d'export. */
  repoPath?: string
}

// ── Cell rendering ────────────────────────────────────────────────────────────

function CellIcon({ status }: { status: ComplianceCellStatus }) {
  switch (status) {
    case 'validated':
      return <CheckCircle2 size={14} className="text-status-success" />
    case 'covered':
      return <AlertCircle size={14} className="text-status-warning" />
    case 'missing':
      return <XCircle size={14} className="text-status-danger" />
    case 'na':
      return <Minus size={14} className="text-ink-3/40" />
  }
}

function CellLabel({ status }: { status: ComplianceCellStatus }) {
  const { t } = useTranslation()
  switch (status) {
    case 'validated':
      return <span className="text-status-success text-xs font-medium">{t('complianceMatrix.validated')}</span>
    case 'covered':
      return <span className="text-status-warning text-xs font-medium">{t('complianceMatrix.covered')}</span>
    case 'missing':
      return <span className="text-status-danger text-xs font-medium">{t('complianceMatrix.missing')}</span>
    case 'na':
      return <span className="text-ink-3/50 text-xs">—</span>
  }
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-4 text-xs text-ink-3">
      <span className="flex items-center gap-1">
        <CheckCircle2 size={12} className="text-status-success" />
        {t('complianceMatrix.legendValidated')}
      </span>
      <span className="flex items-center gap-1">
        <AlertCircle size={12} className="text-status-warning" />
        {t('complianceMatrix.legendCovered')}
      </span>
      <span className="flex items-center gap-1">
        <XCircle size={12} className="text-status-danger" />
        {t('complianceMatrix.legendMissing')}
      </span>
      <span className="flex items-center gap-1">
        <Minus size={12} className="text-ink-3/40" />
        {t('complianceMatrix.legendNotApplicable')}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Row = ComplianceMatrixData['requirements'][number] & { group: string }
const COMMON = 'commun'
const rowId = (r: Row) => r.id
const groupOf = (r: Row) => r.group
const compKey = (name: string) => `comp::${name}`

/**
 * GH389 §4 — matrice sur la grille commune (`DataGrid`) : filtre par colonne, largeurs, gel (en-tête
 * et première colonne par défaut), clavier, liens d'élément, export ; ni 👁 ni réordonnancement ;
 * lignes de groupe par rôle. Préférences `grid::compliance` du repo affiché (`repoPath`).
 */
export function ComplianceMatrixComponent({ matrix, repoPath }: ComplianceMatrixProps) {
  const { t } = useTranslation()

  // Exigences groupées par rôle(s), groupes dans l'ordre de première apparition.
  const rows = useMemo<Row[]>(() => {
    const groups = new Map<string, Row[]>()
    for (const req of matrix.requirements) {
      const group = req.roles.length > 0 ? req.roles.join(', ') : COMMON
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group)!.push({ ...req, group })
    }
    return [...groups.values()].flat()
  }, [matrix.requirements])

  const columns = useMemo<GridColumn<Row>[]>(() => {
    const cellMap = new Map<string, ComplianceCellStatus>()
    for (const cell of matrix.cells) cellMap.set(`${cell.requirementId}|${cell.componentName}`, cell.status)
    const statusOf = (reqId: string, comp: string): ComplianceCellStatus => cellMap.get(`${reqId}|${comp}`) ?? 'na'
    const label = (status: ComplianceCellStatus) => (status === 'na' ? '—' : t(`complianceMatrix.${status}`))
    return [
      {
        key: 'requirement', label: t('complianceMatrix.requirement'), locked: true,
        getText: r => `${r.id} ${r.title}`,
        render: r => (
          <>
            <ElementLink id={r.id} className="font-mono text-xs text-prim" />
            <div className="text-ink">{r.title}</div>
          </>
        ),
        elementId: r => r.id,
      },
      { key: 'roles', label: t('complianceMatrix.roles'), getText: r => (r.roles.length > 0 ? r.roles.join(', ') : '—') },
      ...matrix.components.map((comp): GridColumn<Row> => ({
        key: compKey(comp.name),
        label: comp.roles.length > 0 ? `${comp.name} (${comp.roles.join(', ')})` : comp.name,
        getText: r => label(statusOf(r.id, comp.name)),
        render: r => {
          const status = statusOf(r.id, comp.name)
          return (
            <span className="flex flex-col items-center gap-0.5">
              <CellIcon status={status} />
              <CellLabel status={status} />
            </span>
          )
        },
      })),
    ]
  }, [matrix, t])
  const keys = useMemo(() => columns.map(c => c.key), [columns])
  // Colonnes = composants de l'interface : toutes affichées, dans l'ordre du calcul.
  const migrateColumns = useCallback(() => keys, [keys])
  const prefs = useMemo<GridPrefsSource>(() => (repoPath
    ? { repoPath, prefKey: 'grid::compliance', view: 'columns', defaults: keys, defaultFreeze: 1 }
    : { local: true, defaults: keys, defaultFreeze: 1 }), [repoPath, keys])
  const renderGroup = useCallback(
    (group: string) => (group === COMMON ? t('complianceMatrix.commonRequirements') : t('complianceMatrix.roleGroup', { role: group })),
    [t],
  )
  const scrollKey = useGridScrollKey(`compliance-${matrix.interfaceName}`)

  if (matrix.requirements.length === 0) {
    return <p className="text-sm text-ink-3 italic">{t('complianceMatrix.noApprovedRequirement')}</p>
  }
  if (matrix.components.length === 0) {
    return <p className="text-sm text-ink-3 italic">{t('complianceMatrix.noImplementingComponent')}</p>
  }

  return (
    <div className="space-y-3">
      <Legend />
      <div className="flex flex-col max-h-[70vh] min-h-0" data-testid="compliance-matrix">
        <DataGrid
          gridId="compliance"
          title={t('compliancePage.tabTitle', { name: matrix.interfaceName })}
          rows={rows}
          getRowId={rowId}
          columns={columns}
          prefs={prefs}
          migrateColumns={migrateColumns}
          groupOf={groupOf}
          renderGroup={renderGroup}
          noColumnPicker
          noReorder
          exportRepoPath={repoPath || undefined}
          scrollMemoryKey={scrollKey}
        />
      </div>
    </div>
  )
}
