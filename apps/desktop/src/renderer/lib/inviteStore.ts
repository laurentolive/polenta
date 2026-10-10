/**
 * GH45 S2b — invitation (lien `polenta://connect`) en cours : gardée jusqu'à la connexion, pour que
 * l'écran de connexion la retrouve même si une autre navigation l'a ouvert sans paramètres (au
 * premier lancement, l'accueil redirige vers /login dès qu'il constate l'absence de compte).
 */
export interface Invite {
  server: string
  login?: string
}

let current: Invite | null = null
const listeners = new Set<(invite: Invite | null) => void>()

export const inviteStore = {
  set(invite: Invite): void {
    current = invite
    for (const l of listeners) l(current)
  },
  get(): Invite | null {
    return current
  },
  clear(): void {
    if (!current) return
    current = null
    for (const l of listeners) l(null)
  },
  subscribe(listener: (invite: Invite | null) => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}
