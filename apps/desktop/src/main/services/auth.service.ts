import { randomBytes } from 'crypto'
import * as fsPromises from 'fs/promises'
import * as path from 'path'
import type { ForgeAccount, ForgeDetection, ForgeIdentity, ForgeKind, PasswordLoginResult } from '@polenta/types'

import { gitFor } from '../git/git-backend'
import { pcGitIdentity, refreshGitIdentity } from '../git/git-config'
import type { GitAuthor } from './git.service'
import type { HostContext } from '../host/host-context'
import { migrateLocalPref } from './pref-store.util'
import { describeFetchError, isNetworkUnreachable } from './net-proxy'
import { normalizeBaseUrl } from './forge/forge-http'
import type { ForgeProvider } from './forge/forge-provider'
import { githubProvider, isGithubHost, GITHUB_HOST, startGithubDeviceFlow, pollGithubDeviceFlow } from './forge/github.provider'
import { forgejoProvider, detectForge, createAccessToken, probeAccess } from './forge/forgejo.provider'
import {
  authorizeUrl, exchangeCode, newPkcePair, newState, OAuthTokenError, refreshTokens, SsoLoginError,
  SSO_REFRESH_MARGIN_MS, SSO_TIMEOUT_MS, type SsoTokens,
} from './forge/forgejo-sso'
import { startLoopbackCallback, type LoopbackCallback } from './forge/loopback-callback'
import { BRAND } from '../../shared/brand'

export type { DeviceFlowSession } from './forge/github.provider'

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
  /** GH45 — absent dans un auth.json antérieur : déduit à la lecture (github.com → github, sinon generic). */
  provider?: ForgeKind
  /** GH45 — scheme + hôte (+ port) ; absent → `https://<remoteHost>`. */
  baseUrl?: string
}

interface AuthStore {
  accounts: StoredAccount[]
  defaultAccount: string | null
}

type NormalizedAccount = StoredAccount & { provider: ForgeKind; baseUrl: string }

/**
 * GH51 — renouvellement d'un compte connecté par le navigateur. Stocké dans le magasin de jetons, sous
 * `<hôte>:<login>#sso` : jamais dans `auth.json`. Absent sans refresh token (D5 : pas de renouvellement).
 */
interface SsoRecord {
  clientId: string
  refreshToken: string
  expiresAt?: number
}

/** Ce qu'il faut pour renouveler un jeton : clé du compte, hôte (bannière) et origine de la forge. */
interface SsoTarget {
  key: string
  host: string
  baseUrl: string
}

/**
 * GH45 — jetons « nus » (sans compte dans auth.json) hérités d'anciennes versions, uniquement sur
 * ces deux hôtes. Seule liste d'hôtes écrite en dur hors du provider GitHub (critère 9) : c'est une
 * compatibilité ascendante, pas un choix de forge.
 */
const LEGACY_BARE_TOKEN_HOSTS = [GITHUB_HOST, 'gitlab.com']

function providerFor(kind: ForgeKind): ForgeProvider | null {
  switch (kind) {
    case 'github': return githubProvider
    case 'forgejo': return forgejoProvider
    default: return null
  }
}

function normalize(a: StoredAccount): NormalizedAccount {
  return {
    ...a,
    provider: a.provider ?? (isGithubHost(a.remoteHost) ? 'github' : 'generic'),
    baseUrl: a.baseUrl ?? `https://${a.remoteHost}`,
  }
}

function keyOf(a: StoredAccount): string {
  return `${a.remoteHost}:${a.username}`
}

function toForgeAccount(a: NormalizedAccount): ForgeAccount {
  return {
    key: keyOf(a), provider: a.provider, baseUrl: a.baseUrl, host: a.remoteHost,
    login: a.username, name: a.name, email: a.email,
  }
}

/**
 * Nom lisible et unique du jeton créé à la connexion : `polenta-<poste>-<AAAAMMJJ-HHmm>-<aléa>`.
 * L'aléa évite le refus de la forge (« name has been used ») si l'on se reconnecte dans la même
 * minute (constaté le 2026-10-10).
 */
function tokenName(deviceLabel: string | undefined, now = new Date()): string {
  const device = (deviceLabel ?? 'poste').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'poste'
  const p = (n: number) => String(n).padStart(2, '0')
  const suffix = randomBytes(2).toString('hex')
  return `polenta-${device}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}-${suffix}`
}

export class AuthService {
  /** GH45 — hôtes dont l'accès a été constaté révoqué (401, compte désactivé), jusqu'à reconnexion. */
  private readonly revokedHosts = new Set<string>()
  /**
   * GH45 — page de changement de mot de passe annoncée par la forge lors de la dernière connexion
   * refusée (compte neuf). Seule URL que `openPasswordChange` accepte d'ouvrir : jamais une URL
   * fournie par le renderer.
   */
  private pendingPasswordChangeUrl: string | null = null
  /** GH51 — connexion au navigateur en cours (un seul flux à la fois). */
  private ssoPending: LoopbackCallback | null = null
  /** GH51 — renouvellements en vol, un par compte. */
  private readonly refreshing = new Map<string, Promise<string>>()

  constructor(private readonly host: HostContext) {}

  private get authFilePath(): string {
    return path.join(this.host.userDataDir, 'auth.json')
  }

  // ─── Token storage (keychain OS) ────────────────────────────────────────────

  async saveToken(remote: string, token: string): Promise<void> {
    const host = extractHost(remote)
    await this.host.tokenStore.set(host, token)
  }

  async saveTokenForUser(remote: string, username: string, token: string): Promise<void> {
    const host = extractHost(remote)
    await this.host.tokenStore.set(`${host}:${username}`, token)
  }

  async getToken(remote: string, username?: string): Promise<string | null> {
    const host = extractHost(remote)
    const account = username ? `${host}:${username}` : host
    return this.host.tokenStore.get(account)
  }

  async deleteToken(remote: string, username?: string): Promise<void> {
    const host = extractHost(remote)
    const account = username ? `${host}:${username}` : host
    await this.host.tokenStore.delete(account)
    if (username) await this.host.tokenStore.delete(`${account}#sso`)
  }

  // ─── Forges (GH45) ──────────────────────────────────────────────────────────

  /** Type de forge d'un serveur (écran de connexion). Erreur réseau → message lisible. */
  async detectForge(serverUrl: string): Promise<ForgeDetection> {
    try {
      return await detectForge(serverUrl)
    } catch (err) {
      throw new Error(isNetworkUnreachable(err) ? describeFetchError(err) : err instanceof Error ? err.message : String(err))
    }
  }

  /** Type de forge du compte enregistré pour l'hôte de `url`, `null` sans compte. */
  async providerKindForUrl(url: string): Promise<ForgeKind | null> {
    const account = await this.accountForHost(extractHost(url))
    return account?.provider ?? null
  }

  markAccessRevoked(host: string): void {
    this.revokedHosts.add(host)
  }

  isAccessRevoked(host: string): boolean {
    return this.revokedHosts.has(host)
  }

  clearAccessRevoked(host: string): void {
    this.revokedHosts.delete(host)
  }

  /**
   * Après un échec git inexpliqué vers une forge Forgejo/Gitea : l'accès est-il révoqué ? Un compte
   * désactivé ne produit pas de 401 côté git (HTTP 200 + page HTML), seule l'API le dit (§12).
   */
  async probeForgeAccess(remoteUrl: string): Promise<'ok' | 'revoked' | 'unknown'> {
    const account = await this.accountForHost(extractHost(remoteUrl))
    if (!account || account.provider !== 'forgejo') return 'unknown'
    const token = await this.tokenFor(account)
    if (!token) return 'unknown'
    return probeAccess(account.baseUrl, token)
  }

  /**
   * Connexion identifiant + mot de passe (+ 2FA) sur une forge Forgejo/Gitea : la forge crée un
   * jeton d'accès, seul conservé (TokenStore). Le mot de passe n'est ni stocké, ni journalisé, ni
   * renvoyé dans une erreur.
   */
  async loginWithPassword(serverUrl: string, login: string, password: string, otp?: string): Promise<PasswordLoginResult> {
    let detection: ForgeDetection
    try {
      detection = await detectForge(serverUrl)
    } catch (err) {
      if (isNetworkUnreachable(err)) return { status: 'network', message: describeFetchError(err) }
      return { status: 'not-a-forge' }
    }
    if (detection.provider !== 'forgejo') return { status: 'not-a-forge' }
    const created = await createAccessToken(detection.baseUrl, login.trim(), password, otp?.trim(), tokenName(this.host.deviceLabel))
    this.pendingPasswordChangeUrl = created.status === 'password-change-required' ? created.url : null
    if (created.status !== 'ok') return created
    try {
      return { status: 'ok', account: await this.persistToken(detection.baseUrl, created.token, 'forgejo') }
    } catch (err) {
      return { status: 'network', message: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * Ouvre dans le navigateur la page de changement de mot de passe annoncée par la forge lors de la
   * dernière connexion refusée — et seulement elle (aucun argument venant du renderer).
   */
  async openPasswordChange(): Promise<void> {
    if (!this.host.openExternal) throw new Error('Ouverture du navigateur indisponible sur cet hôte.')
    if (!this.pendingPasswordChangeUrl) throw new Error('Aucun changement de mot de passe en attente.')
    await this.host.openExternal(this.pendingPasswordChangeUrl)
  }

  /**
   * Compte courant, sans appel réseau : le compte par défaut s'il a un jeton, sinon le premier
   * compte qui en a un (même critère que `hasAnyAccount`) ; `null` si aucun compte n'est connecté.
   * GH343 — avec l'URL du remote d'un projet : le compte connecté de son hôte (celui des opérations
   * git), sinon le compte par défaut.
   */
  async currentAccount(remoteUrl?: string): Promise<ForgeAccount | null> {
    if (remoteUrl && /^https?:\/\//i.test(remoteUrl)) {
      const forHost = await this.accountForHost(extractHost(remoteUrl))
      if (forHost && (await this.tokenFor(forHost))) return toForgeAccount(forHost)
    }
    const account = await this.connectedAccount()
    return account ? toForgeAccount(account) : null
  }

  /** GH45 S2b — compte courant et son jeton (lecture de la configuration de la forge). */
  async currentAccountWithToken(): Promise<{ account: ForgeAccount; token: string } | null> {
    const account = await this.connectedAccount()
    if (!account) return null
    const token = await this.tokenFor(account)
    return token ? { account: toForgeAccount(account), token } : null
  }

  /** GH45 S4 — comptes Forgejo/Gitea connectés (avec jeton), compte par défaut en tête. */
  async forgeAccounts(): Promise<ForgeAccount[]> {
    return this.accountsOf(['forgejo'])
  }

  /** GH107 — comptes GitHub et Forgejo connectés (avec jeton), où créer ou adopter un repo. */
  async repoAccounts(): Promise<ForgeAccount[]> {
    return this.accountsOf(['github', 'forgejo'])
  }

  private async accountsOf(kinds: ForgeAccount['provider'][]): Promise<ForgeAccount[]> {
    const store = await this.readStore()
    const out: ForgeAccount[] = []
    for (const account of store.accounts.map(normalize)) {
      if (!kinds.includes(account.provider) || !(await this.tokenFor(account))) continue
      if (keyOf(account) === store.defaultAccount) out.unshift(toForgeAccount(account))
      else out.push(toForgeAccount(account))
    }
    return out
  }

  /** GH45 S4 — compte (par sa clé `<hôte>:<login>`) et son jeton ; `null` si inconnu ou déconnecté. */
  async accountWithTokenByKey(key: string): Promise<{ account: ForgeAccount; token: string } | null> {
    const store = await this.readStore()
    const stored = store.accounts.find(a => keyOf(a) === key)
    if (!stored) return null
    const account = normalize(stored)
    const token = await this.tokenFor(account)
    return token ? { account: toForgeAccount(account), token } : null
  }

  /** GH45 S4 — compte de l'hôte d'une URL de remote et son jeton (même choix que les opérations git). */
  async accountWithTokenForUrl(url: string): Promise<{ account: ForgeAccount; token: string } | null> {
    const account = await this.accountForHost(extractHost(url))
    if (!account) return null
    const token = await this.tokenFor(account)
    return token ? { account: toForgeAccount(account), token } : null
  }

  private async connectedAccount(): Promise<NormalizedAccount | null> {
    const store = await this.readStore()
    const ordered = [
      ...store.accounts.filter(a => keyOf(a) === store.defaultAccount),
      ...store.accounts.filter(a => keyOf(a) !== store.defaultAccount),
    ]
    for (const account of ordered) {
      const normalized = normalize(account)
      if (await this.tokenFor(normalized)) return normalized
    }
    return null
  }

  /**
   * Déconnexion du compte courant : jetons locaux supprimés, compte retiré d'auth.json, le suivant
   * devient compte par défaut. Le jeton reste valide côté forge (révocable dans ses paramètres) —
   * le supprimer exigerait le mot de passe.
   */
  async logout(key?: string): Promise<void> {
    const store = await this.readStore()
    // GH343 — compte désigné (celui du projet affiché dans la fenêtre), sinon le compte courant.
    // Compte désigné déjà retiré (déconnecté depuis une autre fenêtre) : rien à faire — surtout pas
    // déconnecter un autre compte à sa place.
    const chosen = key ? store.accounts.find(a => keyOf(a) === key) : undefined
    if (key && !chosen) return
    const account = chosen ??(await this.connectedAccount()) ?? store.accounts.find(a => keyOf(a) === store.defaultAccount) ?? store.accounts[0]
    if (!account) {
      // Jetons « nus » d'anciennes versions, sans compte : la déconnexion doit les retirer aussi.
      for (const h of LEGACY_BARE_TOKEN_HOSTS) await this.host.tokenStore.delete(h)
      return
    }
    const bare = await this.host.tokenStore.get(account.remoteHost)
    const own = await this.host.tokenStore.get(keyOf(account))
    await this.host.tokenStore.delete(keyOf(account))
    // GH51 — renouvellement (refresh token) du compte retiré.
    await this.host.tokenStore.delete(`${keyOf(account)}#sso`)
    // Le jeton « nu » de l'hôte n'est supprimé que s'il appartient à ce compte.
    if (bare && (bare === own || !store.accounts.some(a => keyOf(a) !== keyOf(account) && a.remoteHost === account.remoteHost))) {
      await this.host.tokenStore.delete(account.remoteHost)
    }
    const wasDefault = store.defaultAccount === keyOf(account)
    store.accounts = store.accounts.filter(a => keyOf(a) !== keyOf(account))
    if (wasDefault || !store.accounts.some(a => keyOf(a) === store.defaultAccount)) {
      store.defaultAccount = store.accounts[0] ? keyOf(store.accounts[0]) : null
    }
    await this.writeStore(store)
    await this.syncGitIdentity()
  }

  /**
   * GH337 P3 — `[user]` de la config globale de Polenta suit le compte actif (spec §2.2) : appelé à
   * chaque changement de compte (connexion, déconnexion), en plus de l'initialisation au démarrage.
   */
  private async syncGitIdentity(): Promise<void> {
    // GH337 revue — serveur web : config git partagée entre utilisateurs, aucune identité n'y est écrite.
    if (this.host.sharedGitConfig) return
    const account = await this.currentAccount().catch(() => null)
    refreshGitIdentity(account ? { name: account.name, email: account.email } : null)
  }

  // ─── Identity resolution ────────────────────────────────────────────────────

  async resolveIdentity(remote: string, token?: string): Promise<{ login: string; name: string; email: string }> {
    const host = extractHost(remote)
    const pat = token ?? (await this.getToken(remote))
    if (!pat) {
      throw new Error(`No token found for remote: ${remote}`)
    }
    const account = await this.accountForHost(host)
    const kind: ForgeKind = account?.provider ?? (isGithubHost(host) ? 'github' : 'generic')
    const provider = providerFor(kind)
    if (provider) return provider.resolveIdentity(account?.baseUrl ?? `https://${host}`, pat)
    // Hôte sans API connue (generic) — identité minimale, comme avant GH45.
    return { login: 'unknown', name: 'Unknown User', email: '' }
  }

  /**
   * GH29 — login under which the per-user `.{username}.pref` of `repoPath` is read and
   * written: the account of the project's `origin` host first, then the default account, then any
   * other account (GH45: no more hard-coded host list). Read from auth.json, no network call except
   * for a legacy bare token without account; `local` only when no account is connected. A real login
   * triggers the one-shot merge of `.local.pref` (cf. `migrateLocalPref`).
   */
  async projectUsername(repoPath: string): Promise<string> {
    const originUrl = await getOriginUrl(repoPath)
    const originHost = originUrl && /^https?:\/\//i.test(originUrl) ? extractHost(originUrl) : ''
    const store = await this.readStore()
    const defaultHost = store.accounts.find(a => keyOf(a) === store.defaultAccount)?.remoteHost ?? ''
    const hosts = [...new Set([originHost, defaultHost, ...store.accounts.map(a => a.remoteHost), ...LEGACY_BARE_TOKEN_HOSTS].filter(Boolean))]

    let username = 'local'
    for (const host of hosts) {
      const account = await this.accountForHost(host)
      if (account && (await this.tokenFor(account))) {
        username = account.username
        break
      }
      if (account || !(await this.host.tokenStore.get(host))) continue
      try {
        username = (await this.resolveIdentity(`https://${host}`)).login
        break
      } catch {
        // try next host
      }
    }

    migrateLocalPref(repoPath, username)
    return username
  }

  // ─── Author for git commits ─────────────────────────────────────────────────

  /**
   * Auteur des commits : GH45 — le compte de l'hôte d'`origin` d'abord (un commit poussé sur une
   * forge porte l'identité de ce compte, critère d'audit), puis le compte par défaut, puis git config.
   */
  async getAuthor(repoPath: string): Promise<GitAuthor> {
    try {
      const originUrl = await getOriginUrl(repoPath)
      if (originUrl && /^https?:\/\//i.test(originUrl)) {
        const account = await this.accountForHost(extractHost(originUrl))
        if (account?.name && account.email) return { name: account.name, email: account.email }
      }
      const store = await this.readStore()
      if (store.defaultAccount) {
        const account = store.accounts.find(a => keyOf(a) === store.defaultAccount)
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

    try {
      const name = await readGitConfig(repoPath, 'user.name')
      const email = await readGitConfig(repoPath, 'user.email')
      if (name && email) return { name, email }
    } catch {
      // fall through
    }

    // GH337 P3 — repli : identité globale du PC (après le dépôt et le compte actif).
    const pc = await this.pcIdentity()
    if (pc) return pc

    return this.defaultAuthor()
  }

  /**
   * Identité globale du compte Windows du poste (GH337 P3). Le serveur MCP ne l'utilise pas : ses
   * commits portent le `--user` qu'on lui donne (GH362), jamais le compte du poste.
   */
  protected async pcIdentity(): Promise<GitAuthor | null> {
    return pcGitIdentity().catch(() => null)
  }

  /** Auteur faute de compte et de config git (GH362 : le serveur MCP y met son `--user`). */
  protected defaultAuthor(): GitAuthor {
    return { name: `${BRAND.productName} User`, email: `user@${BRAND.id}.local` }
  }

  // ─── Credentials for git (serveur d'identifiants, GH337) ───────────────────

  async getHttpsCredentials(remote: string): Promise<{ username: string; password: string } | null> {
    const host = extractHost(remote)
    // Local/filesystem remotes (e.g. a Windows path used as `origin`) resolve to an empty
    // hostname — nothing to look up in the keychain, and keytar throws "Account is required"
    // if called with an empty account string.
    if (!host) return null
    const account = await this.accountForHost(host)
    if (account) {
      const token = await this.tokenFor(account)
      if (!token) return null
      return { username: account.username, password: token }
    }

    // No account in auth.json yet — try a bare token stored via saveToken()
    const token = await this.host.tokenStore.get(host)
    if (!token) return null
    return { username: 'git', password: token }
  }

  async hasAnyAccount(): Promise<boolean> {
    if (await this.connectedAccount()) return true
    for (const host of LEGACY_BARE_TOKEN_HOSTS) {
      if (await this.host.tokenStore.get(host)) return true
    }
    return false
  }

  /** Formulaire « jeton d'accès » (tout hôte) : type de forge détecté, identité vérifiée. */
  async setup(remote: string, pat: string): Promise<{ login: string; name: string; email: string }> {
    const detection = await this.detectForge(remote)
    const { login, name, email } = await this.persistToken(detection.baseUrl, pat, detection.provider)
    return { login, name, email }
  }

  // ─── Connexion par le navigateur (GH51) ────────────────────────────────────

  /**
   * GH51 — connexion au navigateur vers la forge Forgejo `defaultServer`, client public
   * `forgeSsoClientId` (PKCE S256, sans secret). La promesse se résout au retour de la forge, ou se
   * rejette avec un `SsoLoginError`. Un nouvel appel annule le flux en cours.
   */
  async ssoLogin(remote: string): Promise<ForgeAccount> {
    const clientId = this.host.machineConfig.forgeSsoClientId
    const configured = this.host.machineConfig.defaultServer
    if (!clientId || !configured) throw new SsoLoginError('not-configured')
    const requested = normalizeBaseUrl(remote)
    if (normalizeBaseUrl(configured) !== requested) throw new SsoLoginError('not-configured')
    const openExternal = this.host.openExternal
    if (!openExternal) throw new SsoLoginError('browser')

    let detection: ForgeDetection
    try {
      detection = await detectForge(requested)
    } catch (err) {
      throw new SsoLoginError(isNetworkUnreachable(err) ? 'network' : 'not-a-forge')
    }
    if (detection.provider !== 'forgejo') throw new SsoLoginError('not-a-forge')
    const baseUrl = detection.baseUrl

    this.ssoPending?.cancel()
    const pkce = newPkcePair()
    const state = newState()
    const callback = await startLoopbackCallback({ timeoutMs: SSO_TIMEOUT_MS })
    this.ssoPending = callback
    try {
      try {
        await openExternal(authorizeUrl({ baseUrl, clientId, redirectUri: callback.redirectUri, state, challenge: pkce.challenge }))
      } catch {
        throw new SsoLoginError('browser')
      }
      const params = await callback.result
      if (params.error) throw new SsoLoginError('denied')
      if (params.state !== state) throw new SsoLoginError('state')
      if (!params.code) throw new SsoLoginError('no-code')

      let tokens: SsoTokens
      try {
        tokens = await exchangeCode({ baseUrl, clientId, redirectUri: callback.redirectUri, code: params.code, verifier: pkce.verifier })
      } catch (err) {
        if (err instanceof OAuthTokenError) throw new SsoLoginError('exchange')
        throw new SsoLoginError(isNetworkUnreachable(err) ? 'network' : 'exchange')
      }
      try {
        return await this.persistToken(baseUrl, tokens.accessToken, 'forgejo', undefined, {
          clientId, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt,
        })
      } catch {
        throw new SsoLoginError('identity')
      }
    } finally {
      callback.cancel()
      if (this.ssoPending === callback) this.ssoPending = null
    }
  }

  /** GH51 — interrompt la connexion au navigateur en cours (bouton « Annuler »). */
  ssoCancel(): void {
    this.ssoPending?.cancel()
  }

  // ─── GitHub OAuth Device Flow ───────────────────────────────────────────────

  async startDeviceFlow(remote: string) {
    if (!isGithubHost(extractHost(remote))) {
      throw new Error('Device Flow disponible uniquement pour github.com')
    }
    const session = await startGithubDeviceFlow()
    if (!this.host.openExternal) throw new Error('Device Flow indisponible : cet hôte ne peut pas ouvrir de navigateur.')
    await this.host.openExternal(session.verificationUri)
    return session
  }

  async pollDeviceFlow(remote: string, deviceCode: string): Promise<DeviceFlowPollResult> {
    if (!isGithubHost(extractHost(remote))) {
      return { status: 'error', message: 'Device Flow disponible uniquement pour github.com' }
    }
    const poll = await pollGithubDeviceFlow(deviceCode)
    if (poll.status !== 'token') return poll
    try {
      const { login, name, email } = await this.persistToken(`https://${GITHUB_HOST}`, poll.token, 'github')
      return { status: 'success', identity: { login, name, email } }
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * GH44 — connexion avec un jeton obtenu hors de ce service (jeton OAuth2 de la session OIDC du
   * serveur web) : même enregistrement que les autres connexions (identité vérifiée, jetons, compte,
   * levée de la révocation).
   */
  async connectWithToken(serverUrl: string, token: string, kind: ForgeKind, identity?: ForgeIdentity): Promise<ForgeAccount> {
    return this.persistToken(serverUrl, token, kind, identity)
  }

  /**
   * Shared by setup() (PAT), pollDeviceFlow() (OAuth) and loginWithPassword() — resolve identity,
   * save token, persist account. GH45 — for a known forge (github, forgejo) an identity that can't
   * be resolved fails the login: no more « Git User » account, whose commits would be anonymous.
   * `generic` keeps the pre-GH45 fallback (bare token, minimal identity).
   */
  private async persistToken(
    remote: string, token: string, kind: ForgeKind, knownIdentity?: ForgeIdentity,
    sso?: { clientId: string; refreshToken?: string; expiresAt?: number },
  ): Promise<ForgeAccount> {
    const baseUrl = normalizeBaseUrl(remote)
    const host = extractHost(baseUrl)
    const provider = providerFor(kind)
    let identity: ForgeIdentity
    if (knownIdentity) {
      // Identité déjà vérifiée par l'appelant avec ce même jeton (connexion OIDC web, GH44).
      identity = knownIdentity
    } else if (provider) {
      try {
        identity = await provider.resolveIdentity(baseUrl, token)
      } catch (err) {
        const detail = isNetworkUnreachable(err) ? describeFetchError(err) : err instanceof Error ? err.message : String(err)
        throw new Error(`Impossible de vérifier votre identité sur ${host} : ${detail}`)
      }
    } else {
      // generic : identité minimale et compte enregistré, exactement comme avant GH45 (sans compte,
      // hasAnyAccount resterait faux et l'écran de connexion reviendrait en boucle).
      identity = { login: 'unknown', name: 'Unknown User', email: '' }
    }
    await this.host.tokenStore.set(host, token)
    await this.host.tokenStore.set(`${host}:${identity.login}`, token)
    // GH51 — un renouvellement n'existe que pour une connexion au navigateur avec refresh token ; toute
    // autre connexion (PAT, mot de passe, Device Flow) retire celui qui restait pour ce compte.
    const record = sso?.refreshToken ? { clientId: sso.clientId, refreshToken: sso.refreshToken, ...(sso.expiresAt ? { expiresAt: sso.expiresAt } : {}) } : null
    await this.writeSsoRecord(`${host}:${identity.login}`, record)
    const account: StoredAccount = {
      remoteHost: host, username: identity.login, name: identity.name, email: identity.email, provider: kind, baseUrl,
    }
    await this.saveAccount(account)
    this.clearAccessRevoked(host)
    return toForgeAccount(normalize(account))
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
    // Le compte qui vient de se logger devient le compte actif
    store.defaultAccount = keyOf(account)
    await this.writeStore(store)
    await this.syncGitIdentity()
  }

  async getDefaultAccount(): Promise<{ account: StoredAccount; token: string } | null> {
    const store = await this.readStore()
    const defaultKey = store.defaultAccount
    if (!defaultKey) return null
    const account = store.accounts.find(a => keyOf(a) === defaultKey)
    if (!account) return null
    const token = await this.getToken(`https://${account.remoteHost}`, account.username)
    if (!token) return null
    return { account, token }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Compte d'un hôte : le compte par défaut s'il est sur cet hôte, sinon le premier de l'hôte. */
  private async accountForHost(host: string): Promise<NormalizedAccount | null> {
    if (!host) return null
    const store = await this.readStore()
    const forHost = store.accounts.filter(a => a.remoteHost === host)
    const account = forHost.find(a => keyOf(a) === store.defaultAccount) ?? forHost[0]
    return account ? normalize(account) : null
  }

  /**
   * Jeton d'un compte, lu à chaque appel. GH51 — un compte connecté au navigateur est renouvelé ici
   * avant son expiration (60 s de marge) ; sans refresh token, le jeton est rendu tel quel et la forge
   * le refusera (401 → bannière de reconnexion).
   */
  private async tokenFor(account: StoredAccount): Promise<string | null> {
    const key = keyOf(account)
    const token = (await this.host.tokenStore.get(key)) ?? (await this.host.tokenStore.get(account.remoteHost))
    if (!token) return null
    const record = await this.ssoRecord(key)
    if (!record?.expiresAt || record.expiresAt - SSO_REFRESH_MARGIN_MS > Date.now()) return token
    return this.refreshSso({ key, host: account.remoteHost, baseUrl: account.baseUrl ?? `https://${account.remoteHost}` }, token)
  }

  /**
   * GH51 — après un 401 de la forge : renouvellement forcé d'un compte connecté au navigateur, pour
   * une seule relance de la requête. `null` si le compte n'a pas de refresh token ou si le
   * renouvellement est refusé (la révocation suit son cours).
   */
  async refreshAfterUnauthorized(account: ForgeAccount, stale: string): Promise<string | null> {
    const record = await this.ssoRecord(account.key)
    if (!record) return null
    const fresh = await this.refreshSso({ key: account.key, host: account.host, baseUrl: account.baseUrl }, stale)
    return fresh !== stale ? fresh : null
  }

  /** Un seul renouvellement en vol par compte : les appels concurrents attendent le même résultat. */
  private refreshSso(target: SsoTarget, stale: string): Promise<string> {
    const inFlight = this.refreshing.get(target.key)
    if (inFlight) return inFlight
    const promise: Promise<string> = this.runRefresh(target, stale).finally(() => {
      if (this.refreshing.get(target.key) === promise) this.refreshing.delete(target.key)
    })
    this.refreshing.set(target.key, promise)
    return promise
  }

  /**
   * Renouvellement : le jeton d'accès remplace l'ancien (clé du compte, et clé d'hôte si elle le
   * portait), le refresh token et l'expiration sont mis à jour. Refus 4xx : renouvellement retiré et
   * hôte marqué « à reconnecter ». Réseau ou 5xx : le jeton courant reste utilisé, sans erreur.
   * Aucun journal : ni jeton, ni refresh token.
   */
  private async runRefresh(target: SsoTarget, stale: string): Promise<string> {
    const record = await this.ssoRecord(target.key)
    if (!record) return stale
    let tokens: SsoTokens
    try {
      tokens = await refreshTokens({ baseUrl: target.baseUrl, clientId: record.clientId, refreshToken: record.refreshToken })
    } catch (err) {
      if (err instanceof OAuthTokenError && err.status >= 400 && err.status < 500) {
        await this.host.tokenStore.delete(`${target.key}#sso`)
        this.markAccessRevoked(target.host)
      }
      return stale
    }
    // Reconnexion pendant le renouvellement : ce sont les jetons de la nouvelle connexion qui valent.
    const current = await this.ssoRecord(target.key)
    if (current?.refreshToken !== record.refreshToken) return (await this.host.tokenStore.get(target.key)) ?? stale
    await this.host.tokenStore.set(target.key, tokens.accessToken)
    if ((await this.host.tokenStore.get(target.host)) === stale) await this.host.tokenStore.set(target.host, tokens.accessToken)
    await this.writeSsoRecord(target.key, {
      clientId: record.clientId,
      refreshToken: tokens.refreshToken ?? record.refreshToken,
      ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
    })
    return tokens.accessToken
  }

  /** Renouvellement d'un compte : `null` sans refresh token. Entrée `<clé>#sso` du magasin de jetons. */
  private async ssoRecord(accountKey: string): Promise<SsoRecord | null> {
    const raw = await this.host.tokenStore.get(`${accountKey}#sso`)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<SsoRecord>
      if (typeof parsed.clientId !== 'string' || typeof parsed.refreshToken !== 'string') return null
      return {
        clientId: parsed.clientId,
        refreshToken: parsed.refreshToken,
        ...(typeof parsed.expiresAt === 'number' ? { expiresAt: parsed.expiresAt } : {}),
      }
    } catch {
      return null
    }
  }

  /** Écrit le renouvellement d'un compte, ou le retire (`null`). */
  private async writeSsoRecord(accountKey: string, record: SsoRecord | null): Promise<void> {
    if (!record) {
      await this.host.tokenStore.delete(`${accountKey}#sso`)
      return
    }
    await this.host.tokenStore.set(`${accountKey}#sso`, JSON.stringify(record))
  }

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

async function getOriginUrl(repoPath: string): Promise<string | null> {
  try {
    const remotes = await gitFor(repoPath).remotes()
    return remotes.find(r => r.name === 'origin')?.url ?? null
  } catch {
    return null
  }
}

export function extractHost(remote: string): string {
  try {
    return new URL(remote).hostname
  } catch {
    return remote
  }
}

async function readGitConfig(repoPath: string, key: string): Promise<string | null> {
  // lecture de .git/config à la main (pas de processus git pour une clé de config simple)
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
