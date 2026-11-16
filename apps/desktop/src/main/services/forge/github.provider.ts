import type { ForgeCollaborator, ForgeIdentity, ForgeOwner, ForgeRepo, ForgeRepoTeam, RepoAccessLevel } from '@polenta/types'

import { describeFetchError } from '../net-proxy'
import { forgeRequest, ForgeHttpError, type ForgeRequestOptions } from './forge-http'
import {
  assertRepoName, normalizeLevel, OwnerCreateForbiddenError, RepoNameTakenError, UnknownAccountError, VisibilityChangeError,
  type ForgeProvider,
} from './forge-provider'

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

  async listRepos(baseUrl, token) {
    const repos = await paginate<ApiRepo>(baseUrl, '/user/repos?affiliation=owner,collaborator,organization_member', token)
    return repos.map(toForgeRepo).sort((a, b) => a.fullName.localeCompare(b.fullName))
  },

  async teamScopeMissing(baseUrl, token) {
    const probe = await forgeRequest<unknown>(`${apiBase(baseUrl)}/user`, opts(baseUrl, token))
    const scopes = scopesOf(probe.headers)
    return scopes !== null && !scopes.some(s => s === 'read:org' || s === 'write:org' || s === 'admin:org')
  },

  async orgMembers(baseUrl, token, owner) {
    let members: Array<{ login: string }>
    try {
      members = await paginate(baseUrl, `/orgs/${encodeURIComponent(owner)}/members`, token)
    } catch (err) {
      // Propriétaire = utilisateur (repo personnel) : pas d'organisation.
      if (err instanceof ForgeHttpError && err.status === 404) return null
      throw err
    }
    return members.map(m => ({ login: m.login, name: m.login })).sort((a, b) => a.login.localeCompare(b.login))
  },

  async listOwners(baseUrl, token, login) {
    // `GET /user/memberships/orgs` donne le rôle ; il exige `read:org` (mesuré : GH107-sprint1 §2).
    const scopeMissing = await githubProvider.teamScopeMissing!(baseUrl, token)
    // Repo personnel : un collaborateur a toujours l'écriture, GitHub refuse un autre niveau (GH356).
    const user: ForgeOwner = { name: login, label: '', kind: 'user', canCreate: true, fixedCollaboratorLevel: 'write' }
    let orgs: Array<{ login: string; role: 'admin' | 'member' }>
    if (scopeMissing) {
      const pub = await paginate<{ login: string }>(baseUrl, '/user/orgs', token)
      orgs = pub.map(o => ({ login: o.login, role: 'member' }))
    } else {
      const memberships = await paginate<{ role: 'admin' | 'member'; organization: { login: string } }>(
        baseUrl, '/user/memberships/orgs?state=active', token)
      orgs = memberships.map(m => ({ login: m.organization.login, role: m.role }))
    }
    const owners = await Promise.all(orgs.map(async (o): Promise<ForgeOwner | null> => {
      if (o.role === 'admin') return { name: o.login, label: '', kind: 'org', canCreate: true }
      // `members_can_create_*` n'est garanti que pour un admin : sinon proposée, refus expliqué.
      let allowed: boolean | null | undefined
      try {
        allowed = (await forgeRequest<{ members_can_create_repositories?: boolean | null }>(
          `${apiBase(baseUrl)}/orgs/${encodeURIComponent(o.login)}`, opts(baseUrl, token))).data.members_can_create_repositories
      } catch {
        allowed = null
      }
      if (allowed === false) return null
      return { name: o.login, label: '', kind: 'org', canCreate: allowed === true ? true : 'unknown' }
    }))
    return {
      owners: [user, ...owners.filter((o): o is ForgeOwner => o !== null).sort((a, b) => a.name.localeCompare(b.name))],
      ...(scopeMissing ? { scopeMissing: true } : {}),
    }
  },

  async repoExists(baseUrl, token, owner, name) {
    try {
      await forgeRequest(repoApiUrl(baseUrl, owner, name), opts(baseUrl, token))
      return true
    } catch (err) {
      if (err instanceof ForgeHttpError && err.status === 404) return false
      throw err
    }
  },

  async createRepo(baseUrl, token, input) {
    // Un nom invalide serait renommé sans erreur (`bad!` → `bad-`, mesuré) : refusé avant l'appel.
    assertRepoName(input.name)
    const path = input.ownerKind === 'user' ? '/user/repos' : `/orgs/${encodeURIComponent(input.owner)}/repos`
    let data: ApiRepo
    try {
      data = (await forgeRequest<ApiRepo>(`${apiBase(baseUrl)}${path}`, {
        ...opts(baseUrl, token), method: 'POST',
        // `default_branch` n'est pas accepté à la création : `main`, alignée après le push.
        json: { name: input.name, description: input.description, private: input.visibility === 'private', auto_init: false },
      })).data
    } catch (err) {
      if (!(err instanceof ForgeHttpError)) throw err
      // Nom pris : 422 « Repository creation failed. », la raison est dans `errors[]` (corps non lu ici).
      if (err.status === 422 && await githubProvider.repoExists!(baseUrl, token, input.owner, input.name)) {
        throw new RepoNameTakenError(`${input.owner}/${input.name}`)
      }
      if (input.ownerKind === 'org' && (err.status === 403 || err.status === 404)) throw new OwnerCreateForbiddenError(input.owner, err.forgeMessage)
      throw err
    }
    if (data.name !== input.name) throw new Error(`Le serveur a créé le dépôt sous le nom « ${data.full_name} » au lieu de « ${input.owner}/${input.name} ».`)
    return toForgeRepo(data)
  },

  async repoDetails(baseUrl, token, owner, repo) {
    try {
      const { data } = await forgeRequest<ApiRepo>(repoApiUrl(baseUrl, owner, repo), { ...opts(baseUrl, token), timeoutMs: 10_000 })
      const p = data.permissions
      return {
        cloneUrl: data.clone_url, description: data.description ?? '', visibility: data.private ? 'private' : 'public', defaultBranch: data.default_branch ?? '',
        permissions: { pull: p?.pull ?? true, push: p?.push ?? false, admin: p?.admin ?? false },
        ...ownerKindOf(data),
      }
    } catch (err) {
      if (err instanceof ForgeHttpError && err.status === 404) return null
      throw err
    }
  },

  async updateRepo(baseUrl, token, owner, repo, patch) {
    if (patch.description !== undefined) {
      await forgeRequest(repoApiUrl(baseUrl, owner, repo), { ...opts(baseUrl, token), method: 'PATCH', json: { description: patch.description } })
    }
    if (patch.visibility !== undefined) {
      try {
        await forgeRequest(repoApiUrl(baseUrl, owner, repo), { ...opts(baseUrl, token), method: 'PATCH', json: { private: patch.visibility === 'private' } })
      } catch (err) {
        // Changement asynchrone : un second aussitôt après → 422 « still in progress » (mesuré).
        if (err instanceof ForgeHttpError && err.status === 422) {
          throw new VisibilityChangeError(patch.visibility, err.forgeMessage, /in progress/i.test(err.forgeMessage))
        }
        throw err
      }
    }
  },

  async listCollaborators(baseUrl, token, owner, repo) {
    const users = await paginate<{ login: string; role_name?: string }>(
      baseUrl, `${repoPath(owner, repo)}/collaborators?affiliation=direct`, token)
    return users
      .filter(u => u.login.toLowerCase() !== owner.toLowerCase())
      // `role_name` porte le vrai niveau ; `permission` (route /permission) arrondit triage et maintain.
      .map((u): ForgeCollaborator => ({ login: u.login, level: normalizeLevel(u.role_name ?? '') }))
      .sort((a, b) => a.login.localeCompare(b.login))
  },

  async setCollaborator(baseUrl, token, owner, repo, login, level) {
    // GH356 — repo personnel : pas de niveau (écriture, seul possible) ; `permission` y est refusé en 422
    // (constaté avec admin). Propriétaire inconnu : niveau envoyé, comme pour une organisation.
    const personal = await githubProvider.repoDetails!(baseUrl, token, owner, repo)
      .then(d => d?.ownerKind === 'user', () => false)
    // Invitation en attente : un nouveau PUT ne change pas son niveau (mesuré), PATCH de l'invitation.
    const pending = (await githubProvider.listInvitations!(baseUrl, token, owner, repo)).find(i => i.login.toLowerCase() === login.toLowerCase())
    if (pending && personal) return 'invited'
    if (pending) {
      await forgeRequest(`${repoApiUrl(baseUrl, owner, repo)}/invitations/${pending.id}`, {
        ...opts(baseUrl, token), method: 'PATCH', json: { permissions: level },
      })
      return 'invited'
    }
    try {
      const res = await forgeRequest(`${repoApiUrl(baseUrl, owner, repo)}/collaborators/${encodeURIComponent(login)}`, {
        ...opts(baseUrl, token), method: 'PUT', json: personal ? {} : { permission: githubLevel(level) },
      })
      return res.status === 201 ? 'invited' : 'added'
    } catch (err) {
      if (err instanceof ForgeHttpError && err.status === 404) throw new UnknownAccountError(login)
      throw err
    }
  },

  async removeCollaborator(baseUrl, token, owner, repo, login) {
    await forgeRequest(`${repoApiUrl(baseUrl, owner, repo)}/collaborators/${encodeURIComponent(login)}`, { ...opts(baseUrl, token), method: 'DELETE' })
  },

  async listRepoTeams(baseUrl, token, owner, repo) {
    let teams: Array<{ slug: string; name: string; permission?: string }>
    try {
      teams = await paginate(baseUrl, `${repoPath(owner, repo)}/teams`, token)
    } catch (err) {
      if (err instanceof ForgeHttpError && err.status === 404) return []
      throw err
    }
    return teams
      .map((t): ForgeRepoTeam => ({ name: t.slug, label: t.name, level: normalizeLevel(t.permission ?? ''), levelEditable: true, removable: true }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async listOrgTeams(baseUrl, token, org) {
    const teams = await paginate<{ slug: string; name: string }>(baseUrl, `/orgs/${encodeURIComponent(org)}/teams`, token)
    return teams.map(t => ({ name: t.slug, label: t.name })).sort((a, b) => a.name.localeCompare(b.name))
  },

  async setRepoTeam(baseUrl, token, owner, repo, team, level = 'read') {
    await forgeRequest(teamRepoUrl(baseUrl, owner, repo, team), { ...opts(baseUrl, token), method: 'PUT', json: { permission: githubLevel(level) } })
  },

  async removeRepoTeam(baseUrl, token, owner, repo, team) {
    await forgeRequest(teamRepoUrl(baseUrl, owner, repo, team), { ...opts(baseUrl, token), method: 'DELETE' })
  },

  async listInvitations(baseUrl, token, owner, repo) {
    const invitations = await paginate<{ id: number; invitee?: { login: string } | null; permissions: string }>(
      baseUrl, `${repoPath(owner, repo)}/invitations`, token)
    return invitations.flatMap(i => i.invitee?.login ? [{ id: i.id, login: i.invitee.login, level: normalizeLevel(i.permissions) }] : [])
  },

  async cancelInvitation(baseUrl, token, owner, repo, id) {
    try {
      await forgeRequest(`${repoApiUrl(baseUrl, owner, repo)}/invitations/${id}`, { ...opts(baseUrl, token), method: 'DELETE' })
    } catch (err) {
      // Déjà acceptée, refusée ou annulée : 404 — plus d'invitation, l'état voulu est atteint.
      if (err instanceof ForgeHttpError && err.status === 404) return
      throw err
    }
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
function apiBase(baseUrl: string): string {
  return isGithubBase(baseUrl) ? API : `${baseUrl}/api/v3`
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

function repoApiUrl(baseUrl: string, owner: string, repo: string): string {
  return `${apiBase(baseUrl)}${repoPath(owner, repo)}`
}

function teamRepoUrl(baseUrl: string, owner: string, repo: string, team: string): string {
  return `${apiBase(baseUrl)}/orgs/${encodeURIComponent(owner)}/teams/${encodeURIComponent(team)}${repoPath(owner, repo)}`
}

function opts(baseUrl: string, token: string): ForgeRequestOptions {
  return { token, fixedUrl: isGithubBase(baseUrl) }
}

/** `X-OAuth-Scopes` (casse quelconque) ; `null` si l'en-tête est absent (jeton sans scopes OAuth). */
function scopesOf(headers: Record<string, string>): string[] | null {
  const key = Object.keys(headers).find(k => k.toLowerCase() === 'x-oauth-scopes')
  if (key === undefined) return null
  return headers[key].split(',').map(s => s.trim()).filter(Boolean)
}

/** `type` du propriétaire : `User` (repo personnel) ou `Organization` ; absent → rien. */
function ownerKindOf(r: ApiRepo): { ownerKind?: 'user' | 'org' } {
  const type = r.owner?.type
  return type === 'User' ? { ownerKind: 'user' } : type === 'Organization' ? { ownerKind: 'org' } : {}
}

/** Niveau Polenta → nom GitHub en écriture. */
function githubLevel(level: RepoAccessLevel): 'pull' | 'push' | 'admin' {
  return level === 'read' ? 'pull' : level === 'write' ? 'push' : 'admin'
}

interface ApiRepo {
  full_name: string
  name: string
  owner?: { login?: string; type?: string }
  description?: string | null
  clone_url: string
  default_branch?: string
  private?: boolean
  permissions?: { pull?: boolean; push?: boolean; admin?: boolean }
}

function toForgeRepo(r: ApiRepo): ForgeRepo {
  return {
    fullName: r.full_name, owner: r.owner?.login ?? r.full_name.split('/')[0], name: r.name, description: r.description?.trim() ?? '',
    cloneUrl: r.clone_url, readOnly: r.permissions ? !r.permissions.push : false, private: r.private,
  }
}

/** Toutes les pages (100 par page, maximum de GitHub), bornées à 2 000 éléments. */
const PAGE_SIZE = 100
const MAX_PAGES = 20

async function paginate<T>(baseUrl: string, path: string, token: string): Promise<T[]> {
  const out: T[] = []
  const sep = path.includes('?') ? '&' : '?'
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await forgeRequest<T[]>(`${apiBase(baseUrl)}${path}${sep}per_page=${PAGE_SIZE}&page=${page}`, opts(baseUrl, token))
    if (!Array.isArray(data)) break
    out.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return out
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
      json: { client_id: GITHUB_OAUTH_CLIENT_ID, scope: 'repo user:email read:org' },
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
