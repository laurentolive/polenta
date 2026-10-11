import { randomBytes } from 'crypto'
import * as path from 'path'
import { E2E } from './env'
import { oauthApp, unbanSelf, uploadSetupScript } from '../../e2e-desktop/support/forge'

/**
 * GH44 S3 — second serveur web des tests, en mode **oidc**, branché sur la forge de test du kit
 * `deploy/` (instance `acme` par défaut, comme `e2e-desktop/` de #45). Actif seulement si
 * `POLENTA_E2E_SSH` est défini ; sinon les tests `s3-*.spec.ts` sont ignorés.
 *
 * L'application OAuth2 est (re)créée une fois par exécution, par le process principal de
 * Playwright (`prepareOidcApp`, appelé par la config) ; ses identifiants passent aux workers par
 * l'environnement.
 */
const oidcPort = Number(process.env['POLENTA_E2E_OIDC_PORT'] ?? 8796)

export const OIDC = {
  enabled: Boolean(process.env['POLENTA_E2E_SSH']),
  baseUrl: `http://127.0.0.1:${oidcPort}`,
  dataDir: path.join(E2E.root, 'data-oidc'),
  get forgeUrl(): string { return process.env['POLENTA_E2E_OIDC_FORGE'] ?? '' },
  get serverEnv(): Record<string, string> {
    const forgeHost = new URL(this.forgeUrl).hostname
    return {
      POLENTA_WEB_AUTH: 'oidc',
      POLENTA_WEB_PORT: String(oidcPort),
      POLENTA_WEB_DATA_DIR: this.dataDir,
      POLENTA_WEB_PUBLIC_URL: this.baseUrl,
      POLENTA_WEB_DEFAULT_SERVER: this.forgeUrl,
      POLENTA_WEB_OIDC_CLIENT_ID: process.env['POLENTA_E2E_OIDC_CLIENT_ID'] ?? '',
      POLENTA_WEB_OIDC_CLIENT_SECRET: process.env['POLENTA_E2E_OIDC_CLIENT_SECRET'] ?? '',
      POLENTA_WEB_SESSION_SECRET: process.env['POLENTA_E2E_OIDC_SESSION_SECRET'] ?? '',
      POLENTA_WEB_GIT_HOSTS: forgeHost,
      POLENTA_WEB_LOG_LEVEL: 'warn',
      POLENTA_E2E_RUN: process.env['POLENTA_E2E_RUN']!,
    }
  },
}

/** Process principal uniquement : application OAuth2 pointant vers le serveur oidc local. */
export function prepareOidcApp(): void {
  if (!OIDC.enabled || process.env['POLENTA_E2E_OIDC_CLIENT_ID']) return
  unbanSelf()
  uploadSetupScript()
  const app = oauthApp('polenta-web-e2e', `${OIDC.baseUrl}/auth/callback`)
  process.env['POLENTA_E2E_OIDC_CLIENT_ID'] = app.clientId
  process.env['POLENTA_E2E_OIDC_CLIENT_SECRET'] = app.clientSecret
  process.env['POLENTA_E2E_OIDC_FORGE'] = app.baseUrl
  process.env['POLENTA_E2E_OIDC_SESSION_SECRET'] = randomBytes(32).toString('hex')
}
