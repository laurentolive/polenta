import { useCallback, useEffect, useState } from 'react'
import type { ForgeKind } from '@polenta/types'
import { api } from '../api'
import { isWeb } from '../platform'
import { loadWebSessionIdentity, webLogout } from '../lib/webSession'

export interface CurrentAccount {
  login: string
  name: string
  email: string
  /** URL du serveur (affichage). */
  remote: string
  /** Absent sur le web (compte = session). */
  provider?: ForgeKind
}

/**
 * GH45 — compte courant : desktop → `auth:current-account` (auth.json, sans réseau ni liste d'hôtes
 * en dur) ; web (GH44) → la session serveur. Remplace les boucles `KNOWN_REMOTES` d'AccountMenu,
 * AccountPanel et de la page Compte.
 */
export function useCurrentAccount(): { account: CurrentAccount | null; loading: boolean; logout: () => Promise<void> } {
  const [account, setAccount] = useState<CurrentAccount | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<CurrentAccount | null> {
      if (isWeb) return loadWebSessionIdentity()
      const current = await api.auth.currentAccount().catch(() => null)
      return current
        ? { login: current.login, name: current.name, email: current.email, remote: current.baseUrl, provider: current.provider }
        : null
    }
    void load().then(a => {
      if (cancelled) return
      setAccount(a)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const logout = useCallback(async () => {
    if (isWeb) return webLogout()
    try {
      await api.auth.logout()
    } catch {
      // best-effort : l'écran de connexion s'affiche quoi qu'il en soit
    }
    setAccount(null)
  }, [])

  return { account, loading, logout }
}
