import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { TestCase } from '@polenta/types'

/** Résout le `TestCase` affiché/exécuté pour une entrée de campagne — `testSnapshot` en
 *  priorité (T49, fige le contenu au moment de l'inclusion), sinon repli sur un fetch live
 *  (entrées créées avant T49, pas de migration rétroactive). Partagé par la page d'exécution
 *  (`campaign.$campaignId.execute.$testId.tsx`) et la page de relecture d'un run
 *  (`campaign.$campaignId.run.$testId.tsx`), qui appliquaient auparavant la même logique en
 *  double. Le fetch live n'est déclenché que si `snapshot` est absent. */
export function useResolvedCampaignTest(repoPath: string, testCaseId: string | undefined, snapshot: TestCase | undefined) {
  const { data: liveTestCase, isLoading } = useQuery({
    queryKey: ['test', repoPath, testCaseId],
    queryFn: () => api.tests.get(repoPath, testCaseId!),
    enabled: !!repoPath && !!testCaseId && !snapshot,
  })
  return { testCase: snapshot ?? liveTestCase, isLoading }
}
