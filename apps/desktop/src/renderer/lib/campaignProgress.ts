import type { CampaignTestRun, TestCase } from '@polenta/types'
import { compareProgressKeys, entryProgress, progressSubject } from '@polenta/types'
import type { IsApproved } from './campaignApproval'

// GH71 — étapes d'avancement sur la page campagne (pastilles, filtre `progress`). Logique pure ;
// la règle elle-même est partagée avec le main (`@polenta/types/campaign-progress`).


/** Étape d'une entrée de la campagne. */
export function runProgress(run: CampaignTestRun, live: TestCase | undefined, campaignOpen: boolean, isApproved: IsApproved): string {
  return entryProgress(run, progressSubject(run, live, campaignOpen, isApproved), isApproved)
}

/** Pastilles dans l'ordre canonique : étapes présentes (et l'étape filtrée, même vide). */
export function progressPills(
  runs: CampaignTestRun[],
  progressOf: (run: CampaignTestRun) => string,
  order: Map<string, number>,
  active?: string,
): { key: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const r of runs) {
    const k = progressOf(r)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  if (active && !counts.has(active)) counts.set(active, 0)
  return [...counts.keys()].sort(compareProgressKeys(order)).map(key => ({ key, count: counts.get(key)! }))
}
