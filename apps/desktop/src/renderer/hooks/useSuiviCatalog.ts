import { useQuery } from '@tanstack/react-query'
import type { SuiviObjectTypeOption } from '@polenta/api-client'
import { api } from '../api'

/**
 * GH74 — catalogue de la vue Suivi pour les formulaires de modèles : modèles (statiques, livrés par
 * l'application), types d'objet du périmètre et leurs champs, campagnes.
 */

export function useSuiviTemplates() {
  return useQuery({ queryKey: ['suivi-templates'], queryFn: () => api.suivi.templates(), staleTime: Infinity })
}

export function useSuiviObjectTypes(repoPath: string, workspaceDir: string) {
  return useQuery({
    queryKey: ['suivi-object-types', repoPath, workspaceDir],
    queryFn: () => api.suivi.objectTypes(repoPath, workspaceDir),
    enabled: !!repoPath,
  })
}

export function useCampaignOptions(repoPath: string) {
  return useQuery({
    queryKey: ['campaigns', repoPath, 'suivi-options'],
    queryFn: async () => (await api.campaigns.list(repoPath)).map((c) => ({ id: c.id, title: c.title, status: c.status })),
    enabled: !!repoPath,
  })
}

/** Champs filtrables du modèle « Liste filtrée » : ceux du type choisi, sinon de toute la catégorie. */
export function filteredListFields(params: Record<string, unknown>, objectTypes: SuiviObjectTypeOption[]): string[] {
  const ref = params.objectTypeRef as string | undefined
  if (ref) {
    const t = objectTypes.find((o) => o.objectTypeRef === ref && (!params.component || o.component === params.component))
    return t?.fields ?? []
  }
  const category = (params.category as string | undefined) ?? 'requirement'
  return [...new Set(objectTypes.filter((o) => o.category === category).flatMap((o) => o.fields))]
}
