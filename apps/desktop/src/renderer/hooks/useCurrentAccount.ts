import { useCallback, useEffect, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { ForgeKind } from '@polenta/types'
import { api } from '../api'
import { isWeb } from '../platform'
import { loadWebSessionIdentity, webLogout } from '../lib/webSession'
import { decodeProjectId } from '../lib/projectId'

export interface CurrentAccount {
  login: string
  name: string
  email: string
  /** URL du serveur (affichage). */
  remote: string
  /** Absent sur le web (compte = session). */
  provider?: ForgeKind
  /** GH343 — desktop : clé `<hôte>:<login>` (déconnexion de ce compte-là). */
  key?: string
}

/**
 * GH45 — compte courant : desktop → `auth:current-account` (auth.json, sans réseau ni liste d'hôtes
 * en dur) ; web (GH44) → la session serveur. Remplace les boucles `KNOWN_REMOTES` d'AccountMenu,
 * AccountPanel et de la page Compte.
 *
 * GH343 — desktop, fenêtre sur un projet : le compte de la forge de ce projet (celui qu'utilisent
 * déjà git et la synchronisation), sinon le compte par défaut. Deux fenêtres sur deux projets de
 * forges différentes montrent chacune le sien.
 */
export function useCurrentAccount(): { account: CurrentAccount | null; loading: boolean; logout: () => Promise<void> } {
  const qc = useQueryClient()
  const projectId = useRouterState({ select: s => new URLSearchParams(s.location.searchStr).get('projectId') })
  const [account, setAccount] = useState<CurrentAccount | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function remoteOfProject(): Promise<string | undefined> {
      if (!projectId) return undefined
      // Même requête que le panneau Projet : déjà en cache la plupart du temps.
      const project = await qc.fetchQuery({
        queryKey: ['workspace', projectId],
        queryFn: () => api.workspace.resolve(decodeProjectId(projectId)),
      }).catch(() => null)
      return project?.remoteUrl ?? undefined
    }
    async function load(): Promise<CurrentAccount | null> {
      if (isWeb) return loadWebSessionIdentity()
      const current = await api.auth.currentAccount(await remoteOfProject()).catch(() => null)
      return current
        ? { login: current.login, name: current.name, email: current.email, remote: current.baseUrl, provider: current.provider, key: current.key }
        : null
    }
    void load().then(a => {
      if (cancelled) return
      setAccount(a)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [projectId, qc])

  const key = account?.key
  const logout = useCallback(async () => {
    if (isWeb) return webLogout()
    try {
      await api.auth.logout(key)
      // GH45 S2b — plus de compte : la configuration de l'équipe ne s'applique plus.
      await api.app.refreshTeamConfig()
    } catch {
      // best-effort : l'écran de connexion s'affiche quoi qu'il en soit
    }
    setAccount(null)
  }, [key])

  return { account, loading, logout }
}
