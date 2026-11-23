import type { ExecutionHistoryRow, ValidationRow, ValidationSignedRun } from '@polenta/types'

/** Exécutions d'un test dans la vue Validation : ses runs réels, et ses entrées en attente (GH430). */
export interface TestExecutions {
  title: string
  local: boolean
  signedRun?: ValidationSignedRun
  /** Runs réels, du plus récent au plus ancien : la dernière exécution vient du premier. */
  runs: ExecutionHistoryRow[]
  /** Entrées en attente des campagnes ouvertes : listées sous le test, jamais « dernière exécution ». */
  pending: ExecutionHistoryRow[]
}

/**
 * Groupe les lignes d'historique par test, dans l'ordre des tests liés. Un test lié sans ligne reste
 * présent (« la qualité voit ce qui manque »). Validation figée : un test lié après la signature n'entre
 * pas dans le registre (GH267).
 */
export function groupExecutionsByTest(tests: ValidationRow['tests'], rows: ExecutionHistoryRow[], frozen: boolean): [string, TestExecutions][] {
  const map = new Map<string, TestExecutions>(tests.map(test => [test.id, { title: test.title, local: test.local, signedRun: test.lastRun, runs: [], pending: [] }]))
  for (const row of rows) {
    if (frozen && !map.has(row.testCaseId)) continue
    const entry = map.get(row.testCaseId) ?? { title: row.testTitle, local: true, runs: [], pending: [] }
    if (row.kind === 'pending') entry.pending.push(row)
    else entry.runs.push(row)
    map.set(row.testCaseId, entry)
  }
  return [...map.entries()]
}
