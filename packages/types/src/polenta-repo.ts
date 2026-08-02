/**
 * Types for polenta-repo.yaml — the dependency manifest at the root of each repo.
 * Only repos with dependencies declare this file; leaf repos omit it entirely.
 */

export interface PolentaRepoDependency {
  /** Mount name: the directory name used in the workspace (and in objectTypeRef cross-component). */
  name: string
  /** Git remote URL (https or ssh). */
  url: string
  /** Pinned commit SHA or tag. Managed by the parent repo (configuration management). */
  pin: string
  /** T123 (follow-up) — name of a local SystemNode (in the declaring repo's own schema.yaml)
   *  this dependency is nested under for display, so a local component can host repo-separate
   *  components/interfaces exactly like a repo can. Absent = mounted flatly under the repo, as
   *  before this field existed. */
  localParent?: string
}

export interface PolentaRepoManifest {
  dependencies?: PolentaRepoDependency[]
}
