import type { Requirement } from './requirement'
import type { TestCase } from './test'

// ─── Coverage ─────────────────────────────────────────────────────────────────

// Priorité de calcul (T63 ; cf. specs/SPEC-TRACEABILITY.md §2.2) :
// needs_revalidation > failing > covered > validated > not_covered.
export type CoverageStatus =
  | 'not_covered'        // aucun test lié
  | 'covered'            // au moins un test lié, mais au moins un lien encore not_run
                          // (couvre aussi le cas mixte : un test PASS + un autre jamais exécuté)
  | 'validated'          // au moins un test lié, ET tous les tests liés (hors fail/blocked/
                          // needs_revalidation) ont au moins une exécution PASS
  | 'failing'            // dernière exécution FAIL ou BLOCKED
  | 'needs_revalidation' // l'exigence ou un de ses tests liés est marqué needsRevalidation (T172)

export type CellStatus =
  | 'not_run'
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'needs_revalidation'

export interface MatrixCell {
  testCaseId: string
  coverageType: 'full' | 'partial'
  status: CellStatus
  lastRunId: string | null
  lastRunDate: string | null
}

export interface MatrixRow {
  requirement: Requirement
  coverageStatus: CoverageStatus
  cells: MatrixCell[]
}

export interface TraceabilityMatrix {
  requirements: MatrixRow[]
  testCases: Pick<TestCase, 'id' | 'title' | 'objectTypeRef' | 'status'>[]
  filters: Record<string, unknown>
  generatedAt: string
}

// ─── Missing links ─────────────────────────────────────────────────────────────

/** T172 — élément (exigence ou test) marqué `needsRevalidation` : impact à vérifier. */
export interface RevalidationItem {
  elementId: string
  elementType: 'requirement' | 'test_case'
  title: string
  status: string
}

// ─── Impact analysis ──────────────────────────────────────────────────────────

export type ImpactElementType = 'requirement' | 'test_case'

export interface ImpactItem {
  elementId: string
  elementType: ImpactElementType
  title: string
  linkType: string
  depth: number
  lastRunResult?: string
  lastRunDate?: string
  acknowledged: boolean
}

export interface ImpactReport {
  triggerId: string
  triggerType: ImpactElementType
  depth: number
  items: ImpactItem[]
  activeCampaignRuns: Array<{ id: string; title: string; progress: string }>
  generatedAt: string
}

export interface ImpactAcknowledgement {
  id: string
  elementId: string
  elementType: ImpactElementType
  triggerReqId: string
  acknowledgedAt: string
  acknowledgedBy: string
  comment: string | null
}

// ─── Test plan generation ──────────────────────────────────────────────────────

export interface TestPlanGenerationParams {
  requirementIds?: string[]
  requirementTypes?: string[]
  requirementTags?: string[]
  testCaseFilter: 'approved_only' | 'include_draft'
  coverageFilter: 'full_only' | 'all'
}

export interface TestPlanSummary {
  selectedRequirements: number
  testCasesFound: number
  withPassingRun: number
  withFailingRun: number
  neverExecuted: number
  uncoveredRequirements: number
}

export interface TestPlanDraft {
  title: string
  testCaseRefs: string[]     // IDs des cas de test — la version est le commit git
  summary: TestPlanSummary
  uncoveredRequirementIds: string[]
}

// ─── Matrix export ─────────────────────────────────────────────────────────────

export interface MatrixExportRow {
  reqId: string
  reqTitle: string
  reqObjectTypeRef: string
  reqStatus: string
  coverageStatus: CoverageStatus
  testId: string | null
  testTitle: string | null
  coverageType: 'full' | 'partial' | null
  lastRunResult: string | null
  lastRunDate: string | null
}
