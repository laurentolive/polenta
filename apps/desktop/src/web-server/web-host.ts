import type { MachineConfig } from '@polenta/types'
import type { HostContext, TokenStore } from '../main/host/host-context'
import type { PlatformHost } from '../main/host/platform-host'
import type { PrintRenderer } from '../main/host/print-renderer'
import { revokedError } from '../main/services/forge/forge-access'
import { OidcTokenError, type OidcTokens } from './auth/oidc'

/**
 * GH44 — jetons forge d'un utilisateur web : en mémoire uniquement (design D10), jamais persistés
 * ni renvoyés au navigateur. Alimenté à la connexion ; un redémarrage du serveur impose de se
 * reconnecter.
 */
export class MemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, string>()
  async get(account: string): Promise<string | null> {
    return this.tokens.get(account) ?? null
  }
  async set(account: string, token: string): Promise<void> {
    this.tokens.set(account, token)
  }
  async delete(account: string): Promise<boolean> {
    return this.tokens.delete(account)
  }
  clear(): void {
    this.tokens.clear()
  }
}

/**
 * GH44 S3 — jetons d'un utilisateur connecté par OIDC : le jeton d'accès OAuth2 de la session sert
 * directement à git et à l'API de la forge (mesuré par #45). Il est rafraîchi par le
 * `refresh_token` une minute avant son expiration (un seul rafraîchissement à la fois) ; un
 * rafraîchissement refusé par la forge révoque l'accès (`onRevoked`) et lève l'erreur d'accès 401
 * de #45, dont le marqueur fait invalider la session par le serveur.
 */
export class SessionTokenStore extends MemoryTokenStore {
  private oauth: { host: string; login: string; tokens: OidcTokens } | null = null
  private refreshing: { oauth: object; promise: Promise<string> } | null = null
  /**
   * Génération des jetons : incrémentée à chaque connexion. Une erreur d'accès survenue avec des
   * jetons d'une génération antérieure ne doit jamais révoquer la connexion suivante.
   */
  epoch = 0

  constructor(
    private readonly refresher?: (refreshToken: string) => Promise<OidcTokens>,
    private readonly onRevoked?: () => void,
  ) {
    super()
  }

  setOAuth(host: string, login: string, tokens: OidcTokens): void {
    this.epoch++
    this.oauth = { host, login, tokens }
    this.refreshing = null
  }

  hasOAuth(): boolean {
    return this.oauth !== null
  }

  private isOAuthAccount(account: string): boolean {
    const o = this.oauth
    return !!o && (account === o.host || account === `${o.host}:${o.login}`)
  }

  override async get(account: string): Promise<string | null> {
    if (this.isOAuthAccount(account)) return this.freshAccessToken()
    return super.get(account)
  }

  /** Les jetons OAuth vivent dans `oauth` seulement (pas de copie qui survivrait aux rafraîchissements). */
  override async set(account: string, token: string): Promise<void> {
    if (this.isOAuthAccount(account)) return
    return super.set(account, token)
  }

  override clear(): void {
    super.clear()
    this.oauth = null
  }

  /** Jeton d'accès valide pour encore une minute au moins (rafraîchi au besoin). */
  freshAccessToken(): Promise<string> {
    const o = this.oauth
    if (!o) return Promise.reject(new Error('Aucune session OAuth'))
    const { expiresAt, refreshToken, accessToken } = o.tokens
    if (!expiresAt || expiresAt - 60_000 > Date.now() || !refreshToken || !this.refresher) return Promise.resolve(accessToken)
    // Un rafraîchissement en cours n'est partagé que pour les mêmes jetons (pas après une reconnexion).
    if (this.refreshing?.oauth === o) return this.refreshing.promise
    const promise = this.refresher(refreshToken)
      .then(tokens => {
        // Certaines forges ne renvoient pas de nouveau refresh_token : l'ancien reste valable.
        o.tokens = { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken }
        // Jetons remplacés pendant le rafraîchissement (reconnexion) : ce sont les nouveaux qui valent.
        return this.oauth === o ? o.tokens.accessToken : this.freshAccessToken()
      })
      .catch(err => {
        if (this.oauth !== o) return this.freshAccessToken()
        if (err instanceof OidcTokenError && err.status >= 400 && err.status < 500) {
          this.clear()
          this.onRevoked?.()
          throw revokedError(o.host)
        }
        // Forge injoignable : on tente avec le jeton actuel, git ou l'API diront s'il est refusé.
        return accessToken
      })
      .finally(() => { if (this.refreshing?.promise === promise) this.refreshing = null })
    this.refreshing = { oauth: o, promise }
    return promise
  }
}

/** Pas d'`openExternal` ni de `mcpServerLaunch` : sans objet côté serveur. */
export function createWebHostContext(userDataDir: string, tokenStore: TokenStore, machineConfig: MachineConfig): HostContext {
  return { userDataDir, tokenStore, machineConfig, deviceLabel: 'web' }
}

export function createWebPlatformHost(
  broadcast: (channel: string, ...args: unknown[]) => void,
  exportTemplateExamplesDir: string,
): PlatformHost {
  return { kind: 'web', broadcast, exportTemplateExamplesDir: () => exportTemplateExamplesDir }
}

/**
 * Sprint 2 : pas encore de rendu des routes `/print/*` côté serveur (Chromium headless : sprint 4).
 * L'export PDF échoue avec un message explicite ; les diagrammes d'un export par gabarit passent
 * par le repli texte prévu par GH34 (carte vide = « non rendu »).
 */
export const pendingPrintRenderer: PrintRenderer = {
  renderPdf: async () => {
    throw new Error('L’export PDF n’est pas encore disponible dans la version web.')
  },
  snapshotDrawios: async () => new Map(),
}
