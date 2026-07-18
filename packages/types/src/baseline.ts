// ─── Component reference ──────────────────────────────────────────────────────

export interface ComponentRef {
  id: string
  name: string
  sourceProjectId: string
  sourceRef: string     // toujours un tag baseline, jamais "main"
  mountPoint: string
  prefix: string
}

export interface ComponentsConfig {
  components: ComponentRef[]
}

// ─── Baseline ─────────────────────────────────────────────────────────────────

export interface BaselineComponentSnapshot {
  id: string
  name: string
  sourceProjectId: string
  sourceRef: string
  commitSha: string
}

export interface BaselineStats {
  requirements: {
    total: number
    approved: number
    terminal: number    // objets avec un statut isTerminal (ex: obsolete)
  }
  tests: {
    total: number
    approved: number
    terminal: number
  }
  coverage: {
    covered: number
    notCovered: number
    coverageRate: number   // 0–100
  }
  execution: {
    passRate: number       // 0–100
    lastRunDate: string | null
  }
}

export interface Baseline {
  id: string
  name: string
  tag: string              // git tag e.g. "baseline/v1.0"
  branch: string
  commitSha: string
  createdAt: string
  createdBy: string
  milestone: string
  description: string
  forcedCreation: boolean
  warnings: string[]
  stats: BaselineStats
  components: BaselineComponentSnapshot[]
}

// ─── Baseline diff ────────────────────────────────────────────────────────────

export interface FieldChange {
  field: string
  from: unknown
  to: unknown
}

export interface RequirementDiff {
  reqId: string
  reqTitle: string
  changedFields: FieldChange[]
}

export interface ComponentUpdate {
  id: string
  name: string
  from: string
  to: string
}

export interface BaselineDiff {
  fromBaseline: string
  toBaseline: string
  addedRequirements: Array<{ reqId: string; reqTitle: string }>
  removedRequirements: Array<{ reqId: string; reqTitle: string }>
  modifiedRequirements: RequirementDiff[]
  testCoverageChange: { from: number; to: number }
  componentUpdates: ComponentUpdate[]
}

// ─── Branch metadata ──────────────────────────────────────────────────────────

export interface BranchConflict {
  filePath: string
  objectId: string
  objectType: 'requirement' | 'test_case' | 'other'
  fieldConflicts: Array<{
    field: string
    base: unknown
    ours: unknown
    theirs: unknown
  }>
  autoResolved: Array<{
    field: string
    resolvedValue: unknown
    resolvedFrom: 'ours' | 'theirs'
  }>
}

export interface MergeResult {
  success: boolean
  conflicts: BranchConflict[]
}
