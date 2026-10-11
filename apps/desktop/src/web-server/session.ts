import { randomBytes, timingSafeEqual } from 'crypto'

export interface Session {
  id: string
  login: string
  name: string
  email: string
  /** Jeton CSRF (double-submit : cookie lisible + en-tête `X-Polenta-CSRF`). */
  csrf: string
  expiresAt: number
  /**
   * GH44 S4 — session d'impression (page headless d'un rendu) : ne compte pas comme une connexion
   * de l'utilisateur (déconnexion, vérification périodique des accès).
   */
  print?: true
}

export const SESSION_COOKIE = 'polenta_sid'
export const CSRF_COOKIE = 'polenta_csrf'
export const CSRF_HEADER = 'x-polenta-csrf'

/**
 * GH44 — sessions en mémoire (design D10) : un redémarrage du serveur impose de se reconnecter.
 * L'identifiant voyage dans un cookie signé `HttpOnly` ; rien d'autre (ni jeton forge, ni chemin)
 * n'est stocké côté navigateur.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>()
  /**
   * GH44 S3 — sessions détruites par une révocation, mémorisées 10 min : les appels encore en vol
   * (ou la reconnexion de la WebSocket) reçoivent « révoqué » et non « session expirée », pour que
   * le navigateur affiche la bonne page au lieu de relancer une connexion.
   */
  private readonly revokedIds = new Map<string, number>()

  constructor(private readonly ttlMs: number) {}

  create(identity: { login: string; name: string; email: string }): Session {
    return this.add(identity, this.ttlMs)
  }

  /** GH44 S4 — session d'un rendu headless, limitée à la durée de ce rendu. */
  createPrint(identity: { login: string; name: string; email: string }, ttlMs: number): Session {
    return this.add(identity, ttlMs, true)
  }

  private add(identity: { login: string; name: string; email: string }, ttlMs: number, print?: true): Session {
    const session: Session = {
      id: randomBytes(32).toString('base64url'),
      ...identity,
      csrf: randomBytes(24).toString('base64url'),
      expiresAt: Date.now() + ttlMs,
      ...(print ? { print } : {}),
    }
    this.sessions.set(session.id, session)
    return session
  }

  get(id: string | undefined): Session | null {
    if (!id) return null
    const session = this.sessions.get(id)
    if (!session) return null
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(id)
      return null
    }
    return session
  }

  destroy(id: string): void {
    this.sessions.delete(id)
  }

  /** GH44 S3 — accès révoqué : toutes les sessions de ce login sont détruites. */
  destroyLogin(login: string): number {
    let n = 0
    const now = Date.now()
    for (const [id, s] of this.revokedIds) if (now - s > 10 * 60_000) this.revokedIds.delete(id)
    for (const [id, s] of this.sessions) {
      if (s.login === login) {
        this.sessions.delete(id)
        this.revokedIds.set(id, now)
        n++
      }
    }
    return n
  }

  /** Vrai si cette session a été détruite par une révocation d'accès (10 dernières minutes). */
  wasRevoked(id: string | undefined): boolean {
    if (!id) return false
    const at = this.revokedIds.get(id)
    return at !== undefined && Date.now() - at <= 10 * 60_000
  }

  /** Logins ayant au moins une session valide (vérification périodique des accès). */
  activeLogins(): string[] {
    const now = Date.now()
    return [...new Set([...this.sessions.values()].filter(s => !s.print && s.expiresAt > now).map(s => s.login))]
  }

  /** Vrai s'il reste une session valide pour ce login (ses jetons sont alors conservés). */
  hasLogin(login: string): boolean {
    const now = Date.now()
    for (const s of this.sessions.values()) if (!s.print && s.login === login && s.expiresAt > now) return true
    return false
  }
}

export function csrfMatches(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const OIDC_STATE_COOKIE = 'polenta_oidc'

interface PendingAuthorization {
  codeVerifier: string
  createdAt: number
}

/**
 * GH44 S3 — autorisations OIDC en cours (entre `/auth/login` et `/auth/callback`), indexées par
 * `state` ; usage unique, 10 minutes au plus. Le `state` est aussi posé dans un cookie : le retour
 * n'est accepté que dans le navigateur qui a lancé la connexion (pas de connexion « forcée » avec
 * le code d'un autre).
 */
export class PendingAuthorizations {
  private readonly pending = new Map<string, PendingAuthorization>()

  constructor(private readonly ttlMs = 10 * 60_000) {}

  /** Plafond mémoire : `/auth/login` est public, il ne doit pas pouvoir faire grossir la table. */
  private static readonly MAX = 10_000

  create(codeVerifier: string): string {
    this.purge()
    // Au-delà du plafond, la plus ancienne autorisation en cours est abandonnée (ordre d'insertion).
    while (this.pending.size >= PendingAuthorizations.MAX) {
      const oldest = this.pending.keys().next().value
      if (oldest === undefined) break
      this.pending.delete(oldest)
    }
    const state = randomBytes(32).toString('base64url')
    this.pending.set(state, { codeVerifier, createdAt: Date.now() })
    return state
  }

  take(state: string): PendingAuthorization | null {
    const entry = this.pending.get(state)
    this.pending.delete(state)
    if (!entry || Date.now() - entry.createdAt > this.ttlMs) return null
    return entry
  }

  private purge(): void {
    const now = Date.now()
    for (const [state, e] of this.pending) if (now - e.createdAt > this.ttlMs) this.pending.delete(state)
  }
}
