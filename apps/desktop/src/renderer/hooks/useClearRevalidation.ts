import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useSelectedRepo } from '../contexts/SelectedRepoContext'
import { decodeProjectId } from '../lib/projectId'

/** Caches qui lisent le flag `needsRevalidation` (icône ⚠, matrice, maturité, couverture) ou
 *  l'état du working tree — invalidés par préfixe : l'élément levé peut vivre dans n'importe
 *  quel repo du workspace. */
const INVALIDATED_PREFIXES = [
  'revalidation:flagged',
  'objects',
  'object',
  'requirement',
  'requirements',
  'requirements-all',
  'test',
  'tests',
  'tests-all',
  'traceability-matrix',
  'impact-analysis:local',
  'widget-query-result',
  'sync:status',
]

/**
 * T173 — levée du flag `needsRevalidation` (clé retirée du YAML, pas de commit). Best-effort
 * côté main : le résultat liste les ids levés, inchangés et en échec ; l'appelant affiche les
 * échecs.
 */
export function useClearRevalidation(projectId: string) {
  const qc = useQueryClient()
  const { rootRepoPath } = useSelectedRepo()
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  return useMutation({
    mutationFn: (ids: string[]) => api.revalidation.clear(rootRepoPath, ids, workspaceDir || undefined),
    onSettled: () => {
      for (const prefix of INVALIDATED_PREFIXES) qc.invalidateQueries({ queryKey: [prefix] })
    },
  })
}
