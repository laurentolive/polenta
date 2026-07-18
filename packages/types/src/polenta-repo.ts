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
}

export interface PolentaRepoManifest {
  dependencies?: PolentaRepoDependency[]
}
