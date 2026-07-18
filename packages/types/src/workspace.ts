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
  /** Absolute path to the root repo — where requirements/tests/config actually live. */
  localPath: string
  /** Absolute path to the container directory (holds .polenta/workspace.yaml). */
  workspaceDir: string
}
