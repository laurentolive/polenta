import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useSelectedRepo } from '../contexts/SelectedRepoContext'
import { decodeProjectId } from '../lib/projectId'

/**
 * T175 — analyse d'impact live des modifications locales (vs HEAD), sur tout le workspace :
 * toujours enracinée sur le repo racine, quel que soit le repo sélectionné. Partagée par le
 * panneau Analyse d'impact et la page (`react-query` déduplique). Recalculée quand
 * `useLiveFileSync` invalide la clé (fichier élément/lien ou ref modifié dans n'importe quel
 * repo), au retour du focus, ou via `refetch()` (bouton Rafraîchir).
 */
export function useLocalImpactAnalysis(projectId: string) {
  const { rootRepoPath } = useSelectedRepo()
  const workspaceDir = projectId ? decodeProjectId(projectId) : ''
  return useQuery({
    queryKey: ['impact-analysis:local', rootRepoPath, workspaceDir],
    queryFn: () => api.impactAnalysis.local(rootRepoPath, workspaceDir || undefined),
    enabled: !!rootRepoPath,
    refetchOnWindowFocus: true,
  })
}
