import { randomBytes, timingSafeEqual } from 'crypto'

export interface Session {
  id: string
  login: string
  name: string
  email: string
  /** Jeton CSRF (double-submit : cookie lisible + en-tête `X-Polenta-CSRF`). */
  csrf: string
  expiresAt: number
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

  constructor(private readonly ttlMs: number) {}

  create(identity: { login: string; name: string; email: string }): Session {
    const session: Session = {
      id: randomBytes(32).toString('base64url'),
      ...identity,
      csrf: randomBytes(24).toString('base64url'),
      expiresAt: Date.now() + this.ttlMs,
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

  /** Vrai s'il reste une session valide pour ce login (ses jetons sont alors conservés). */
  hasLogin(login: string): boolean {
    const now = Date.now()
    for (const s of this.sessions.values()) if (s.login === login && s.expiresAt > now) return true
    return false
  }
}

export function csrfMatches(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}
