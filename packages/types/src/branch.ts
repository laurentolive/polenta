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
