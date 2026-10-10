/**
 * GH45 S2b — lien d'invitation `polenta://connect?server=<url>&login=<identifiant>` (spec §3ter).
 * Il ne fait que pré-remplir l'écran de connexion : jamais de connexion automatique, jamais
 * d'autre action. Tout lien non conforme est ignoré.
 */
export interface InviteLink {
  server: string
  login?: string
}

export const INVITE_SCHEME = 'polenta'

export function parseInviteLink(raw: string): InviteLink | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== `${INVITE_SCHEME}:`) return null
  // `polenta://connect?…` : selon la plateforme, « connect » arrive comme hôte ou comme chemin.
  const target = (url.hostname || url.pathname.replace(/^\/+/, '')).replace(/\/+$/, '').toLowerCase()
  if (target !== 'connect') return null
  const serverRaw = url.searchParams.get('server')
  if (!serverRaw) return null
  let server: URL
  try {
    server = new URL(serverRaw)
  } catch {
    return null
  }
  // https uniquement : un lien reçu par e-mail ne doit jamais faire saisir un mot de passe vers un
  // serveur non chiffré (revue de code S2b).
  if (server.protocol !== 'https:') return null
  if (server.username || server.password) return null
  const login = url.searchParams.get('login') ?? undefined
  if (login !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(login)) return null
  return { server: server.origin, ...(login ? { login } : {}) }
}

/** Premier argument de ligne de commande qui est un lien d'invitation valide (Windows, Linux). */
export function inviteFromArgv(argv: readonly string[]): InviteLink | null {
  for (const arg of argv) {
    if (arg.toLowerCase().startsWith(`${INVITE_SCHEME}:`)) {
      const link = parseInviteLink(arg)
      if (link) return link
    }
  }
  return null
}

let pending: InviteLink | null = null

export function setPendingInvite(link: InviteLink): void {
  pending = link
}

/** Invitation reçue avant que l'interface ne soit prête : remise une seule fois. */
export function takePendingInvite(): InviteLink | null {
  const link = pending
  pending = null
  return link
}
