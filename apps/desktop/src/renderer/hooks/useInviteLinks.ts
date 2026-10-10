import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api } from '../api'
import { isWeb } from '../platform'
import { inviteStore, type Invite } from '../lib/inviteStore'

/**
 * GH45 S2b — lien d'invitation `polenta://connect?…` (spec §3ter) : ouvre l'écran de connexion avec
 * le serveur et l'identifiant pré-remplis — jamais de connexion automatique. Déjà connecté au même
 * serveur avec le même identifiant : simplement l'accueil. Desktop uniquement.
 */
export function useInviteLinks(): void {
  const navigate = useNavigate()

  useEffect(() => {
    if (isWeb) return
    const handle = async (invite: Invite | null) => {
      if (!invite) return
      const current = await api.auth.currentAccount().catch(() => null)
      const sameAccount = current
        && new URL(current.baseUrl).origin === new URL(invite.server).origin
        && (!invite.login || current.login.toLowerCase() === invite.login.toLowerCase())
      if (sameAccount) {
        await navigate({ to: '/' })
        return
      }
      inviteStore.set(invite)
      await navigate({ to: '/login', search: { server: invite.server, ...(invite.login ? { login: invite.login } : {}) } })
    }
    void api.app.takePendingInvite().then(handle).catch(() => {})
    const off = window.polenta.on('app:invite', (...args: unknown[]) => {
      // L'invitation est aussi conservée côté main : la prendre évite de la rejouer au rechargement.
      void api.app.takePendingInvite().catch(() => null)
      void handle(args[0] as Invite)
    })
    return off
  }, [navigate])
}
