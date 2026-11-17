import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { E2E, currentStack } from './env'
import { collectErrors, invoke, rpc } from './helpers'

export interface ProjectInfo {
  /** Dossier du workspace (contient `.polenta/workspace.yaml`), sous « Mes projets ». */
  workspaceDir: string
  /** Repo racine du projet (exigences, tests, schéma). */
  localPath: string
  name: string
}

export interface SessionOptions {
  /** Projet à cloner depuis la forge locale et à ouvrir avant les tests (défaut : la démo). `null` :
   *  aucun, et `/` mène à l'accueil (dernier projet ouvert oublié, GH328). */
  project?: { repo: string; name?: string } | null
  /** Contrôle « aucune erreur console » après chaque test (défaut : true). */
  checkConsole?: boolean
}

/**
 * Session de test réutilisable : un navigateur connecté au serveur web (mode dev), un projet
 * fraîchement cloné et ouvert, et le contrôle des erreurs console après chaque test.
 *
 * À appeler en tête d'un fichier de test, hors de tout `test()` — elle déclare les hooks
 * `beforeAll` / `afterEach` / `afterAll` et force l'exécution en série du fichier :
 *
 * ```ts
 * const s = setupSession()
 * test('…', async () => {
 *   await s.openView('Exigences')
 *   const reqs = await s.invoke('requirements:list', s.project.localPath)
 * })
 * ```
 *
 * Chaque fichier clone son propre projet (dossier distinct) depuis le même repo nu : les fichiers
 * sont indépendants, mais voient les publications des fichiers exécutés avant eux.
 */
export function setupSession(options: SessionOptions = {}) {
  const projectSpec = options.project === undefined ? { repo: 'demo-ll800-produit' } : options.project
  const checkConsole = options.checkConsole ?? true
  let context: BrowserContext
  let page: Page
  let errors: string[] = []
  let project: ProjectInfo | null = null
  const allowed: RegExp[] = []

  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ browser }: { browser: Browser }, testInfo) => {
    const t = timer()
    context = await browser.newContext({ acceptDownloads: true, baseURL: E2E.baseUrl })
    page = await context.newPage()
    errors = collectErrors(page)
    t.lap('context')
    // GH387 — connexion et préparation du projet par requêtes, sans charger l'application : elle
    // n'est chargée qu'une fois, sur la page de départ (dashboard du projet ou accueil).
    const login = await context.request.get('/auth/login', { maxRedirects: 0 })
    if (login.status() !== 302) throw new Error(`/auth/login : ${login.status()}`)
    t.lap('login')
    if (projectSpec) project = await prepareAndOpen(page, projectSpec.repo, projectSpec.name ?? projectSpec.repo, t)
    else {
      // GH328 — sans projet : `/` rouvrirait le dernier projet ouvert par la spec précédente (mémorisé
      // côté serveur pour l'utilisateur e2e) au lieu de l'accueil.
      await rpc(context, 'workspace:clear-last-opened')
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      t.lap('goto')
    }
    t.record(testInfo.file, 'beforeAll')
  })

  test.afterEach(async () => {
    if (!checkConsole) return
    const unexpected = errors.filter(e => !allowed.some(r => r.test(e)))
    errors.length = 0
    allowed.length = 0
    expect(unexpected, unexpected.join('\n')).toEqual([])
  })

  test.afterAll(async ({}, testInfo) => {
    const t = timer()
    await context?.close()
    t.lap('close')
    t.record(testInfo.file, 'afterAll')
  })

  return {
    get context(): BrowserContext { return context },
    get page(): Page { return page },
    get project(): ProjectInfo {
      if (!project) throw new Error('setupSession({ project: null }) : aucun projet ouvert')
      return project
    },
    /** Appel d'un channel via le bridge de la page (même chemin que les composants). */
    invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
      return invoke<T>(page, channel, ...args)
    },
    /** Erreurs console attendues dans le test courant (ex. coupure réseau simulée). */
    allowConsoleErrors(...patterns: RegExp[]): void {
      allowed.push(...patterns)
    },
    /** Erreurs console relevées depuis le début du test courant. */
    consoleErrors(): string[] {
      return [...errors]
    },
    /** URL d'une route du projet ouvert (`/dashboard`, `/requirements`, …). */
    projectUrl(route: string, search: Record<string, string> = {}): string {
      const params = new URLSearchParams({ projectId: projectIdOf(this.project.workspaceDir), ...search })
      return `${route}?${params}`
    },
    /** Ouvre une vue par le bouton de la barre d'activité (titre exact : « Exigences », « Suivi »…). */
    async openView(title: string): Promise<void> {
      await page.keyboard.press('Escape')
      const button = activityBar(page).and(page.locator(`[title="${title}"]`))
      // GH123 : recliquer le bouton actif replie le panneau latéral — vue déjà ouverte et dépliée,
      // rien à faire ; si le clic l'a replié (vue active mais repliée avant), on redéplie.
      if (await button.getAttribute('aria-expanded') === 'true') return
      await button.click()
      if (await button.getAttribute('aria-expanded') === 'false') await button.click()
      // GH387 — vue ouverte et dépliée ; son contenu est attendu par les assertions du test
      // (`networkidle` coûtait au moins 500 ms par appel).
      await expect(button).toHaveAttribute('aria-expanded', 'true')
    },
    /** Capture dans `e2e-web/.results/<nom>.png`. */
    async shot(name: string, p: Page = page): Promise<void> {
      await p.screenshot({ path: path.join('e2e-web', '.results', `${name}.png`) })
    },
    /** Clone et ouvre un autre projet de la forge locale dans la même session. */
    cloneAndOpen(repo: string, name = repo): Promise<ProjectInfo> {
      return cloneAndOpen(page, repo, name).then(p => (project = p))
    },
  }
}

export type Session = ReturnType<typeof setupSession>

/** Identifiant de route d'un projet (cf. renderer/lib/projectId.ts). */
export function projectIdOf(workspaceDir: string): string {
  return Buffer.from(workspaceDir, 'utf-8').toString('base64url')
}

/** Boutons de la barre d'activité (colonne de gauche de l'application). */
export function activityBar(page: Page) {
  return page.locator('button.w-12.h-12[title]')
}

/** Clone `repo` depuis la forge locale dans un dossier neuf de « Mes projets », puis l'ouvre. */
async function cloneAndOpen(page: Page, repo: string, name: string, t: Timer = timer()): Promise<ProjectInfo> {
  const dir = await rpc<string>(page.context(), 'web:new-workspace-dir', name)
  await rpc(page.context(), 'workspace:create-from-clone', dir, `${E2E.gitBaseUrl}/${repo}.git`)
  t.lap('clone')
  return openDir(page, dir, t)
}

async function openDir(page: Page, dir: string, t: Timer): Promise<ProjectInfo> {
  await rpc(page.context(), 'workspace:open-project', dir)
  await rpc(page.context(), 'workspace:mark-recent', dir)
  const info = await rpc<{ workspaceDir: string; localPath: string; name: string }>(page.context(), 'workspace:resolve', dir)
  t.lap('open')
  await page.goto(`/dashboard?projectId=${projectIdOf(dir)}`)
  // GH387 — application chargée sur le projet (barre d'activité), sans attendre `networkidle`.
  await activityBar(page).first().waitFor()
  t.lap('goto')
  return { workspaceDir: info.workspaceDir, localPath: info.localPath, name: info.name }
}

/**
 * GH387 — projet de départ d'un fichier : copie d'un **modèle** (projet cloné et ouvert une fois par
 * worker) au lieu d'un clone par HTTP du produit et de ses composants (github.com). Le modèle est
 * refait quand le repo nu a changé (publication d'un fichier précédent : signature = refs du repo
 * nu), pour que chaque fichier voie, comme avec un vrai clone, les publications faites avant lui.
 */
async function prepareAndOpen(page: Page, repo: string, name: string, t: Timer): Promise<ProjectInfo> {
  const signature = remoteSignature(repo)
  const template = templates.get(repo)
  if (signature === null || template?.signature !== signature) {
    const project = await cloneAndOpen(page, repo, name, t)
    t.mode = 'clone'
    if (signature !== null) {
      const dir = path.join(currentStack().root, 'templates', `${repo.replace(/[\\/]/g, '_')}-${templates.size}-${Date.now()}`)
      fs.cpSync(project.workspaceDir, dir, { recursive: true, preserveTimestamps: true })
      templates.set(repo, { dir, signature })
      t.lap('template')
    }
    return project
  }
  const dir = await rpc<string>(page.context(), 'web:new-workspace-dir', name)
  fs.cpSync(template.dir, dir, { recursive: true, preserveTimestamps: true })
  t.mode = 'copy'
  t.lap('copy')
  return openDir(page, dir, t)
}

/** Modèles de projet du worker (un par repo de la forge). */
const templates = new Map<string, { dir: string; signature: string }>()

/** Refs du repo nu de la forge locale ; `null` si le repo n'y est pas (pas de modèle possible). */
function remoteSignature(repo: string): string | null {
  const bare = path.join(E2E.remotesDir, `${repo}.git`)
  if (!fs.existsSync(bare)) return null
  return execFileSync('git', ['--git-dir', bare, 'for-each-ref', '--format=%(objectname) %(refname)'], { encoding: 'utf-8' })
}

interface Timer {
  mode?: 'copy' | 'clone'
  lap(step: string): void
  record(file: string, hook: string): void
}

/** GH387 — chronométrage des hooks de `setupSession`, écrit si `POLENTA_E2E_TIMINGS` = un fichier. */
function timer(): Timer {
  const start = Date.now()
  let last = start
  const steps: Record<string, number> = {}
  return {
    mode: undefined,
    lap(step) {
      const now = Date.now()
      steps[step] = (steps[step] ?? 0) + now - last
      last = now
    },
    record(file, hook) {
      const out = process.env['POLENTA_E2E_TIMINGS']
      if (!out) return
      const line = { file: path.basename(file), hook, worker: Number(process.env['TEST_PARALLEL_INDEX'] ?? 0), mode: this.mode, ...steps, total: Date.now() - start }
      fs.appendFileSync(out, JSON.stringify(line) + '\n')
    },
  }
}
