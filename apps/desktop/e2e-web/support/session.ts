import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import * as path from 'path'
import { E2E } from './env'
import { collectErrors, invoke } from './helpers'

export interface ProjectInfo {
  /** Dossier du workspace (contient `.polenta/workspace.yaml`), sous « Mes projets ». */
  workspaceDir: string
  /** Repo racine du projet (exigences, tests, schéma). */
  localPath: string
  name: string
}

export interface SessionOptions {
  /** Projet à cloner depuis la forge locale et à ouvrir avant les tests (défaut : la démo). `null` : aucun. */
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

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    context = await browser.newContext({ acceptDownloads: true })
    page = await context.newPage()
    errors = collectErrors(page)
    await page.goto('/auth/login')
    await page.waitForLoadState('networkidle')
    if (projectSpec) project = await cloneAndOpen(page, projectSpec.repo, projectSpec.name ?? projectSpec.repo)
  })

  test.afterEach(async () => {
    if (!checkConsole) return
    const unexpected = errors.filter(e => !allowed.some(r => r.test(e)))
    errors.length = 0
    allowed.length = 0
    expect(unexpected, unexpected.join('\n')).toEqual([])
  })

  test.afterAll(async () => {
    await context?.close()
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
      await page.waitForLoadState('networkidle')
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
async function cloneAndOpen(page: Page, repo: string, name: string): Promise<ProjectInfo> {
  const dir = await invoke<string>(page, 'web:new-workspace-dir', name)
  await invoke(page, 'workspace:create-from-clone', dir, `${E2E.gitBaseUrl}/${repo}.git`)
  await invoke(page, 'workspace:open-project', dir)
  await invoke(page, 'workspace:mark-recent', dir)
  const info = await invoke<{ workspaceDir: string; localPath: string; name: string }>(page, 'workspace:resolve', dir)
  await page.goto(`/dashboard?projectId=${projectIdOf(dir)}`)
  await page.waitForLoadState('networkidle')
  return { workspaceDir: info.workspaceDir, localPath: info.localPath, name: info.name }
}
