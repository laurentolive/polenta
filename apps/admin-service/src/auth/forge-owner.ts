/**
 * GH63 — revérification du droit « propriétaire » auprès de la forge de l'instance d'origine (design
 * D4, §5.2 (3)) avec le jeton de l'utilisateur : l'identité vient de `GET /api/v1/user` (le login
 * annoncé par le web-server n'est pas cru), le droit de `…/orgs/{org}/permissions`, champ `is_owner`
 * seul. Cache 60 s, contourné pour toute opération destructive. Le jeton n'est jamais conservé :
 * seule son empreinte sert de clé de cache.
 */
import { fingerprint } from './service-token'

export type OwnerCheck =
  | { ok: true; login: string }
  | { ok: false; status: 401 | 403 | 502; reason: string }

export interface ForgeOwnerOptions {
  /** Adresse de la forge de l'instance (ex. http://forgejo-acme:3000). */
  forgeUrl: (instance: string) => string
  cacheMs: number
  fetchImpl?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export class ForgeOwnerChecker {
  private readonly cache = new Map<string, { at: number; result: OwnerCheck }>()
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number

  constructor(private readonly opts: ForgeOwnerOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.now = opts.now ?? Date.now
  }

  async check(args: {
    instance: string
    org: string
    userToken: string
    announcedLogin?: string
    noCache?: boolean
  }): Promise<OwnerCheck> {
    const key = `${args.instance}:${args.org}:${fingerprint(args.userToken)}`
    const cached = this.cache.get(key)
    let result: OwnerCheck
    if (!args.noCache && cached && this.now() - cached.at < this.opts.cacheMs) {
      result = cached.result
    } else {
      result = await this.query(args.instance, args.org, args.userToken)
      // Un refus de la forge injoignable (502) n'est pas mis en cache.
      if (result.ok || result.status !== 502) this.cache.set(key, { at: this.now(), result })
      else this.cache.delete(key)
    }
    if (result.ok && args.announcedLogin && args.announcedLogin.toLowerCase() !== result.login.toLowerCase()) {
      return { ok: false, status: 403, reason: 'actor-mismatch' }
    }
    return result
  }

  private async get(url: string, token: string): Promise<{ status: number; body: unknown } | null> {
    try {
      const res = await this.fetchImpl(url, {
        headers: { Authorization: `token ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      })
      let body: unknown = null
      try {
        body = await res.json()
      } catch {
        body = null
      }
      return { status: res.status, body }
    } catch {
      return null
    }
  }

  private async query(instance: string, org: string, token: string): Promise<OwnerCheck> {
    const base = this.opts.forgeUrl(instance).replace(/\/+$/, '')
    const me = await this.get(`${base}/api/v1/user`, token)
    if (!me) return { ok: false, status: 502, reason: 'forge-unreachable' }
    if (me.status === 401 || me.status === 403) return { ok: false, status: 401, reason: 'user-token-invalid' }
    const login = (me.body as { login?: unknown } | null)?.login
    if (me.status !== 200 || typeof login !== 'string' || !login) {
      return { ok: false, status: 502, reason: 'forge-error' }
    }
    const perm = await this.get(
      `${base}/api/v1/users/${encodeURIComponent(login)}/orgs/${encodeURIComponent(org)}/permissions`,
      token,
    )
    if (!perm) return { ok: false, status: 502, reason: 'forge-unreachable' }
    if (perm.status === 401) return { ok: false, status: 401, reason: 'user-token-invalid' }
    if (perm.status === 403 || perm.status === 404) return { ok: false, status: 403, reason: 'not-owner' }
    if (perm.status !== 200) return { ok: false, status: 502, reason: 'forge-error' }
    if ((perm.body as { is_owner?: unknown } | null)?.is_owner !== true) {
      return { ok: false, status: 403, reason: 'not-owner' }
    }
    return { ok: true, login }
  }
}
