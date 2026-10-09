import * as path from 'path'

/**
 * GH44 — configuration du serveur web, lue depuis l'environnement (specs/GH44-design.md §6.3).
 * Sprint 2 : seul le mode `dev` (un utilisateur fixe, jeton en variable d'environnement) existe ;
 * l'authentification OIDC par la forge arrive au sprint 3.
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
  /** Hôtes git que le serveur peut contacter (clone/fetch/push) — défaut : hôte de la forge. */
  gitHosts: string[]
  gitAllowHttp: boolean
  /** Cookies `Secure` (HTTPS) — faux uniquement en développement local. */
  secureCookies: boolean
  auth: DevAuthConfig
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

/** Identifiant de forge utilisable comme nom de dossier (design §4.3). */
export const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

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

export function loadConfig(appRoot: string): WebConfig {
  const authMode = env('POLENTA_WEB_AUTH', 'dev')
  if (authMode !== 'dev') {
    throw new Error(`POLENTA_WEB_AUTH=${authMode} : seul le mode « dev » est disponible (OIDC : sprint 3 de GH44).`)
  }
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('POLENTA_WEB_AUTH=dev est interdit avec NODE_ENV=production.')
  }
  const login = env('POLENTA_WEB_DEV_LOGIN').toLowerCase()
  if (!LOGIN_PATTERN.test(login)) throw new Error(`POLENTA_WEB_DEV_LOGIN invalide : « ${login} » ([a-z0-9._-])`)

  const staticDir = process.env['POLENTA_WEB_STATIC_DIR'] ?? path.join(appRoot, 'out', 'web')
  return {
    port: int('POLENTA_WEB_PORT', 8787),
    host: env('POLENTA_WEB_HOST', '127.0.0.1'),
    dataDir: path.resolve(env('POLENTA_WEB_DATA_DIR', path.join(appRoot, '.web-data'))),
    staticDir: process.env['POLENTA_WEB_NO_STATIC'] ? null : staticDir,
    resourcesDir: env('POLENTA_WEB_RESOURCES_DIR', path.join(appRoot, 'resources')),
    sessionSecret: env('POLENTA_WEB_SESSION_SECRET', 'dev-only-insecure-secret-change-me-0123456789'),
    sessionHours: int('POLENTA_WEB_SESSION_HOURS', 12),
    idleMinutes: int('POLENTA_WEB_IDLE_MINUTES', 30),
    maxUploadMb: int('POLENTA_WEB_MAX_UPLOAD_MB', 20),
    secureCookies: env('POLENTA_WEB_SECURE_COOKIES', 'false') === 'true',
    gitHosts: env('POLENTA_WEB_GIT_HOSTS', new URL(env('POLENTA_WEB_DEV_REMOTE', 'https://github.com')).hostname)
      .split(',').map(h => h.trim()).filter(Boolean),
    gitAllowHttp: env('POLENTA_WEB_GIT_ALLOW_HTTP', 'false') === 'true',
    auth: {
      mode: 'dev',
      login,
      name: env('POLENTA_WEB_DEV_NAME', login),
      email: env('POLENTA_WEB_DEV_EMAIL', `${login}@localhost`),
      remote: env('POLENTA_WEB_DEV_REMOTE', 'https://github.com'),
      token: env('POLENTA_WEB_DEV_TOKEN', ''),
    },
  }
}
