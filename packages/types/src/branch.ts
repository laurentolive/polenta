export interface Branch {
  id: string
  projectId: string
  name: string
  gitRef: string
  parentBranchId: string | null
  forkCommitSha: string | null
  status: 'active' | 'merged' | 'abandoned'
  createdAt: string
  createdBy: string
}

// ─── Branche d'intégration (GH106, specs/GH106-design.md §2.1) ─────────────────

/**
 * - `ok` : branche courante = intégration désignée, ou branche qui n'est pas une `int-*`.
 * - `incoherent` : branche courante `int-X` dont `config/project.yaml` désigne une autre branche.
 * - `nonConvention` : intégration désignée sans préfixe `int-` (`main`, repli historique).
 * - `readonly` : detached HEAD.
 */
export type IntegrationStatus = 'ok' | 'incoherent' | 'nonConvention' | 'readonly'

export interface IntegrationState {
  /** `''` en detached HEAD. */
  currentBranch: string
  /** `config/project.yaml` du WD, repli `'main'`. */
  configured: string
  status: IntegrationStatus
  /** `int-*` locales et `origin/int-*`, dédoublonnées et triées ; `remoteOnly` si absente en local. */
  candidates: { name: string; remoteOnly: boolean }[]
}

export type DefaultBranchOutcome = 'set' | 'unchanged' | 'not-admin' | 'no-forge' | 'push-pending' | { error: string }

export interface DesignateOutcome {
  branch: string
  /** `false` si `project.yaml` désignait déjà la branche. */
  committed: boolean
  commitSha?: string
  /** Best-effort, comme le push de « Publier ». */
  push: 'ok' | 'no-remote' | { error: string }
  defaultBranch: DefaultBranchOutcome
}

/** Codes des refus de suppression (spec GH103 §1.5) ; le message affiché est traduit côté renderer. */
export type IntegrationGuardCode = 'designated' | 'lastIntegration'
