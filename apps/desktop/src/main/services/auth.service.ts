import keytar from 'keytar'
import { app, shell } from 'electron'
import * as fsPromises from 'fs/promises'
import * as path from 'path'

import type { GitAuthor } from './git.service'

const KEYTAR_SERVICE = 'polenta'

// Client ID de l'OAuth App GitHub "Polenta" (Device Flow activé). Non secret par nature — le
// Device Flow ne nécessite aucun client secret — donc embarqué directement, pas de config externe.
const GITHUB_OAUTH_CLIENT_ID = 'Ov23lik4NMTf6G4jNuvY'

export interface DeviceFlowSession {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type DeviceFlowPollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'success'; identity: { login: string; name: string; email: string } }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; message: string }

export interface StoredAccount {
  remoteHost: string
  username: string
  name: string
  email: string
}

interface AuthStore {
  accounts: StoredAccount[]
  defaultAccount: string | null
}

export interface UserIdentity {
  name: string
  email: string
  login: string
  avatarUrl: string | null
}

export class AuthService {
  private get authFilePath(): string {
    return path.join(app.getPath('userData'), 'auth.json')
  }

  // ─── Token storage (keychain OS) ────────────────────────────────────────────

  async saveToken(remote: string, token: string): Promise<void> {
    const host = extractHost(remote)
    await keytar.setPassword(KEYTAR_SERVICE, host, token)
  }

  async saveTokenForUser(remote: string, username: string, token: string): Promise<void> {
    const host = extractHost(remote)
    await keytar.setPassword(KEYTAR_SERVICE, `${host}:${username}`, token)
  }

  async getToken(remote: string, username?: string): Promise<string | null> {
    const host = extractHost(remote)
    const account = username ? `${host}:${username}` : host
    return keytar.getPassword(KEYTAR_SERVICE, account)
  }

  async deleteToken(remote: string, username?: string): Promise<void> {
    const host = extractHost(remote)
    const account = username ? `${host}:${username}` : host
    await keytar.deletePassword(KEYTAR_SERVICE, account)
  }

  // ─── Identity resolution ────────────────────────────────────────────────────

  async resolveIdentity(remote: string, token?: string): Promise<{ login: string; name: string; email: string }> {
    const host = extractHost(remote)
    const pat = token ?? (await this.getToken(remote))

    if (!pat) {
      throw new Error(`No token found for remote: ${remote}`)
    }

    if (host === 'github.com') {
      return resolveGithubIdentity(pat)
    }

    // Gitea / self-hosted: try /api/v1/user
    try {
      return await resolveGiteaIdentity(remote, pat)
    } catch {
      // Fallback: return minimal identity from token
      return { login: 'unknown', name: 'Unknown User', email: '' }
    }
  }

  // ─── Author for git commits ─────────────────────────────────────────────────

  async getAuthor(repoPath: string): Promise<GitAuthor> {
    // 1. Try auth.json in userData
    try {
      const store = await this.readStore()
      if (store.defaultAccount) {
        const account = store.accounts.find(a => `${a.remoteHost}:${a.username}` === store.defaultAccount)
        if (account && account.name && account.email) {
          return { name: account.name, email: account.email }
        }
      }
      if (store.accounts.length > 0) {
        const first = store.accounts[0]
        if (first.name && first.email) {
          return { name: first.name, email: first.email }
        }
      }
    } catch {
      // fall through
    }

    // 2. Try git config local
    try {
      const name = await readGitConfig(repoPath, 'user.name')
      const email = await readGitConfig(repoPath, 'user.email')
      if (name && email) return { name, email }
    } catch {
      // fall through
    }

    return { name: 'Polenta User', email: 'user@polenta.local' }
  }

  // ─── Credentials for isomorphic-git ────────────────────────────────────────

  async getHttpsCredentials(remote: string): Promise<{ username: string; password: string } | null> {
    const host = extractHost(remote)
    // Local/filesystem remotes (e.g. a Windows path used as `origin`) resolve to an empty
    // hostname — nothing to look up in the keychain, and keytar throws "Account is required"
    // if called with an empty account string.
    if (!host) return null
    const store = await this.readStore()

    const account = store.accounts.find(a => a.remoteHost === host)

    if (account) {
      const token = await keytar.getPassword(KEYTAR_SERVICE, `${host}:${account.username}`)
        ?? await keytar.getPassword(KEYTAR_SERVICE, host)
      if (!token) return null
      return { username: account.username, password: token }
    }

    // No account in auth.json yet — try a bare token stored via saveToken()
    const token = await keytar.getPassword(KEYTAR_SERVICE, host)
    if (!token) return null
    return { username: 'git', password: token }
  }

  async hasAnyAccount(): Promise<boolean> {
    const store = await this.readStore()
    if (store.accounts.length > 0) return true
    const commonHosts = ['github.com', 'gitlab.com']
    for (const host of commonHosts) {
      const t = await keytar.getPassword(KEYTAR_SERVICE, host)
      if (t) return true
    }
    return false
  }

  // Configure a full account: save token + resolve identity + persist account
  async setup(remote: string, pat: string): Promise<{ login: string; name: string; email: string }> {
    return this.persistToken(remote, pat)
  }

  // ─── GitHub OAuth Device Flow ───────────────────────────────────────────────

  async startDeviceFlow(remote: string): Promise<DeviceFlowSession> {
    const host = extractHost(remote)
    if (host !== 'github.com') {
      throw new Error('Device Flow disponible uniquement pour github.com')
    }

    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_OAUTH_CLIENT_ID, scope: 'repo' }),
    })
    if (!res.ok) throw new Error(`GitHub device code error: ${res.status}`)
    const data = (await res.json()) as {
      device_code: string
      user_code: string
      verification_uri: string
      expires_in: number
      interval: number
    }

    await shell.openExternal(data.verification_uri)

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval,
    }
  }

  async pollDeviceFlow(remote: string, deviceCode: string): Promise<DeviceFlowPollResult> {
    if (extractHost(remote) !== 'github.com') {
      return { status: 'error', message: 'Device Flow disponible uniquement pour github.com' }
    }
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: GITHUB_OAUTH_CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      })
      const data = (await res.json()) as { access_token?: string; error?: string; interval?: number }

      if (data.access_token) {
        const identity = await this.persistToken(remote, data.access_token)
        return { status: 'success', identity }
      }

      switch (data.error) {
        case 'authorization_pending':
          return { status: 'pending' }
        case 'slow_down':
          return { status: 'slow_down', interval: data.interval ?? 10 }
        case 'expired_token':
          return { status: 'expired' }
        case 'access_denied':
          return { status: 'denied' }
        default:
          return { status: 'error', message: data.error ?? 'Erreur inconnue' }
      }
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  }

  // Shared by setup() (PAT) and pollDeviceFlow() (OAuth) — save token, resolve identity, persist account
  private async persistToken(remote: string, token: string): Promise<{ login: string; name: string; email: string }> {
    const host = extractHost(remote)
    await keytar.setPassword(KEYTAR_SERVICE, host, token)
    try {
      const identity = await this.resolveIdentity(remote, token)
      await keytar.setPassword(KEYTAR_SERVICE, `${host}:${identity.login}`, token)
      await this.saveAccount({ remoteHost: host, username: identity.login, name: identity.name, email: identity.email })
      return identity
    } catch {
      // Can't resolve identity (Gitea without API, etc.) — keep bare token
      return { login: 'git', name: 'Git User', email: `git@${host}` }
    }
  }

  // ─── Persist account to auth.json ──────────────────────────────────────────

  async saveAccount(account: StoredAccount): Promise<void> {
    const store = await this.readStore()
    const idx = store.accounts.findIndex(
      a => a.remoteHost === account.remoteHost && a.username === account.username,
    )
    if (idx >= 0) {
      store.accounts[idx] = account
    } else {
      store.accounts.push(account)
    }
    if (!store.defaultAccount) {
      store.defaultAccount = `${account.remoteHost}:${account.username}`
    }
    await this.writeStore(store)
  }

  async getDefaultAccount(): Promise<{ account: StoredAccount; token: string } | null> {
    const store = await this.readStore()
    const defaultKey = store.defaultAccount
    if (!defaultKey) return null
    const account = store.accounts.find(a => `${a.remoteHost}:${a.username}` === defaultKey)
    if (!account) return null
    const token = await this.getToken(`https://${account.remoteHost}`, account.username)
    if (!token) return null
    return { account, token }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async readStore(): Promise<AuthStore> {
    try {
      const raw = await fsPromises.readFile(this.authFilePath, 'utf-8')
      return JSON.parse(raw) as AuthStore
    } catch {
      return { accounts: [], defaultAccount: null }
    }
  }

  private async writeStore(store: AuthStore): Promise<void> {
    await fsPromises.mkdir(path.dirname(this.authFilePath), { recursive: true })
    await fsPromises.writeFile(this.authFilePath, JSON.stringify(store, null, 2), 'utf-8')
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractHost(remote: string): string {
  try {
    return new URL(remote).hostname
  } catch {
    return remote
  }
}

async function resolveGithubIdentity(token: string): Promise<{ login: string; name: string; email: string }> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as { login: string; name: string | null; email: string | null }
  return {
    login: data.login,
    name: data.name ?? data.login,
    email: data.email ?? '',
  }
}

async function resolveGiteaIdentity(remote: string, token: string): Promise<{ login: string; name: string; email: string }> {
  const baseUrl = remote.replace(/\/[^/]+\/[^/]+$/, '') // strip repo path
  const res = await fetch(`${baseUrl}/api/v1/user`, {
    headers: { Authorization: `token ${token}` },
  })
  if (!res.ok) throw new Error(`Gitea API error: ${res.status}`)
  const data = (await res.json()) as { login: string; full_name: string; email: string }
  return {
    login: data.login,
    name: data.full_name ?? data.login,
    email: data.email ?? '',
  }
}

async function readGitConfig(repoPath: string, key: string): Promise<string | null> {
  // isomorphic-git doesn't have a simple getConfig for local — read .git/config manually
  const configPath = path.join(repoPath, '.git', 'config')
  try {
    const raw = await fsPromises.readFile(configPath, 'utf-8')
    const lines = raw.split('\n')
    const [section, subKey] = key.split('.')
    let inSection = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === `[${section}]`) {
        inSection = true
        continue
      }
      if (trimmed.startsWith('[')) {
        inSection = false
        continue
      }
      if (inSection && trimmed.startsWith(`${subKey} =`)) {
        return trimmed.split('=')[1]?.trim() ?? null
      }
    }
    return null
  } catch {
    return null
  }
}
