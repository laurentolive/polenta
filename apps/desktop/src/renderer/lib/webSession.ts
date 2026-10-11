/**
 * GH44 — compte de la version web : celui de la session ouverte sur le serveur (le jeton forge ne
 * quitte jamais le serveur, `auth:get-token` n'y est pas exposé). Utilisé à la place de la boucle
 * « jeton enregistré → identité » du desktop.
 */
export interface WebSessionIdentity {
  login: string
  name: string
  email: string
  remote: string
}

export async function loadWebSessionIdentity(): Promise<WebSessionIdentity | null> {
  try {
    const res = await fetch('/auth/me', { credentials: 'same-origin' })
    if (!res.ok) return null
    return (await res.json()) as WebSessionIdentity
  } catch {
    return null
  }
}

/** Fin de session côté serveur ; la page de déconnexion propose de se reconnecter. */
export function webLogout(): void {
  window.location.href = '/auth/logout'
}
