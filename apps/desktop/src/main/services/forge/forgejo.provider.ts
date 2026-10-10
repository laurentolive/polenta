import type { ForgeDetection, ForgeIdentity, PasswordLoginResult } from '@polenta/types'

import { isNetworkUnreachable, describeFetchError } from '../net-proxy'
import { forgeRequest, ForgeHttpError, normalizeBaseUrl } from './forge-http'
import type { ForgeProvider } from './forge-provider'
import { GITHUB_HOST } from './github.provider'

/**
 * GH45 — Forgejo et Gitea (API /api/v1 commune). Comportements mesurés le 2026-10-09/10 sur
 * Forgejo 15.0.9 et Gitea 28.1.0 (specs/GH45-sprint1.md §6, GH45-design.md §12).
 */

/**
 * Scopes du jeton créé à la connexion par mot de passe : `write:organization` est nécessaire pour
 * créer un repo dans une organisation (`read:organization` → 403).
 */
export const POLENTA_TOKEN_SCOPES = ['write:repository', 'read:user', 'write:organization'] as const

export const forgejoProvider: ForgeProvider = {
  kind: 'forgejo',
  async resolveIdentity(baseUrl: string, token: string): Promise<ForgeIdentity> {
    const { data } = await forgeRequest<{ login: string; full_name?: string; email?: string }>(
      `${baseUrl}/api/v1/user`, { token },
    )
    // L'e-mail peut être une adresse « noreply » si l'utilisateur masque la sienne : prise telle quelle.
    return { login: data.login, name: data.full_name?.trim() || data.login, email: data.email ?? '' }
  },
}

/**
 * Type de forge d'un serveur. Nos forges exigent la connexion pour tout : `/api/v1/version`
 * répond alors 403 `{"message": "Only signed in user…"}` — c'est la signature d'une forge de la
 * famille Gitea, au même titre qu'un 200 `{version}`. `/api/forgejo/v1/version` existe sur Forgejo
 * (200 ou 403) et pas sur Gitea (404).
 */
export async function detectForge(serverUrl: string): Promise<ForgeDetection> {
  const requested = normalizeBaseUrl(serverUrl)
  if (new URL(requested).hostname.toLowerCase() === GITHUB_HOST) return { provider: 'github', baseUrl: requested }
  const probe = await giteaApiProbe(`${requested}/api/v1/version`)
  // Base = origine finale : http → https ou hôte canonique suivis par forgeRequest.
  const baseUrl = probe.finalOrigin ?? requested
  if (!probe.isGitea) return { provider: 'generic', baseUrl: requested }
  const forgejoRoute = await statusOf(`${baseUrl}/api/forgejo/v1/version`)
  return { provider: 'forgejo', flavor: forgejoRoute === 404 ? 'gitea' : 'forgejo', baseUrl }
}

async function giteaApiProbe(url: string): Promise<{ isGitea: boolean; finalOrigin?: string }> {
  try {
    const res = await forgeRequest<{ version?: unknown }>(url)
    const data = res.data
    return { isGitea: typeof data === 'object' && data !== null && typeof data.version === 'string', finalOrigin: new URL(res.url).origin }
  } catch (err) {
    if (err instanceof ForgeHttpError) {
      const isGitea = (err.status === 401 || err.status === 403)
        && err.contentType.includes('json')
        && /signed in|sign in/i.test(err.forgeMessage)
      return { isGitea, finalOrigin: new URL(err.finalUrl).origin }
    }
    throw err   // réseau : à l'appelant de l'afficher
  }
}

async function statusOf(url: string): Promise<number> {
  try {
    return (await forgeRequest(url)).status
  } catch (err) {
    if (err instanceof ForgeHttpError) return err.status
    throw err
  }
}

export type TokenCreation = { status: 'ok'; token: string } | Exclude<PasswordLoginResult, { status: 'ok' }>

/**
 * Crée un jeton d'accès avec identifiant + mot de passe (+ code 2FA). Le mot de passe ne sort de
 * cette fonction que dans l'en-tête Authorization de la requête (cf. forge-http.ts).
 */
export async function createAccessToken(
  baseUrl: string, login: string, password: string, otp: string | undefined, tokenName: string,
): Promise<TokenCreation> {
  try {
    const { data } = await forgeRequest<{ sha1?: string }>(
      `${baseUrl}/api/v1/users/${encodeURIComponent(login)}/tokens`,
      { method: 'POST', basic: { login, password }, otp: otp || undefined, json: { name: tokenName, scopes: POLENTA_TOKEN_SCOPES } },
    )
    if (!data.sha1) return { status: 'network', message: 'Réponse inattendue du serveur (jeton absent).' }
    return { status: 'ok', token: data.sha1 }
  } catch (err) {
    if (err instanceof ForgeHttpError) return classifyTokenError(err, Boolean(otp), baseUrl)
    if (isNetworkUnreachable(err)) return { status: 'network', message: describeFetchError(err) }
    return { status: 'network', message: err instanceof Error ? err.message : String(err) }
  }
}

/** Réponses de POST /users/{login}/tokens en échec (mesures §6.3). Exportée pour les tests. */
export function classifyTokenError(err: ForgeHttpError, otpSent: boolean, baseUrl: string): Exclude<TokenCreation, { status: 'ok' }> {
  const msg = err.forgeMessage.toLowerCase()
  // Compte neuf créé par l'admin : 403 « You must change your password. Change it at: <url> »
  // (Forgejo : /user/change_password, Gitea : /user/settings/change_password — mesuré le 2026-10-10).
  if (err.status === 403 && msg.includes('must change your password')) {
    return { status: 'password-change-required', url: passwordChangeUrl(err.forgeMessage, baseUrl) }
  }
  if (err.status === 401 || err.status === 403) {
    if (msg.includes('otp')) return otpSent ? { status: 'invalid-otp' } : { status: 'otp-required' }
    if (msg.includes('not allowed login') || msg.includes('prohibited')) return { status: 'account-disabled' }
    // Forgejo : « password is invalid », « does not exist » ; Gitea : réponse générique pour tout.
    return { status: 'invalid-credentials' }
  }
  return { status: 'network', message: `Le serveur a répondu HTTP ${err.status}${err.forgeMessage ? ` : ${err.forgeMessage}` : ''}.` }
}

/**
 * URL de changement de mot de passe annoncée par la forge, si elle est sur le même serveur ; sinon
 * la page de connexion du serveur (jamais une URL d'un autre hôte).
 */
export function passwordChangeUrl(forgeMessage: string, baseUrl: string): string {
  const found = /https?:\/\/\S+/.exec(forgeMessage)?.[0]
  if (found) {
    try {
      const url = new URL(found)
      if (url.origin === new URL(baseUrl).origin) {
        url.pathname = url.pathname.replace(/\/{2,}/g, '/')
        return url.toString()
      }
    } catch {
      // URL illisible : repli
    }
  }
  return `${baseUrl}/user/login`
}

/**
 * Sonde d'accès après un échec git inexpliqué (§12) : un compte désactivé ne produit pas de 401
 * côté git (HTTP 200 + page HTML), seule l'API dit ce qu'il en est.
 * Renvoie `revoked` (jeton refusé ou compte désactivé), `ok`, ou `unknown` (réseau, autre).
 */
export async function probeAccess(baseUrl: string, token: string): Promise<'ok' | 'revoked' | 'unknown'> {
  try {
    await forgeRequest(`${baseUrl}/api/v1/user`, { token, timeoutMs: 10_000 })
    return 'ok'
  } catch (err) {
    if (err instanceof ForgeHttpError) {
      if (err.status === 401) return 'revoked'
      if (err.status === 403 && /prohibited|not allowed/i.test(err.forgeMessage)) return 'revoked'
    }
    return 'unknown'
  }
}
