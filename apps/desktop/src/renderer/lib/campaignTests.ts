import type { TestCampaign, TestCase, CampaignTestRun } from '@polenta/types'

export interface ResolvedCampaignRun {
  run: CampaignTestRun
  test: TestCase
}

/** Résout un seul `CampaignTestRun` vers son `TestCase` — même règle que
 *  `resolveCampaignRuns()` (`testSnapshot` en priorité, repli sur `testsById`), pour les sites
 *  qui affichent une entrée individuelle plutôt qu'une liste (ex. la liste de tests de
 *  `campaign.$campaignId.tsx`, ligne par ligne). Centralise la règle à un seul endroit plutôt
 *  que de la réécrire inline à chaque site de lecture. */
export function resolveRunTest(run: CampaignTestRun, testsById: Map<string, TestCase>): TestCase | undefined {
  return run.testSnapshot ?? testsById.get(run.testCaseId)
}

/** Résout chaque `CampaignTestRun` de la campagne vers son `TestCase` — `testSnapshot` en
 *  priorité (T49, fige le contenu au moment de l'inclusion), sinon repli sur l'état live du
 *  test via `tests` (entrées créées avant T49, pas de migration rétroactive). Utilisé par
 *  `campaign.$campaignId.tsx` (payload d'export), `print.campaign-plan.tsx` et
 *  `print.campaign-report.tsx` — remplace l'ancienne résolution par `testCaseId` unique
 *  (incompatible avec les instances multiples d'un même test, T97 sprint 2 : deux `runs[]`
 *  différents pouvaient se voir attribuer le même `TestCase`, perdant l'association 1:1
 *  entre une instance et son snapshot propre). Une entrée sans test résolu (source
 *  supprimée et entrée pré-T49 sans snapshot) est silencieusement omise, comme avant T49. */
export function resolveCampaignRuns(campaign: TestCampaign, tests: TestCase[]): ResolvedCampaignRun[] {
  const map = new Map(tests.map(t => [t.id, t]))
  return campaign.runs
    .map(run => ({ run, test: run.testSnapshot ?? map.get(run.testCaseId) }))
    .filter((r): r is ResolvedCampaignRun => !!r.test)
}
