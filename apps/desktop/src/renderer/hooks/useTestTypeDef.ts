import { useQuery } from '@tanstack/react-query'
import type { ObjectTypeDefinition } from '@polenta/types'
import { api } from '../api'

/**
 * GH196 — type d'un test, lu par le main dans le repo du test (schéma d'un composant compris) :
 * champs d'exécution / d'étape de la page d'exécution et de la consultation d'un run.
 */
export function useTestTypeDef(repoPath: string, objectTypeRef: string | undefined, workspaceDir?: string) {
  return useQuery<ObjectTypeDefinition | null>({
    queryKey: ['test-type-def', repoPath, objectTypeRef, workspaceDir ?? null],
    queryFn: () => api.tests.typeDef(repoPath, objectTypeRef!, workspaceDir),
    enabled: !!repoPath && !!objectTypeRef,
    staleTime: 60_000,
  })
}
