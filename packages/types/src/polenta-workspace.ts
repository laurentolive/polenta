/**
 * Types for the Polenta flat workspace.
 *
 * A workspace is a directory on disk that contains:
 *   <workspace>/
 *     .polenta/               ← marker directory (NOT versioned)
 *       workspace.yaml        ← PolentaWorkspaceConfig
 *       tree.cache.yaml       ← WorkspaceTree (regenerated on open)
 *     <root-repo>/            ← root repo (already cloned)
 *     <dep-a>/                ← dependency cloned by Polenta
 *     <dep-b>/
 */

/** A mount override lets the user rename a dependency when two pins of the
 *  same repo must coexist (diamond dependency, Option B). */
export interface MountOverride {
  /** Git remote URL (same as in polenta-repo.yaml). */
  url: string
  /** Pinned commit SHA or tag. */
  pin: string
  /** User-chosen directory name for this specific (url, pin) pair. */
  mountAs: string
}

/** Stored in <workspace>/.polenta/workspace.yaml */
export interface PolentaWorkspaceConfig {
  /** Directory name of the root repo inside the workspace. Ignored when `selfContained` is true. */
  rootRepo?: string
  /** True when the workspace dir itself is the root repo (adopted in place, no nesting). */
  selfContained?: boolean
  /** User-configured name overrides for diamond dependencies. */
  mountOverrides?: MountOverride[]
}

/** One node in the logical workspace tree. */
export interface WorkspaceTreeNode {
  /** Mount name (directory name in the workspace). */
  name: string
  /** Display label from this repo's own schema.yaml (SystemNode `root`), if configured.
   *  UI should always prefer this over `name` when present. */
  label?: string
  /** Absolute path to the cloned repo on disk. */
  repoPath: string
  /** Git remote URL. */
  url: string
  /** Pinned commit SHA or tag. */
  pin: string
  /** True if the repo declares `roles` in its schema.yaml (i.e. it is an interface repo). */
  isInterface: boolean
  /**
   * Interface implementations declared by this repo (Sprint 4).
   * Populated from `implements:` in the repo's schema.yaml. The implemented
   * version is not carried here — resolve it via the mounted interface
   * node's own `pin` (look it up by `interface` name in the workspace tree).
   */
  implements?: Array<{ interface: string; roles: string[] }>
  /** T123 (follow-up) — name of a local SystemNode of the parent repo this node is nested under
   *  for display (mirrors PolentaRepoDependency.localParent). Absent = nested flatly under the
   *  parent repo, as before this field existed. */
  localParent?: string
  /** Direct children (logical tree, not filesystem). */
  children: WorkspaceTreeNode[]
}

/** The full workspace tree, stored in <workspace>/.polenta/tree.cache.yaml */
export interface WorkspaceTree {
  /** HEAD SHA of the root repo at cache time — used to detect staleness. */
  rootRepoHeadSha: string
  /** ISO timestamp. */
  generatedAt: string
  /** Flat list of all repos in the workspace (deduplicated). */
  nodes: WorkspaceTreeNode[]
  /** Logical tree rooted at the root repo. */
  logicalTree: WorkspaceTreeNode
}

/** Describes a diamond dependency conflict (same URL, different pins). */
export interface DiamondConflict {
  /** Git remote URL of the conflicting repo. */
  url: string
  /** Each pin variant with the list of parent repos that require it. */
  pins: { pin: string; requiredBy: string[] }[]
}

/**
 * Result returned by workspace:open IPC channel.
 * Sprint 1 only implements 'ok' and 'not-a-workspace'.
 * 'diamond-conflict' and 'parse-error' are added in Sprint 2.
 */
export type WorkspaceOpenResult =
  | { status: 'ok'; tree: WorkspaceTree }
  | { status: 'not-a-workspace' }
  | { status: 'diamond-conflict'; conflicts: DiamondConflict[] }
  | { status: 'parse-error'; repoName: string; error: string }

// ── Compliance matrix (T69 Sprint 4) ─────────────────────────────────────────

/**
 * Status of a compliance cell.
 * - covered   : a link exists between the component and the requirement
 * - missing   : no link exists (but the requirement is applicable based on roles)
 * - validated : link exists AND the link has been validated (no needsRevalidation)
 * - na        : requirement role does not apply to this component
 */
export type ComplianceCellStatus = 'covered' | 'missing' | 'validated' | 'na'

/** One cell in the compliance matrix: (requirement × component). */
export interface ComplianceCell {
  requirementId: string
  componentName: string
  status: ComplianceCellStatus
  /** ID of the link if status is 'covered' or 'validated'. */
  linkId?: string
}

/** Row descriptor for the compliance matrix. */
export interface ComplianceRequirementRow {
  id: string
  title: string
  /** Roles tagged on this requirement; empty array = applies to all roles. */
  roles: string[]
  status: string
}

/** Column descriptor for the compliance matrix. */
export interface ComplianceComponentColumn {
  name: string
  roles: string[]
  repoPath: string
}

/** Full compliance matrix for one interface repo. */
export interface ComplianceMatrix {
  interfaceName: string
  requirements: ComplianceRequirementRow[]
  components: ComplianceComponentColumn[]
  cells: ComplianceCell[]
}

/** Coverage result for a single component × interface pair. */
export interface CoverageResult {
  componentName: string
  interfaceName: string
  declaredRoles: string[]
  applicable: ComplianceRequirementRow[]
  covered: string[]
  missing: string[]
  validated: string[]
}
