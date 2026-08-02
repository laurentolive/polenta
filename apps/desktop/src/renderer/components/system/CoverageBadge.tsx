import { useTranslation } from 'react-i18next'
import type { CoverageStatus, MatrixCell, TestCase } from '@polenta/types'

export interface CoverageEntry {
  coverageStatus: CoverageStatus
  cells: MatrixCell[]
}

interface CoverageBadgeProps {
  coverage: CoverageEntry | undefined
  testsById: Map<string, TestCase>
}

const CLASS_BY_STATUS: Record<CoverageStatus, string> = {
  not_covered: 'text-ink-3',
  covered: 'text-status-warning/80',
  validated: 'text-status-success',
  failing: 'text-status-danger',
  needs_revalidation: 'text-status-warning',
}

/** Badge de couverture de test (T138) — texte non éditable, réutilisé par WordView/ExcelView/
 *  EditView pour les exigences. `coverage` vient de `computeCoverage()`/`computeCoverageStatus()`
 *  (`traceability.service.ts`), consommé via `api.traceability.matrix` — jamais recalculé ici. */
export function CoverageBadge({ coverage, testsById }: CoverageBadgeProps) {
  const { t } = useTranslation()
  if (!coverage) return null
  const label = t(`system.coverage.status.${coverage.coverageStatus}`)
  const className = CLASS_BY_STATUS[coverage.coverageStatus]
  const tooltip = coverage.cells.length === 0
    ? t('system.coverage.noLinkedTest')
    : coverage.cells
      .map(cell => `${cell.testCaseId} — ${testsById.get(cell.testCaseId)?.title ?? '?'} (${cell.status})`)
      .join('\n')
  return (
    <span title={tooltip} className={`text-[10px] font-medium shrink-0 ${className}`}>
      {label}
    </span>
  )
}
