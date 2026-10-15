import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { withoutHistory } from '@polenta/types'
import { api } from '../api'
import type { TestCase } from '@polenta/types'

/** Résout le `TestCase` affiché/exécuté pour une entrée de campagne — `testSnapshot` en
 *  priorité (T49, fige le contenu au moment de l'inclusion), sinon repli sur un fetch live
 *  (entrées créées avant T49, pas de migration rétroactive). Partagé par la page d'exécution
 *  (`campaign.$campaignId.execute.$testId.tsx`) et la page de relecture d'un run
 *  (`campaign.$campaignId.run.$testId.tsx`), qui appliquaient auparavant la même logique en
 *  double. Le fetch live n'est déclenché que si `snapshot` est absent, ou si `live` est demandé.
 *
 *  GH81 — `live` (instance resynchronisable, GH68) : l'état actuel du test (sans `history`) prime
 *  sur la copie, relu à l'ouverture (pas de version en cache) ; la copie reste le repli si le test
 *  est introuvable. Rien n'est écrit : la version affichée n'est figée qu'à la saisie. */
export function useResolvedCampaignTest(
  repoPath: string,
  testCaseId: string | undefined,
  snapshot: TestCase | undefined,
  opts?: { live?: boolean },
) {
  const live = !!opts?.live && !!snapshot
  const { data: liveTestCase, isLoading, isFetching, isFetchedAfterMount, isError } = useQuery({
    queryKey: ['test', repoPath, testCaseId],
    queryFn: () => api.tests.get(repoPath, testCaseId!),
    enabled: !!repoPath && !!testCaseId && (live || !snapshot),
    ...(live && { refetchOnMount: 'always' as const }),
  })
  const liveContent = useMemo(() => (liveTestCase ? (withoutHistory(liveTestCase) as TestCase) : undefined), [liveTestCase])
  if (live) {
    // Relecture en échec : une version en cache peut être périmée — repli sur la copie.
    return { testCase: (!isError && liveContent) || snapshot, isLoading: isLoading || (isFetching && !isFetchedAfterMount) }
  }
  return { testCase: snapshot ?? liveTestCase, isLoading }
}
