import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TRANSITION_CATEGORIES } from '@polenta/types'
import type { ObjectCategory, TransitionCheck } from '@polenta/types'
import { api } from '../api'

/**
 * GH206 — contexte des menus de statut : repo, catégorie et workspace des objets affichés. Posé par la
 * vue (Tableau, Document, Édition) ou la page d'un objet ; absent = pas de pré-contrôle.
 */
export interface TransitionScope {
  repoPath: string
  category: ObjectCategory | undefined
  workspaceDir?: string
}

export const TransitionScopeContext = createContext<TransitionScope | null>(null)

/** Clé des pré-contrôles d'un repo : invalidée après toute écriture d'objet ou de lien. */
export const transitionPreviewKey = (repoPath: string, objectId?: string) =>
  objectId ? ['transitions', repoPath, objectId] : ['transitions', repoPath]

/**
 * GH206 — pré-contrôle des passages de statut d'un objet (`transitions:preview`) : un résultat par
 * statut d'arrivée. `enabled` : à charger seulement à l'ouverture du menu (listes longues). `scopeOverride` :
 * page d'un objet, sans contexte posé par une vue.
 */
export function useTransitionPreview(objectId: string | undefined, enabled = true, scopeOverride?: TransitionScope) {
  const context = useContext(TransitionScopeContext)
  const scope = scopeOverride ?? context
  const category = scope?.category
  const active = !!scope?.repoPath && !!objectId && enabled && !!category && TRANSITION_CATEGORIES.includes(category)
  return useQuery<Record<string, TransitionCheck>>({
    queryKey: [...transitionPreviewKey(scope?.repoPath ?? '', objectId), scope?.workspaceDir ?? null],
    queryFn: () => api.transitions.preview(scope!.repoPath, category as 'requirement' | 'test' | 'issue', objectId!, scope?.workspaceDir),
    enabled: active,
    staleTime: 0,
  })
}
