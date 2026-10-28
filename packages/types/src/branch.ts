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
 * - `detached` : detached HEAD (composant épinglé sur un commit, baseline) — le menu reste actif,
 *   choisir une branche en fait le checkout.
 */
export type IntegrationStatus = 'ok' | 'incoherent' | 'nonConvention' | 'detached'

export interface IntegrationState {
  /** `''` en detached HEAD. */
  currentBranch: string
  /** Commit de HEAD (`''` dans un repo vide) : position de retour en detached HEAD. */
  headOid: string
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

// Le refus voyage dans le message de l'erreur, seule partie transmise par l'IPC et le bridge web
// (même principe que `⟦forge-access …⟧`) : le renderer le traduit par code.
const GUARD_START = '⟦integration-guard '
const GUARD_END = '⟧ '

export function encodeIntegrationGuard(code: IntegrationGuardCode, branch: string, humanMessage: string): string {
  return `${GUARD_START}${JSON.stringify({ code, branch })}${GUARD_END}${humanMessage}`
}

/** Où qu'il soit dans le message (l'IPC Electron le préfixe) ; `null` sans marqueur valide. */
export function parseIntegrationGuard(message: string): { code: IntegrationGuardCode; branch: string } | null {
  const start = message.indexOf(GUARD_START)
  if (start < 0) return null
  const end = message.indexOf(GUARD_END, start + GUARD_START.length)
  if (end < 0) return null
  try {
    const data = JSON.parse(message.slice(start + GUARD_START.length, end)) as { code?: unknown; branch?: unknown }
    if ((data.code !== 'designated' && data.code !== 'lastIntegration') || typeof data.branch !== 'string') return null
    return { code: data.code, branch: data.branch }
  } catch {
    return null
  }
}

/** Suffixe d'une `int-*` (après `int-`) : règles communes au main et au renderer. */
export function isValidIntegrationSuffix(suffix: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(suffix) && !suffix.includes('..') && !suffix.endsWith('.lock') && !suffix.endsWith('.')
}

// ─── Branche de travail automatique (GH173, specs/GH173-design.md §2.1) ──────

/** Branche créée par l'auto-pull dès que l'intégration checkoutée a des modifications en attente. */
export const AUTO_BRANCH_PREFIX = 'dev-auto'

const AUTO_BRANCH_PATTERN = new RegExp(`^${AUTO_BRANCH_PREFIX}(-[0-9]+)?$`)

/** Noms exacts générés (`dev-auto`, `dev-auto-<n>`) — pas `dev-auto-notes` d'un utilisateur. */
export function isAutoBranch(branch: string): boolean {
  return AUTO_BRANCH_PATTERN.test(branch)
}
