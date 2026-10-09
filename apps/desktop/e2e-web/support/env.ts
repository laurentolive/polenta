import * as os from 'os'
import * as path from 'path'

/**
 * GH44 — environnement des tests e2e web, partagé par la config, le global setup et les tests.
 * Un dossier par exécution (`POLENTA_E2E_RUN`, fixé par le process principal et hérité par les
 * workers) : rien n'est jamais effacé sous un serveur déjà démarré.
 */
if (!process.env['POLENTA_E2E_RUN']) process.env['POLENTA_E2E_RUN'] = `${Date.now()}`

const root = path.join(os.tmpdir(), 'polenta-e2e-web', process.env['POLENTA_E2E_RUN'])
const port = Number(process.env['POLENTA_E2E_PORT'] ?? 8797)
const gitPort = Number(process.env['POLENTA_E2E_GIT_PORT'] ?? 8798)

export const E2E = {
  root,
  dataDir: path.join(root, 'data'),
  remotesDir: path.join(root, 'remotes'),
  downloadsDir: path.join(root, 'downloads'),
  baseUrl: `http://127.0.0.1:${port}`,
  gitPort,
  gitBaseUrl: `http://127.0.0.1:${gitPort}`,
  demoRemote: `http://127.0.0.1:${gitPort}/demo-ll800-produit.git`,
  demoSource: process.env['POLENTA_E2E_DEMO_SOURCE'] ?? 'https://github.com/laurentolive/demo-ll800-produit.git',
  user: { login: 'e2e', name: 'E2E Tester', email: 'e2e@polenta.test' },
  get serverEnv(): Record<string, string> {
    return {
      POLENTA_WEB_PORT: String(port),
      POLENTA_WEB_DATA_DIR: this.dataDir,
      POLENTA_WEB_DEV_LOGIN: this.user.login,
      POLENTA_WEB_DEV_NAME: this.user.name,
      POLENTA_WEB_DEV_EMAIL: this.user.email,
      POLENTA_WEB_DEV_REMOTE: this.gitBaseUrl,
      POLENTA_WEB_DEV_TOKEN: 'e2e-token',
      // Forge locale + GitHub en lecture : la démo déclare des dépendances hébergées sur GitHub.
      POLENTA_WEB_GIT_HOSTS: '127.0.0.1,github.com',
      POLENTA_WEB_GIT_ALLOW_HTTP: 'true',
      POLENTA_WEB_LOG_LEVEL: 'warn',
      POLENTA_E2E_RUN: process.env['POLENTA_E2E_RUN']!,
    }
  },
}
