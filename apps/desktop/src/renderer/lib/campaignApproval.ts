import type { CampaignTestRun, TestCase } from '@polenta/types'

// GH68 — tests non approuvés dans une campagne. Logique pure (sans React ni schéma) : le statut
// d'approbation est fourni par l'appelant (`isTestApproved` de useProjectSchema).

export type IsApproved = (test: TestCase) => boolean

/** Instance dont la copie sera resynchronisée à l'ouverture de l'exécution (même règle que
 *  `CampaignsService.refreshEntries` côté main) : pending, avec copie, copie non approuvée. */
export function isResyncable(run: CampaignTestRun, isApproved: IsApproved): boolean {
  return run.status === 'pending' && !!run.testSnapshot && !isApproved(run.testSnapshot)
}

/** Test dont on juge l'approbation pour une instance : l'état live tant que l'instance est
 *  resynchronisable (c'est lui qui sera exécuté), sinon la copie figée (repli live pour une
 *  entrée pré-T49). */
export function approvalSubject(run: CampaignTestRun, live: TestCase | undefined, isApproved: IsApproved): TestCase | undefined {
  if (isResyncable(run, isApproved)) return live ?? run.testSnapshot
  return run.testSnapshot ?? live
}

/** Test non approuvé à signaler sur l'instance (badge), sinon `undefined`. */
export function unapprovedTestOf(run: CampaignTestRun, live: TestCase | undefined, isApproved: IsApproved): TestCase | undefined {
  const subject = approvalSubject(run, live, isApproved)
  return subject && !isApproved(subject) ? subject : undefined
}

/** Instances à exécuter (pending) portant sur un test non approuvé — bandeau de la campagne. */
export function unapprovedPendingRuns(runs: CampaignTestRun[], liveById: Map<string, TestCase>, isApproved: IsApproved): CampaignTestRun[] {
  return runs.filter(r => r.status === 'pending' && !!unapprovedTestOf(r, liveById.get(r.testCaseId), isApproved))
}
