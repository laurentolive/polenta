import { useMemo } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useOptionalTabs } from '../../contexts/TabsContext'
import { viewScrollKey } from '../system/viewScrollMemory'

/**
 * GH389 — clé de la mémoire de défilement (GH300) d'une grille de page : onglet + page + grille.
 * L'onglet enregistre la nouvelle URL un rendu après le routeur : tant que les deux diffèrent
 * (transition), pas de clé — ni restauration, ni mémorisation sous la page quittée. Hors onglets
 * (routes d'impression, widget d'un tableau de bord imprimé) : pas de clé.
 */
export function useGridScrollKey(gridId: string): string | null {
  const activeTab = useOptionalTabs()?.activeTab
  const { pathname, searchStr } = useRouterState({ select: s => ({ pathname: s.location.pathname, searchStr: s.location.searchStr }) })
  return useMemo(() => {
    if (!activeTab) return null
    const fromUrl = viewScrollKey(activeTab.id, `grid:${gridId}`, pathname, Object.fromEntries(new URLSearchParams(searchStr ?? '')))
    const fromTab = viewScrollKey(activeTab.id, `grid:${gridId}`, activeTab.pathname, activeTab.searchParams)
    return fromUrl === fromTab ? fromUrl : null
  }, [activeTab, gridId, pathname, searchStr])
}
