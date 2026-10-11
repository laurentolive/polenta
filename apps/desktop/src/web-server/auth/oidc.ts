import { createHash, randomBytes } from 'crypto'
import { checkRemote } from '../../main/services/forge/remote-guard'

/**
 * GH44 S3 — client OAuth2/OIDC minimal pour la forge Forgejo/Gitea de l'instance (design §5.1,
 * révisé §10.2) : Authorization Code + PKCE (S256), client confidentiel.
 *
 * L'`id_token` n'est pas exploité : les jetons viennent directement du point d'échange de la forge,
 * en TLS et avec authentification du client, et l'identité est relue par l'API de la forge
 * (`GET /api/v1/user`) avec le jeton obtenu — la même que pour le desktop. Aucune bibliothèque JWT
 * n'est donc nécessaire.
 */
export interface OidcEndpoints {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
}

export interface OidcTokens {
  accessToken: string
  refreshToken?: string
  /** Horodatage (ms) d'expiration du jeton d'accès ; absent si la forge n'en donne pas. */
  expiresAt?: number
}

/** Réponse refusée par le point d'échange (code invalide, refresh_token révoqué…). */
export class OidcTokenError extends Error {
  constructor(readonly status: number, readonly oauthError: string) {
    super(`Échange de jeton refusé par la forge (${status}${oauthError ? ` ${oauthError}` : ''})`)
    this.name = 'OidcTokenError'
  }
}

const SCOPES = 'openid profile email'

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export class OidcClient {
  private endpoints: Promise<OidcEndpoints> | null = null

  constructor(
    readonly forgeUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    readonly redirectUri: string,
  ) {}

  /** Découverte (`/.well-known/openid-configuration`), mise en cache ; l'émetteur doit être la forge. */
  discover(): Promise<OidcEndpoints> {
    this.endpoints ??= this.fetchEndpoints().catch(err => {
      this.endpoints = null // nouvelle tentative au prochain appel
      throw err
    })
    return this.endpoints
  }

  private async fetchEndpoints(): Promise<OidcEndpoints> {
    const url = `${this.forgeUrl}/.well-known/openid-configuration`
    checkRemote(url)
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`Découverte OIDC impossible sur ${this.forgeUrl} (${res.status})`)
    const doc = (await res.json()) as Record<string, unknown>
    const issuer = String(doc['issuer'] ?? '').replace(/\/$/, '')
    if (issuer !== this.forgeUrl) throw new Error(`Émetteur OIDC inattendu : ${issuer} (attendu ${this.forgeUrl})`)
    const authorizationEndpoint = String(doc['authorization_endpoint'] ?? '')
    const tokenEndpoint = String(doc['token_endpoint'] ?? '')
    // Les points d'accès doivent rester sur la forge (jamais un autre hôte, cf. garde des hôtes).
    for (const ep of [authorizationEndpoint, tokenEndpoint]) {
      if (new URL(ep).origin !== this.forgeUrl) throw new Error(`Point d'accès OIDC hors de la forge : ${ep}`)
    }
    return { issuer, authorizationEndpoint, tokenEndpoint }
  }

  async authorizationUrl(state: string, codeChallenge: string): Promise<string> {
    const { authorizationEndpoint } = await this.discover()
    const url = new URL(authorizationEndpoint)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString()
    return url.toString()
  }

  exchangeCode(code: string, codeVerifier: string): Promise<OidcTokens> {
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: codeVerifier })
  }

  refresh(refreshToken: string): Promise<OidcTokens> {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  private async tokenRequest(params: Record<string, string>): Promise<OidcTokens> {
    const { tokenEndpoint } = await this.discover()
    checkRemote(tokenEndpoint)
    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, client_id: this.clientId, client_secret: this.clientSecret }).toString(),
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || typeof body['access_token'] !== 'string') {
      throw new OidcTokenError(res.status, typeof body['error'] === 'string' ? body['error'] : '')
    }
    const expiresIn = Number(body['expires_in'])
    return {
      accessToken: body['access_token'] as string,
      ...(typeof body['refresh_token'] === 'string' ? { refreshToken: body['refresh_token'] } : {}),
      ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
    }
  }
}
