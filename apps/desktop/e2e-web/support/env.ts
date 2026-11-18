import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * GH44 — environnement des tests e2e web, partagé par la config, le global setup et les tests.
 * Un dossier par exécution (`POLENTA_E2E_RUN`, fixé par le process principal et hérité par les
 * workers) : rien n'est jamais effacé sous un serveur déjà démarré.
 *
 * GH387 — une pile par worker (`support/stack.ts`) : serveur web, forge git, faux service
 * d'administration et dossiers propres, décrits dans `<run>/stacks.json` par le global setup. Les
 * champs propres à la pile lisent l'entrée du worker courant (`TEST_PARALLEL_INDEX`, stable quand
 * un worker redémarre après un échec).
 */
if (!process.env['POLENTA_E2E_RUN']) process.env['POLENTA_E2E_RUN'] = `${Date.now()}`

const root = path.join(os.tmpdir(), 'polenta-e2e-web', process.env['POLENTA_E2E_RUN'])

export interface StackInfo {
  index: number
  root: string
  dataDir: string
  remotesDir: string
  downloadsDir: string
  port: number
  gitPort: number
  adminPort: number
}

export const STACKS_FILE = path.join(root, 'stacks.json')

let stacks: StackInfo[] | null = null

/** Pile du worker courant (worker 0 dans le process principal, après le global setup). */
export function currentStack(): StackInfo {
  stacks ??= JSON.parse(fs.readFileSync(STACKS_FILE, 'utf-8')) as StackInfo[]
  const index = Number(process.env['TEST_PARALLEL_INDEX'] ?? 0)
  const stack = stacks[index]
  if (!stack) throw new Error(`e2e : pas de pile pour le worker ${index} (${STACKS_FILE})`)
  return stack
}

/** Pile du worker courant, ou `null` avant le global setup (chargement de la config). */
function maybeStack(): StackInfo | null {
  return fs.existsSync(STACKS_FILE) ? currentStack() : null
}

const user = { login: 'e2e', name: 'E2E Tester', email: 'e2e@polenta.test' }
const adminToken = 'e2e-admin-service-token-0123456789abcdef'

export const E2E = {
  /** Dossier de l'exécution (toutes les piles). */
  root,
  get dataDir(): string { return currentStack().dataDir },
  get remotesDir(): string { return currentStack().remotesDir },
  get downloadsDir(): string { return currentStack().downloadsDir },
  /** URL du serveur web du worker (`''` avant le global setup : chargement de la config par le runner). */
  get baseUrl(): string {
    const stack = maybeStack()
    return stack ? `http://127.0.0.1:${stack.port}` : ''
  },
  get gitPort(): number { return currentStack().gitPort },
  get gitBaseUrl(): string { return `http://127.0.0.1:${currentStack().gitPort}` },
  get demoRemote(): string { return `${this.gitBaseUrl}/demo-ll800-produit.git` },
  demoSource: process.env['POLENTA_E2E_DEMO_SOURCE'] ?? 'https://github.com/laurentolive/demo-ll800-produit.git',
  user,
  get adminPort(): number { return currentStack().adminPort },
  get adminUrl(): string { return `http://127.0.0.1:${currentStack().adminPort}` },
  adminToken,
}

/** Environnement du serveur web d'une pile. */
export function serverEnv(stack: StackInfo): Record<string, string> {
  return {
    POLENTA_WEB_PORT: String(stack.port),
    POLENTA_WEB_DATA_DIR: stack.dataDir,
    POLENTA_WEB_DEV_LOGIN: user.login,
    POLENTA_WEB_DEV_NAME: user.name,
    POLENTA_WEB_DEV_EMAIL: user.email,
    POLENTA_WEB_DEV_REMOTE: `http://127.0.0.1:${stack.gitPort}`,
    POLENTA_WEB_DEV_TOKEN: 'e2e-token',
    // Forge locale + GitHub en lecture : la démo déclare des dépendances hébergées sur GitHub.
    POLENTA_WEB_GIT_HOSTS: '127.0.0.1,github.com',
    POLENTA_WEB_GIT_ALLOW_HTTP: 'true',
    POLENTA_WEB_LOG_LEVEL: 'warn',
    // GH302 — pas de vérification de la dernière release (réseau, badge imprévu) ; simulée par gh302-update.
    POLENTA_WEB_UPDATE_CHECK: 'false',
    POLENTA_E2E_RUN: process.env['POLENTA_E2E_RUN']!,
    // GH63 — administration du serveur contre un faux service (support/fake-admin-service.mjs).
    POLENTA_WEB_ADMIN_DEV: '1',
    POLENTA_ADMIN_URL: `http://127.0.0.1:${stack.adminPort}`,
    POLENTA_ADMIN_SERVICE_TOKEN: adminToken,
  }
}
