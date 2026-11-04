import type { ExecutionHistoryRow, TestedConfigNode } from '@polenta/types'

/** GH204 §7 — mentions d'une exécution dans la vue Validation. */
export type RunMention = 'other_version' | 'no_version' | 'evolved' | 'after_signature'

function containsVersion(node: TestedConfigNode, versionId: string): boolean {
  return node.ref === versionId || Object.values(node.components ?? {}).some(child => containsVersion(child, versionId))
}

/**
 * `other_version` : la version validée n'est ni la version testée ni dans sa structure figée ; une
 * exécution sur le produit qui contient cette version de composant la vérifie donc bien.
 */
export function runMentions(row: Pick<ExecutionHistoryRow, 'run' | 'testedDrift'>, versionId: string, signedAt: string | null): RunMention[] {
  const run = row.run
  if (!run) return []
  const out: RunMention[] = []
  if (!run.testedConfig) out.push('no_version')
  else if (!containsVersion(run.testedConfig, versionId)) out.push('other_version')
  if (row.testedDrift?.length) out.push('evolved')
  if (signedAt && new Date(run.executedAt).getTime() > new Date(signedAt).getTime()) out.push('after_signature')
  return out
}
