import { useQuery } from '@tanstack/react-query'
import type { CampaignEntryRequirements, TestCampaign } from '@polenta/types'
import { api } from '../api'

/**
 * GH442 — exigences affichées de chaque entrée d'une campagne (exigence de l'instance, sinon exigences
 * couvertes par le test) : colonne « Exigence » de la grille. Calculées par le main, comme pour les
 * exports. Relues à chaque retour sur la page (liens et exigences changent ailleurs) et quand les
 * entrées de la campagne changent ; la valeur précédente reste affichée pendant la relecture.
 */
export function useEntryRequirements(repoPath: string, campaign: TestCampaign | undefined, workspaceDir: string | undefined) {
  const entries = (campaign?.runs ?? []).map(r => r.entryId).join('|')
  return useQuery<CampaignEntryRequirements>({
    queryKey: ['campaign-entry-requirements', repoPath, campaign?.id ?? null, workspaceDir ?? null, entries],
    queryFn: () => api.campaigns.entryRequirements(repoPath, campaign!.id, workspaceDir),
    enabled: !!repoPath && !!campaign,
    staleTime: 0,
    // Pas de relecture à chaque retour de focus de la fenêtre : chaque lecture parcourt exigences et liens
    // de tout le workspace ; le retour sur la page suffit (montage).
    refetchOnWindowFocus: false,
    // Valeur précédente gardée seulement pour la même campagne : des `entryId` identiques existent d'une
    // campagne à l'autre, la grille ne doit pas afficher brièvement les exigences de l'autre.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === repoPath && previousQuery.queryKey[2] === campaign?.id ? previous : undefined,
  })
}
