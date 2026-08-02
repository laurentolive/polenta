/**
 * ComplianceMatrix — T69 Sprint 4
 *
 * Displays the compliance matrix for a single interface repo:
 *   Rows    = approved requirements of the interface, grouped by role
 *   Columns = component repos that declared implementing this interface
 *   Cells   = covered / missing / validated / na (greyed-out)
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, XCircle, AlertCircle, Minus } from 'lucide-react'
import type { ComplianceMatrix as ComplianceMatrixData, ComplianceCellStatus } from '@polenta/types'

interface ComplianceMatrixProps {
  matrix: ComplianceMatrixData
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

export function ComplianceMatrixComponent({ matrix }: ComplianceMatrixProps) {
  const { t } = useTranslation()
  if (matrix.requirements.length === 0) {
    return (
      <p className="text-sm text-ink-3 italic">
        {t('complianceMatrix.noApprovedRequirement')}
      </p>
    )
  }

  if (matrix.components.length === 0) {
    return (
      <p className="text-sm text-ink-3 italic">
        {t('complianceMatrix.noImplementingComponent')}
      </p>
    )
  }

  // Group requirements by their first role (or 'commun' if no roles)
  const roleGroups = new Map<string, typeof matrix.requirements>()
  for (const req of matrix.requirements) {
    const groupKey = req.roles.length > 0 ? req.roles.join(', ') : 'commun'
    if (!roleGroups.has(groupKey)) roleGroups.set(groupKey, [])
    roleGroups.get(groupKey)!.push(req)
  }

  // Build cell lookup: requirementId → componentName → ComplianceCellStatus
  const cellMap = new Map<string, Map<string, { status: ComplianceCellStatus; linkId?: string }>>()
  for (const cell of matrix.cells) {
    if (!cellMap.has(cell.requirementId)) cellMap.set(cell.requirementId, new Map())
    cellMap.get(cell.requirementId)!.set(cell.componentName, {
      status: cell.status,
      linkId: cell.linkId,
    })
  }

  const getCell = (reqId: string, compName: string): ComplianceCellStatus => {
    return cellMap.get(reqId)?.get(compName)?.status ?? 'na'
  }

  return (
    <div className="space-y-3">
      <Legend />

      <div className="overflow-x-auto rounded-xl border border-edge">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-surface border-b border-edge">
              <th className="text-left py-2 px-3 text-xs text-ink-3 font-medium min-w-[200px]">
                {t('complianceMatrix.requirement')}
              </th>
              <th className="text-left py-2 px-3 text-xs text-ink-3 font-medium w-24">
                {t('complianceMatrix.roles')}
              </th>
              {matrix.components.map(comp => (
                <th
                  key={comp.name}
                  className="py-2 px-3 text-xs text-ink-3 font-medium text-center min-w-[120px]"
                >
                  <div className="font-medium text-ink">{comp.name}</div>
                  {comp.roles.length > 0 && (
                    <div className="text-ink-3 font-normal">{comp.roles.join(', ')}</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(roleGroups.entries()).map(([groupKey, reqs]) => (
              <React.Fragment key={groupKey}>
                {/* Role group header */}
                <tr className="bg-surface/60">
                  <td
                    colSpan={2 + matrix.components.length}
                    className="py-1.5 px-3 text-xs font-semibold text-ink-2 uppercase tracking-wide border-b border-edge/50"
                  >
                    {groupKey === 'commun' ? t('complianceMatrix.commonRequirements') : t('complianceMatrix.roleGroup', { role: groupKey })}
                  </td>
                </tr>
                {reqs.map(req => (
                  <tr key={req.id} className="border-b border-edge/40 hover:bg-hover transition-colors">
                    <td className="py-2 px-3 text-ink">
                      <div className="font-mono text-xs text-ink-3 mb-0.5">{req.id}</div>
                      <div className="text-sm line-clamp-2">{req.title}</div>
                    </td>
                    <td className="py-2 px-3 text-xs text-ink-3">
                      {req.roles.length > 0 ? req.roles.join(', ') : '—'}
                    </td>
                    {matrix.components.map(comp => {
                      const status = getCell(req.id, comp.name)
                      return (
                        <td
                          key={comp.name}
                          className={`py-2 px-3 text-center ${status === 'na' ? 'bg-surface/30' : ''}`}
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            <CellIcon status={status} />
                            <CellLabel status={status} />
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
