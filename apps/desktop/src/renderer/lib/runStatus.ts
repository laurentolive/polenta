import type { TestRunStatus } from '@polenta/types'
import { RUN_STATUS_SEVERITY } from '@polenta/types'

export { RUN_STATUS_SEVERITY }

/**
 * Statuts d'une entrée de campagne (`TestRunStatus`) : libellés, pastilles et gravité. Partagé par
 * la page campagne, son impression et le widget matrice de la vue Suivi (GH69).
 */

export const RUN_STATUS_LABEL_KEY: Record<TestRunStatus, string> = {
  pending:    'campaignPage.runStatus.pending',
  PASS:       'campaignPage.runStatus.pass',
  FAIL:       'campaignPage.runStatus.fail',
  BLOCKED:    'campaignPage.runStatus.blocked',
  INCOMPLETE: 'campaignPage.runStatus.incomplete',
}

export const RUN_STATUS_CLASS: Record<TestRunStatus, string> = {
  pending:    'bg-status-neutral-bg text-status-neutral',
  PASS:       'bg-status-success-bg text-status-success',
  FAIL:       'bg-status-danger-bg text-status-danger',
  BLOCKED:    'bg-status-warning-bg text-status-warning',
  INCOMPLETE: 'bg-status-warning-bg text-status-warning',
}

export function isTestRunStatus(v: unknown): v is TestRunStatus {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(RUN_STATUS_SEVERITY, v)
}

/** Pire statut d'une liste non vide (`PASS` pour une liste vide, jamais appelée ainsi). */
export function worstRunStatus(statuses: TestRunStatus[]): TestRunStatus {
  return statuses.reduce<TestRunStatus>((worst, s) => (RUN_STATUS_SEVERITY[s] > RUN_STATUS_SEVERITY[worst] ? s : worst), 'PASS')
}
