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

/** Cookie et en-tête CSRF du serveur web (double-submit, `web-server/session.ts`). */
export const CSRF_COOKIE_NAME = 'polenta_csrf'
export const CSRF_HEADER_NAME = 'X-Polenta-CSRF'

export function csrfToken(): string {
  const match = document.cookie.split('; ').find(c => c.startsWith(`${CSRF_COOKIE_NAME}=`))
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE_NAME.length + 1)) : ''
}

/**
 * Fin de session côté serveur (`POST`, avec le jeton CSRF : une autre page ne peut pas déconnecter
 * l'utilisateur), puis page de déconnexion qui propose de se reconnecter.
 */
export async function webLogout(): Promise<void> {
  try {
    await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { [CSRF_HEADER_NAME]: csrfToken() },
    })
  } catch {
    // Serveur injoignable : la page de déconnexion le dira au prochain chargement.
  } finally {
    window.location.href = '/auth/logged-out'
  }
}
