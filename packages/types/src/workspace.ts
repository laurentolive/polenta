/** A folder the user has previously opened as a project, for the "Récents" list. */
export interface ProjectRecent {
  /** Absolute path to the project's container directory (holds .polenta/workspace.yaml). */
  workspaceDir: string
  name: string
  lastOpenedAt: string
}

/** Resolved identity of an open project, derived from its workspace marker. */
export interface ProjectInfo {
  name: string
  /** Display label from the root repo's schema.yaml (SystemNode `root`), if configured.
   *  UI should always prefer this over `name` when present. */
  label?: string
  /** Absolute path to the root repo — where requirements/tests/config actually live. */
  localPath: string
  /** Absolute path to the container directory (holds .polenta/workspace.yaml). */
  workspaceDir: string
  /** Root repo's `origin` remote URL (e.g. GitHub), if any is configured. */
  remoteUrl?: string
}
