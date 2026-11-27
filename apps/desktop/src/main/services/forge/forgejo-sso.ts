import { createHash, randomBytes } from 'crypto'

import { ForgeHttpError, forgeRequest } from './forge-http'

/**
 * GH51 — connexion au navigateur vers une forge Forgejo (OAuth2 Authorization Code + PKCE S256,
 * client public : aucun secret sur le poste). Chemins fixes de Forgejo (`/login/oauth/…`) ; l'identité
 * est lue ensuite par l'API (`persistToken`), pas par un `id_token`.
 *
 * Les échanges passent par `forgeRequest` (proxy d'entreprise du poste) et jamais par `fetch`.
 */

/** Délai pour terminer la connexion dans le navigateur (D6). */
export const SSO_TIMEOUT_MS = 5 * 60_000

/** Renouvellement anticipé : le jeton est remplacé 60 s avant son expiration. */
export const SSO_REFRESH_MARGIN_MS = 60_000

export const SSO_CALLBACK_PATH = '/callback'

export type SsoErrorCode =
  | 'not-configured' | 'not-a-forge' | 'network' | 'bind' | 'browser'
  | 'cancelled' | 'timeout' | 'denied' | 'state' | 'no-code' | 'exchange' | 'identity'

const SSO_MESSAGES: Record<SsoErrorCode, string> = {
  'not-configured': 'La connexion par le navigateur n’est pas configurée sur ce poste.',
  'not-a-forge': 'Ce serveur n’est pas une forge Forgejo : utilisez un jeton d’accès.',
  'network': 'Le serveur est injoignable : la connexion par le navigateur n’a pas abouti.',
  'bind': 'Impossible d’ouvrir le port local de retour pour la connexion.',
  'browser': 'Impossible d’ouvrir le navigateur sur ce poste.',
  'cancelled': 'Connexion annulée.',
  'timeout': 'La connexion n’a pas été terminée dans le navigateur (délai de 5 minutes dépassé).',
  'denied': 'Connexion refusée dans le navigateur.',
  'state': 'Réponse de connexion invalide (contrôle de sécurité échoué). Réessayez.',
  'no-code': 'Réponse de connexion incomplète. Réessayez.',
  'exchange': 'La forge a refusé la validation de la connexion. Réessayez, ou utilisez un jeton d’accès.',
  'identity': 'Impossible de vérifier votre identité sur la forge.',
}

/** Erreur de la connexion par le navigateur : `message` fixe, sans donnée de la requête (AC11). */
export class SsoLoginError extends Error {
  constructor(readonly code: SsoErrorCode) {
    super(SSO_MESSAGES[code])
    this.name = 'SsoLoginError'
  }
}

/** Réponse refusée par le point d'échange OAuth2 (code invalide, refresh token révoqué…). */
export class OAuthTokenError extends Error {
  constructor(readonly status: number, readonly oauthError: string) {
    super(`Échange de jeton refusé par la forge (${status}${oauthError ? ` ${oauthError}` : ''})`)
    this.name = 'OAuthTokenError'
  }
}

export interface SsoTokens {
  accessToken: string
  refreshToken?: string
  /** Horodatage (ms) d'expiration du jeton d'accès ; absent si la forge n'en donne pas. */
  expiresAt?: number
}

export interface PkcePair {
  verifier: string
  challenge: string
}

/** Verifier de 43 caractères (32 octets) et challenge S256 (RFC 7636). */
export function newPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** État anti-CSRF : 16 octets aléatoires, jamais réutilisés. */
export function newState(): string {
  return randomBytes(16).toString('base64url')
}

export function authorizeUrl(input: {
  baseUrl: string; clientId: string; redirectUri: string; state: string; challenge: string
}): string {
  const url = new URL('/login/oauth/authorize', input.baseUrl)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

export function exchangeCode(input: {
  baseUrl: string; clientId: string; redirectUri: string; code: string; verifier: string
}): Promise<SsoTokens> {
  return tokenRequest(input.baseUrl, {
    grant_type: 'authorization_code',
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  })
}

export function refreshTokens(input: { baseUrl: string; clientId: string; refreshToken: string }): Promise<SsoTokens> {
  return tokenRequest(input.baseUrl, {
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  })
}

async function tokenRequest(baseUrl: string, form: Record<string, string>): Promise<SsoTokens> {
  let res
  try {
    res = await forgeRequest<Record<string, unknown>>(`${baseUrl}/login/oauth/access_token`, { method: 'POST', form })
  } catch (err) {
    if (err instanceof ForgeHttpError) throw new OAuthTokenError(err.status, oauthErrorOf(err.forgeMessage))
    throw err
  }
  const body = res.data
  if (!body || typeof body['access_token'] !== 'string') throw new OAuthTokenError(res.status, '')
  const expiresIn = Number(body['expires_in'])
  return {
    accessToken: body['access_token'],
    ...(typeof body['refresh_token'] === 'string' && body['refresh_token'] ? { refreshToken: body['refresh_token'] } : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
  }
}

/** Code d'erreur OAuth2 (`invalid_grant`…) lu dans le corps de la réponse refusée, sinon vide. */
function oauthErrorOf(forgeMessage: string): string {
  const m = /"error"\s*:\s*"([a-z_]{1,40})"/.exec(forgeMessage)
  return m ? m[1] : ''
}
