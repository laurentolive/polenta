import * as path from 'path'
import type { MachineConfig } from '@polenta/types'
import { isGithubHost } from '../main/services/forge/github.provider'

/**
 * GH44 — configuration du serveur web, lue depuis l'environnement (specs/GH44-design.md §6.3,
 * révisé §10). Deux modes d'authentification :
 * - `oidc` (production) : connexion par la forge Forgejo de l'instance (OAuth2/OIDC + PKCE) ;
 * - `dev` : un utilisateur fixe, jeton en variable d'environnement — développement et tests e2e
 *   sans forge, interdit avec `NODE_ENV=production`.
 */
export interface WebConfig {
  port: number
  host: string
  dataDir: string
  /** Build web du renderer (`out/web`) ; absent → aucun fichier statique servi (dev : Vite). */
  staticDir: string | null
  resourcesDir: string
  sessionSecret: string
  sessionHours: number
  idleMinutes: number
  maxUploadMb: number
  /** Utilisateurs dont les services restent en mémoire en même temps (design §5.3). */
  maxActiveUsers: number
  /** GH44 S4 — impression (PDF, diagrammes d'un export par gabarit) par Chromium headless. */
  print: boolean
  /** Hôtes git que le serveur peut contacter (clone/fetch/push) — défaut : hôte de la forge. */
  gitHosts: string[]
  gitAllowHttp: boolean
  /** Cookies `Secure` (HTTPS) — faux uniquement en développement local. */
  secureCookies: boolean
  auth: DevAuthConfig | OidcAuthConfig
  /** GH45 — équivalent web de la configuration machine du desktop (POLENTA_WEB_DEFAULT_SERVER…). */
  machineConfig: MachineConfig
  /**
   * GH63 — API d'administration du serveur (service interne `polenta-admin`) : absente = `/admin/*` en
   * 404. `dev` : autorisée en mode d'authentification dev (tests), jamais avec NODE_ENV=production.
   */
  admin?: AdminConfig | null
}

export interface AdminConfig {
  url: string
  serviceToken: string
  dev: boolean
}

export interface DevAuthConfig {
  mode: 'dev'
  login: string
  name: string
  email: string
  /** Remote git dont le jeton est fourni (`https://github.com/…`, forge…) ; détermine l'hôte. */
  remote: string
  token: string
}

export interface OidcAuthConfig {
  mode: 'oidc'
  /** Forge Forgejo/Gitea de l'instance : émetteur OIDC et forge par défaut (scheme + hôte). */
  forgeUrl: string
  clientId: string
  clientSecret: string
  /** URL publique du serveur web (adresse de retour `…/auth/callback`). */
  publicUrl: string
}

/** Identifiant de forge utilisable comme nom de dossier (design §4.3). */
export const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Secret de session du mode dev — jamais accepté en mode oidc. */
const DEV_SESSION_SECRET = 'dev-only-insecure-secret-change-me-0123456789'

function env(name: string, fallback?: string): string {
  const v = process.env[name]
  if (v !== undefined && v !== '') return v
  if (fallback !== undefined) return fallback
  throw new Error(`Variable d'environnement manquante : ${name}`)
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} doit être un entier positif (reçu « ${raw} »)`)
  return n
}

function origin(name: string, value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} invalide : « ${value} » (URL attendue)`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${name} : http(s) attendu`)
  return url.origin
}

function loadAuth(): DevAuthConfig | OidcAuthConfig {
  const mode = env('POLENTA_WEB_AUTH', 'dev')
  if (mode === 'oidc') {
    return {
      mode: 'oidc',
      forgeUrl: origin('POLENTA_WEB_DEFAULT_SERVER', env('POLENTA_WEB_DEFAULT_SERVER')),
      clientId: env('POLENTA_WEB_OIDC_CLIENT_ID'),
      clientSecret: env('POLENTA_WEB_OIDC_CLIENT_SECRET'),
      publicUrl: origin('POLENTA_WEB_PUBLIC_URL', env('POLENTA_WEB_PUBLIC_URL')),
    }
  }
  if (mode !== 'dev') throw new Error(`POLENTA_WEB_AUTH=${mode} : « oidc » ou « dev » attendu.`)
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('POLENTA_WEB_AUTH=dev est interdit avec NODE_ENV=production.')
  }
  const login = env('POLENTA_WEB_DEV_LOGIN').toLowerCase()
  if (!LOGIN_PATTERN.test(login)) throw new Error(`POLENTA_WEB_DEV_LOGIN invalide : « ${login} » ([a-z0-9._-])`)
  return {
    mode: 'dev',
    login,
    name: env('POLENTA_WEB_DEV_NAME', login),
    email: env('POLENTA_WEB_DEV_EMAIL', `${login}@localhost`),
    remote: env('POLENTA_WEB_DEV_REMOTE', 'https://github.com'),
    token: env('POLENTA_WEB_DEV_TOKEN', ''),
  }
}

export function loadConfig(appRoot: string): WebConfig {
  const auth = loadAuth()
  const admin = loadAdmin(auth.mode)
  const forgeUrl = auth.mode === 'oidc' ? auth.forgeUrl : auth.remote
  const staticDir = process.env['POLENTA_WEB_STATIC_DIR'] ?? path.join(appRoot, 'out', 'web')
  const gitHosts = env('POLENTA_WEB_GIT_HOSTS', new URL(forgeUrl).hostname)
    .split(',').map(h => h.trim()).filter(Boolean)
  const sessionSecret = env('POLENTA_WEB_SESSION_SECRET', auth.mode === 'dev' ? DEV_SESSION_SECRET : undefined)
  if (auth.mode === 'oidc' && (sessionSecret === DEV_SESSION_SECRET || sessionSecret.length < 32)) {
    throw new Error('POLENTA_WEB_SESSION_SECRET : 32 caractères aléatoires au moins en mode oidc.')
  }
  const secureDefault = auth.mode === 'oidc' && auth.publicUrl.startsWith('https:') ? 'true' : 'false'
  return {
    port: int('POLENTA_WEB_PORT', 8787),
    host: env('POLENTA_WEB_HOST', '127.0.0.1'),
    dataDir: path.resolve(env('POLENTA_WEB_DATA_DIR', path.join(appRoot, '.web-data'))),
    staticDir: process.env['POLENTA_WEB_NO_STATIC'] ? null : staticDir,
    resourcesDir: env('POLENTA_WEB_RESOURCES_DIR', path.join(appRoot, 'resources')),
    sessionSecret,
    sessionHours: int('POLENTA_WEB_SESSION_HOURS', 12),
    idleMinutes: int('POLENTA_WEB_IDLE_MINUTES', 30),
    maxUploadMb: int('POLENTA_WEB_MAX_UPLOAD_MB', 20),
    maxActiveUsers: int('POLENTA_WEB_MAX_ACTIVE_USERS', 50),
    print: env('POLENTA_WEB_PRINT', 'true') !== 'false',
    secureCookies: env('POLENTA_WEB_SECURE_COOKIES', secureDefault) === 'true',
    gitHosts,
    gitAllowHttp: env('POLENTA_WEB_GIT_ALLOW_HTTP', 'false') === 'true',
    auth,
    machineConfig: webMachineConfig(gitHosts),
    admin,
  }
}

/**
 * GH45 — forge par défaut du serveur web : `POLENTA_WEB_DEFAULT_SERVER`, sinon le premier hôte git
 * autorisé (en https). GitHub n'est proposé que si la forge par défaut est github.com.
 */
export function webMachineConfig(gitHosts: string[]): MachineConfig {
  const explicit = process.env['POLENTA_WEB_DEFAULT_SERVER']
  const defaultServer = explicit ? new URL(explicit).origin : gitHosts[0] ? `https://${gitHosts[0]}` : undefined
  const demo = process.env['POLENTA_WEB_DEMO_PROJECT_URL']
  return {
    ...(defaultServer ? { defaultServer } : {}),
    hideGithub: !defaultServer || !isGithubHost(new URL(defaultServer).hostname),
    ...(demo ? { demoProjectUrl: demo } : {}),
  }
}

/**
 * GH63 — API d'administration (POLENTA_ADMIN_URL + POLENTA_ADMIN_SERVICE_TOKEN, écrits dans web.env
 * par le kit quand ADMIN_UI=on). En mode dev, seulement avec POLENTA_WEB_ADMIN_DEV=1, refusé au
 * démarrage avec NODE_ENV=production.
 */
export function loadAdmin(authMode: 'dev' | 'oidc'): AdminConfig | null {
  const devFlag = process.env['POLENTA_WEB_ADMIN_DEV'] === '1'
  if (devFlag && process.env['NODE_ENV'] === 'production') {
    throw new Error('POLENTA_WEB_ADMIN_DEV=1 est interdit avec NODE_ENV=production.')
  }
  const url = process.env['POLENTA_ADMIN_URL']
  if (!url) return null
  const serviceToken = env('POLENTA_ADMIN_SERVICE_TOKEN')
  if (serviceToken.length < 32) throw new Error('POLENTA_ADMIN_SERVICE_TOKEN : 32 caractères au moins.')
  if (authMode === 'dev' && !devFlag) return null
  return { url: origin('POLENTA_ADMIN_URL', url), serviceToken, dev: authMode === 'dev' }
}
