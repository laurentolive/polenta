import { useQuery } from '@tanstack/react-query'
import type { ProjectSchema } from '@polenta/types'
import { api } from '../api'

/**
 * GH178 — schéma du repo à une version git (`ref`), pour afficher un objet de cette version.
 * `ref === null` : pas de lecture à une ref (working tree) — l'appelant utilise le schéma courant.
 * Un commit est immuable : jamais périmé.
 */
export function useSchemaAt(repoPath: string, ref: string | null | undefined) {
  return useQuery<ProjectSchema | null>({
    queryKey: ['schema-at', repoPath, ref],
    queryFn: () => api.schema.getAt(repoPath, ref!),
    enabled: !!repoPath && !!ref,
    staleTime: Infinity,
  })
}
