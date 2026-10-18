import type { ForgeIdentity } from '@polenta/types'

import { describeFetchError } from '../net-proxy'
import { forgeRequest, ForgeHttpError } from './forge-http'
import type { ForgeProvider } from './forge-provider'

/**
 * GH45 — GitHub (identité, OAuth Device Flow). Seul endroit du code applicatif où `github.com` est
 * écrit en dur (critère 9 de la spec), avec l'URL des releases et le projet de démo par défaut.
 */
export const GITHUB_HOST = 'github.com'
const API = 'https://api.github.com'

// Client ID de l'OAuth App GitHub "Polenta" (Device Flow activé). Non secret par nature — le
// Device Flow ne nécessite aucun client secret — donc embarqué directement, pas de config externe.
const GITHUB_OAUTH_CLIENT_ID = 'Ov23lik4NMTf6G4jNuvY'

export function isGithubHost(host: string): boolean {
  return host.toLowerCase() === GITHUB_HOST
}

export const githubProvider: ForgeProvider = {
  kind: 'github',
  async resolveIdentity(_baseUrl: string, token: string): Promise<ForgeIdentity> {
    let data: { login: string; name: string | null; email: string | null }
    try {
      data = (await forgeRequest<typeof data>(`${API}/user`, { token, fixedUrl: true })).data
    } catch (err) {
      if (err instanceof ForgeHttpError) throw new Error(`GitHub API error: ${err.status}`)
      throw new Error(describeFetchError(err))
    }
    // `/user`'s `email` field is only populated when the user made it public on their profile —
    // true for most accounts even with a valid token. The primary/verified address requires the
    // `user:email` scope and a separate call to `/user/emails`.
    let email = data.email ?? ''
    if (!email) {
      try {
        const emails = (await forgeRequest<{ email: string; primary: boolean; verified: boolean }[]>(`${API}/user/emails`, { token, fixedUrl: true })).data
        email = emails.find(e => e.primary && e.verified)?.email ?? emails.find(e => e.verified)?.email ?? ''
      } catch {
        // Token predates the user:email scope, or the call failed — keep whatever we have.
      }
    }
    return { login: data.login, name: data.name ?? data.login, email }
  },

  async repoInfo(baseUrl, token, owner, repo) {
    try {
      const { data } = await forgeRequest<{ default_branch?: string; permissions?: { admin?: boolean } }>(
        repoApiUrl(baseUrl, owner, repo), { token, fixedUrl: isGithubBase(baseUrl), timeoutMs: 10_000 })
      return { defaultBranch: data.default_branch ?? '', admin: data.permissions?.admin ?? false }
    } catch (err) {
      // GitHub répond 404 (pas 403) sur un repo privé sans accès ; un 403 remonte à `guard`.
      if (err instanceof ForgeHttpError && err.status === 404) return null
      throw err
    }
  },

  async setDefaultBranch(baseUrl, token, owner, repo, branch) {
    await forgeRequest(repoApiUrl(baseUrl, owner, repo), {
      method: 'PATCH', token, fixedUrl: isGithubBase(baseUrl), json: { default_branch: branch },
    })
  },
}

function isGithubBase(baseUrl: string): boolean {
  try {
    return isGithubHost(new URL(baseUrl).host)
  } catch {
    return false
  }
}

/** GH106 — `api.github.com` pour github.com, `<base>/api/v3` sinon (GitHub Enterprise Server, tests). */
function repoApiUrl(baseUrl: string, owner: string, repo: string): string {
  const api = isGithubBase(baseUrl) ? API : `${baseUrl}/api/v3`
  return `${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

// ─── OAuth Device Flow (T98) ────────────────────────────────────────────────────

export interface DeviceFlowSession {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type DeviceFlowPoll =
  | { status: 'token'; token: string }
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; message: string }

export async function startGithubDeviceFlow(): Promise<DeviceFlowSession> {
  let data: { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }
  try {
    data = (await forgeRequest<typeof data>(`https://${GITHUB_HOST}/login/device/code`, {
      method: 'POST',
      fixedUrl: true,
      json: { client_id: GITHUB_OAUTH_CLIENT_ID, scope: 'repo user:email' },
    })).data
  } catch (err) {
    if (err instanceof ForgeHttpError) throw new Error(`GitHub device code error: ${err.status}`)
    throw new Error(describeFetchError(err))
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  }
}

export async function pollGithubDeviceFlow(deviceCode: string): Promise<DeviceFlowPoll> {
  try {
    const { data } = await forgeRequest<{ access_token?: string; error?: string; interval?: number }>(
      `https://${GITHUB_HOST}/login/oauth/access_token`,
      {
        method: 'POST',
        fixedUrl: true,
        json: {
          client_id: GITHUB_OAUTH_CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        },
      },
    )
    if (data.access_token) return { status: 'token', token: data.access_token }
    switch (data.error) {
      case 'authorization_pending': return { status: 'pending' }
      case 'slow_down': return { status: 'slow_down', interval: data.interval ?? 10 }
      case 'expired_token': return { status: 'expired' }
      case 'access_denied': return { status: 'denied' }
      default: return { status: 'error', message: data.error ?? 'Erreur inconnue' }
    }
  } catch (err) {
    return { status: 'error', message: describeFetchError(err) }
  }
}
