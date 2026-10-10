import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { TeamConfigStatus } from '@polenta/types'
import { api } from '../api'
import i18n, { LOCALE_STORAGE_KEY } from '../i18n'
import { useTheme } from '../contexts/ThemeContext'

const REFRESH_MS = 30 * 60 * 1000
export const TEAM_CONFIG_KEY = ['team-config'] as const

/** GH45 S2b — configuration par équipe (cache du process main ; rafraîchie par TeamConfigEffects). */
export function useTeamConfig(): TeamConfigStatus | undefined {
  return useQuery({ queryKey: TEAM_CONFIG_KEY, queryFn: () => api.app.getTeamConfig(), staleTime: Infinity }).data
}

/** Relit la configuration sur la forge (après une connexion) et met le cache à jour. */
export async function refreshTeamConfig(qc: ReturnType<typeof useQueryClient>): Promise<void> {
  const status = await api.app.refreshTeamConfig().catch(() => null)
  if (status) qc.setQueryData(TEAM_CONFIG_KEY, status)
}

/**
 * GH45 S2b (spec §3bis-5/8) — monté une fois à la racine :
 * - rafraîchit la configuration au démarrage puis toutes les 30 minutes ;
 * - applique langue et thème par défaut de l'équipe **sans les enregistrer**, et seulement si
 *   l'utilisateur n'a pas déjà fait son propre choix.
 */
export function useTeamConfigEffects(enabled: boolean): void {
  const qc = useQueryClient()
  const status = useTeamConfig()
  const { applyDefault } = useTheme()

  useEffect(() => {
    if (!enabled) return
    void refreshTeamConfig(qc)
    const id = setInterval(() => void refreshTeamConfig(qc), REFRESH_MS)
    const off = window.polenta?.on?.('app:team-config-changed', (...args: unknown[]) => {
      qc.setQueryData(TEAM_CONFIG_KEY, args[0] as TeamConfigStatus)
    })
    return () => { clearInterval(id); off?.() }
  }, [enabled, qc])

  const language = status?.config?.preferences.language
  const theme = status?.config?.preferences.theme
  // Défauts appliqués par l'équipe : à rétablir s'ils disparaissent (déconnexion, autre compte ou
  // autre équipe, clé retirée du fichier).
  const appliedLanguage = useRef(false)
  const appliedTheme = useRef(false)
  useEffect(() => {
    if (!enabled) return
    let personal: string | null = null
    try { personal = localStorage.getItem(LOCALE_STORAGE_KEY) } catch { /* stockage indisponible */ }
    if (personal) return
    if (language) {
      appliedLanguage.current = true
      if (i18n.language !== language) void i18n.changeLanguage(language)
    } else if (appliedLanguage.current) {
      appliedLanguage.current = false
      void i18n.changeLanguage('fr')
    }
  }, [enabled, language])
  useEffect(() => {
    if (!enabled) return
    if (theme) {
      appliedTheme.current = true
      applyDefault(theme)
    } else if (appliedTheme.current) {
      appliedTheme.current = false
      applyDefault(null)
    }
  }, [enabled, theme, applyDefault])
}
