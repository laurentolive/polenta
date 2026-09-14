import { useQuery } from '@tanstack/react-query'
import type { Requirement, TestCase } from '@polenta/types'
import { api } from '../api'

/** Liste brute des objets (exigences ou tests) d'un couple (nœud, type) du schéma.
 *
 *  Extrait de `SystemView` (T166) pour que le panneau latéral (`SystemPanel`) puisse fouiller
 *  les valeurs de champs dans le filtre de l'arbre sans dupliquer la query : même `queryKey`
 *  `['objects', repoPath, category, nodeId, typeId]` ⇒ React Query mutualise le fetch et les
 *  invalidations déjà câblées dans `SystemView`. */
export function useSystemObjects(
  repoPath: string,
  category: string | undefined,
  nodeId: string,
  typeId: string,
) {
  return useQuery({
    queryKey: ['objects', repoPath, category, nodeId, typeId],
    queryFn: async (): Promise<(Requirement | TestCase)[]> => {
      if (!repoPath || !category || !nodeId || !typeId) return []
      const ref = `${nodeId}::${typeId}`
      if (category === 'requirement') {
        const all = await api.requirements.list(repoPath, {})
        return all.filter(r => r.objectTypeRef === ref)
      }
      if (category === 'test') {
        const all = await api.tests.list(repoPath)
        return all.filter(t => t.objectTypeRef === ref)
      }
      return []
    },
    enabled: !!repoPath && !!category && !!nodeId && !!typeId,
  })
}
