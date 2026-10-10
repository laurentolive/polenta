// GH45 — forges git (GitHub, Forgejo/Gitea) : types partagés main ↔ renderer, configuration machine,
// et marqueur des erreurs d'accès (accès révoqué, droits insuffisants).

/** Type de forge d'un compte. `forgejo` couvre Forgejo et Gitea (API /api/v1 commune). */
export type ForgeKind = 'github' | 'forgejo' | 'generic'

export interface ForgeIdentity {
  login: string
  name: string
  email: string
}

/** Compte courant tel que l'UI l'affiche — jamais de jeton. */
export interface ForgeAccount extends ForgeIdentity {
  /** `${host}:${login}` — clé du TokenStore et de `defaultAccount` dans auth.json. */
  key: string
  provider: ForgeKind
  /** scheme + hôte (+ port), sans slash final. */
  baseUrl: string
  host: string
}

/**
 * Configuration « machine » déployée par la DSI (`%ProgramData%\Polenta\config.json`…), ou fournie
 * par l'exploitant du serveur web. Fichier absent → `{ hideGithub: false }` : comportement inchangé.
 */
export interface MachineConfig {
  /** Forge de l'entreprise (baseUrl normalisée), pré-sélectionnée à la connexion. */
  defaultServer?: string
  /** Masque github.com / gitlab.com et le Device Flow à la connexion. */
  hideGithub: boolean
  /** Projet de démonstration ; absent avec hideGithub → bouton Démo masqué. */
  demoProjectUrl?: string
  /** `false` : vérification des mises à jour désactivée et verrouillée. */
  autoUpdate?: false
}

/** Ce que l'écran de connexion doit proposer pour un serveur donné (`auth:detect-forge`). */
export interface ForgeDetection {
  provider: ForgeKind
  /** Forgejo ou Gitea, pour les nuances d'UI (Gitea ne signale pas la 2FA requise). */
  flavor?: 'forgejo' | 'gitea'
  baseUrl: string
}

export type PasswordLoginResult =
  | { status: 'ok'; account: ForgeAccount }
  | { status: 'otp-required' }
  | { status: 'invalid-otp' }
  /** Gitea renvoie la même réponse pour tout : mauvais mot de passe, 2FA manquante, compte désactivé. */
  | { status: 'invalid-credentials' }
  | { status: 'account-disabled' }
  /** Compte neuf (mot de passe temporaire) : à changer sur la forge avant toute connexion. */
  | { status: 'password-change-required'; url: string }
  | { status: 'not-a-forge' }
  | { status: 'network'; message: string }

// ─── Erreurs d'accès ──────────────────────────────────────────────────────────
// L'IPC Electron et le bridge web ne transmettent que `error.message` : la nature de l'erreur
// voyage dans le message, sous un marqueur que le renderer retire avant affichage.

export interface ForgeAccessIssue {
  /** 401 : accès révoqué, jeton expiré ou compte désactivé. 403 : droits insuffisants (écriture). */
  status: 401 | 403
  host: string
  /** Serveur (scheme + hôte + port) — pour pré-remplir la reconnexion. */
  serverUrl?: string
  /** Dépôt concerné (403). */
  repo?: string
}

const MARKER_START = '⟦forge-access '
const MARKER_END = '⟧ '

export function encodeForgeAccessError(issue: ForgeAccessIssue, humanMessage: string): string {
  return `${MARKER_START}${JSON.stringify(issue)}${MARKER_END}${humanMessage}`
}

/**
 * Retrouve le problème d'accès dans un message d'erreur, où qu'il soit : l'IPC Electron préfixe
 * le message (« Error invoking remote method 'sync:push': Error: … »).
 */
export function parseForgeAccessError(message: string): { issue: ForgeAccessIssue; humanMessage: string } | null {
  const start = message.indexOf(MARKER_START)
  if (start < 0) return null
  const end = message.indexOf(MARKER_END, start + MARKER_START.length)
  if (end < 0) return null
  try {
    const issue = JSON.parse(message.slice(start + MARKER_START.length, end)) as ForgeAccessIssue
    if ((issue.status !== 401 && issue.status !== 403) || typeof issue.host !== 'string') return null
    return { issue, humanMessage: message.slice(end + MARKER_END.length) }
  } catch {
    return null
  }
}
