import type { CampaignTestRun, TestCase } from '@polenta/types'
import { progressSubject } from '@polenta/types'

// GH68 — tests non approuvés dans une campagne. Logique pure (sans React ni schéma) : le statut
// d'approbation est fourni par l'appelant (`isTestApproved` de useProjectSchema). Le test jugé suit
// la règle partagée `progressSubject` (GH71) : état live tant que l'instance est resynchronisable
// dans une campagne ouverte, sinon la copie figée.

export type IsApproved = (test: TestCase) => boolean

/** Test non approuvé à signaler sur l'instance (badge), sinon `undefined`. */
export function unapprovedTestOf(
  run: CampaignTestRun, live: TestCase | undefined, campaignOpen: boolean, isApproved: IsApproved,
): TestCase | undefined {
  const subject = progressSubject(run, live, campaignOpen, isApproved)
  return subject && !isApproved(subject) ? subject : undefined
}

/** Instances à exécuter (pending) portant sur un test non approuvé — bandeau de la campagne. */
export function unapprovedPendingRuns(
  runs: CampaignTestRun[], liveById: Map<string, TestCase>, campaignOpen: boolean, isApproved: IsApproved,
): CampaignTestRun[] {
  return runs.filter(r => r.status === 'pending' && !!unapprovedTestOf(r, liveById.get(r.testCaseId), campaignOpen, isApproved))
}

/** Report d'une entrée (GH64) : la nouvelle instance copie l'état actuel du test — c'est lui qui
 *  est signalé s'il n'est pas approuvé, sinon `undefined`. */
export function unapprovedCarriedTest(live: TestCase | undefined, isApproved: IsApproved): TestCase | undefined {
  return live && !isApproved(live) ? live : undefined
}
