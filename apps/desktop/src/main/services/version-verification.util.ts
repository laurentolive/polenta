import type { CoverageStatus, TraceabilityMatrix, VersionRequirementRow, VersionVerification, VersionVerificationRow } from '@polenta/types'
import type { ValidationRequirement } from './validation-rows.util'

// GH439 — couverture des exigences d'une version : gel au passage released et lignes de la page.
// Fonctions pures : le service lit (git, matrice), celles-ci décident.

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, undefined, { numeric: true })
const numeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/**
 * Couverture à figer : une ligne par exigence du périmètre, triée par ID. Une exigence absente de la
 * matrice vaut `not_covered` (comme `ValidationsService.liveColumns`) ; les tests sont des IDs seuls.
 */
export function buildVerification(
  requirements: ValidationRequirement[], matrix: Pick<TraceabilityMatrix, 'requirements'>, now: Date,
): VersionVerification {
  // Même lecture de la matrice que la page d'une version en cours : la valeur figée et l'affichage à l'instant
  // ne peuvent pas diverger sur les mêmes données.
  const coverageOf = liveCoverage(matrix)
  const rows = requirements.map(({ state }): VersionVerificationRow => ({ id: state.id, ...coverageOf(state.id) })).sort(byId)
  return { computedAt: now.toISOString(), rows }
}

/** Couverture d'une exigence telle qu'affichée : statut et tests ; `null` : non figée. */
export interface RequirementCoverage { status: CoverageStatus; tests: string[] }

/** Lignes de la page : exigences du périmètre (déjà filtrées), couverture lue par ID, tri numérique. */
export function buildRequirementRows(
  requirements: ValidationRequirement[], coverageOf: (id: string) => RequirementCoverage | null,
): VersionRequirementRow[] {
  return requirements
    .map(({ state, fields }): VersionRequirementRow => {
      const coverage = coverageOf(state.id)
      return {
        requirementId: state.id, title: state.title, objectTypeRef: state.objectTypeRef,
        status: state.status, version: state.version, fields,
        coverageStatus: coverage?.status ?? null, tests: coverage?.tests ?? [],
      }
    })
    .sort((a, b) => numeric(a.requirementId, b.requirementId))
}

/** Couverture figée d'une version released, indexée par ID d'exigence. */
export function frozenCoverage(verification: VersionVerification): (id: string) => RequirementCoverage | null {
  const rows = new Map(verification.rows.map(r => [r.id, r]))
  return id => {
    const row = rows.get(id)
    return row ? { status: row.status, tests: row.tests } : null
  }
}

/** Couverture calculée à l'instant (version en cours) : une exigence absente de la matrice n'est pas couverte. */
export function liveCoverage(matrix: Pick<TraceabilityMatrix, 'requirements'>): (id: string) => RequirementCoverage {
  const rows = new Map(matrix.requirements.map(r => [r.requirement.id, r]))
  return id => {
    const row = rows.get(id)
    return {
      status: row?.coverageStatus ?? 'not_covered',
      tests: [...new Set((row?.cells ?? []).map(c => c.testCaseId))].sort(numeric),
    }
  }
}
