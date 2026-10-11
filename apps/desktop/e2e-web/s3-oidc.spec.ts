import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { OIDC } from './support/oidc-env'
import { publish } from './support/ui'
import { completeForgeLogin } from './support/forge-login'
import { collectErrors, invoke } from './support/helpers'
import { admin, deleteRepos, repoInfo, resetAccounts, seedItest, setTeamConfig, type Accounts } from '../e2e-desktop/support/forge'

/**
 * GH44 S3 — connexion OIDC réelle contre la forge Forgejo de test du kit `deploy/` (instance `acme`,
 * comptes `itest-*` recréés par `forge-setup.py`), sur le serveur web en mode oidc
 * (`support/oidc-env.ts`). Ignoré sans `POLENTA_E2E_SSH`.
 *
 *   POLENTA_E2E_SSH="ssh -o BatchMode=yes debian@<hôte>" pnpm test:e2e:web
 */
test.describe.configure({ mode: 'serial' })
test.skip(!OIDC.enabled, 'POLENTA_E2E_SSH requis (forge de test du kit deploy/)')

let A: Accounts
const RUN = Date.now().toString(36)
const HOME_ACTION = /Créer un nouveau projet|Create a new project/

// Configuration d'équipe de test (#45 S2b), identique à celle des tests du desktop.
const TEAM_CONFIG = `version: 1
defaults:
  updates: auto
  projects: []
  preferences: {}
teams:
  testeurs:
    projects:
      - repo: __ORG__/itest
        label: Projet de test
    preferences:
      projectHome: campaigns
  lecteurs:
    updates: managed
  auteurs:
    preferences:
      language: en
`
const contexts: BrowserContext[] = []

interface User { page: Page; errors: string[]; login: string }
interface ItestProject { workspaceDir: string; localPath: string }

test.beforeAll(() => {
  A = resetAccounts()
  seedItest()
  setTeamConfig(TEAM_CONFIG.replace(/__ORG__/g, A.org))
  deleteRepos('s3-')
})

test.afterAll(async () => {
  for (const c of contexts) await c.close()
  // Ne jamais laisser un compte de test désactivé (S3-6), même si le test a échoué.
  try { admin('user enable itest-testeur') } catch { /* déjà actif */ }
})

/** Connexion par la page de la forge (identifiant, mot de passe, consentement à la première fois). */
async function forgeLogin(browser: Browser, login: string, password: string): Promise<User> {
  const context = await browser.newContext({ acceptDownloads: true })
  contexts.push(context)
  const page = await context.newPage()
  const errors = collectErrors(page)
  await page.goto(`${OIDC.baseUrl}/auth/login`)
  await completeForgeLogin(page, OIDC.baseUrl, login, password)
  // Langue : celle de la configuration d'équipe de l'instance, à défaut celle du navigateur.
  await expect(page.getByText(/^(Mes projets|My projects)$/)).toBeVisible({ timeout: 30_000 })
  return { page, errors, login }
}

/** Clone `acme/itest` dans « Mes projets » de l'utilisateur et l'ouvre. */
async function openItest(u: User, name: string): Promise<ItestProject> {
  const dir = await invoke<string>(u.page, 'web:new-workspace-dir', name)
  await invoke(u.page, 'workspace:create-from-clone', dir, `${OIDC.forgeUrl}/${A.org}/itest.git`)
  await invoke(u.page, 'workspace:open-project', dir)
  await invoke(u.page, 'workspace:mark-recent', dir)
  const info = await invoke<{ workspaceDir: string; localPath: string }>(u.page, 'workspace:resolve', dir)
  await u.page.goto(`${OIDC.baseUrl}/dashboard?projectId=${Buffer.from(dir, 'utf-8').toString('base64url')}`)
  return info
}

async function firstRequirement(u: User, p: ItestProject): Promise<{ id: string; title: string }> {
  const reqs = await invoke<Array<{ id: string; title: string }>>(u.page, 'requirements:list', p.localPath, undefined)
  expect(reqs.length).toBeGreaterThan(0)
  return reqs[0]
}

function publishFromUi(u: User, title: string): Promise<void> {
  return publish(u.page, title)
}

/** Dernier commit de `main` sur la forge, lu avec le compte de l'auteur. */
async function forgeHeadCommit(): Promise<{ sha: string; author: string; email: string; message: string }> {
  const res = await fetch(`${OIDC.forgeUrl}/api/v1/repos/${A.org}/itest/commits?sha=main&limit=1`, {
    headers: { Authorization: `Basic ${Buffer.from(`itest-auteur:${A.auteur}`).toString('base64')}` },
  })
  expect(res.status).toBe(200)
  const [c] = (await res.json()) as Array<{ sha: string; commit: { author: { name: string; email: string }; message: string } }>
  return { sha: c.sha, author: c.commit.author.name, email: c.commit.author.email, message: c.commit.message }
}

let auteur: User
let testeur: User
let auteurProject: ItestProject

test('S3-1/S3-2 — connexion par la forge, aucun jeton côté navigateur', async ({ browser }) => {
  auteur = await forgeLogin(browser, 'itest-auteur', A.auteur)
  const me = await auteur.page.evaluate(() => fetch('/auth/me').then(r => r.json()))
  expect(me).toMatchObject({ login: 'itest-auteur', remote: OIDC.forgeUrl })
  const cookies = await auteur.page.context().cookies(OIDC.baseUrl)
  expect(cookies.find(c => c.name === 'polenta_sid')).toMatchObject({ httpOnly: true })
  // Aucun cookie lisible par le navigateur ne ressemble à un jeton de la forge (40 hexadécimaux).
  for (const c of cookies) expect(c.value).not.toMatch(/[0-9a-f]{40}/)
  expect(auteur.errors).toEqual([])
  // Pas de connexion par mot de passe relayée par le serveur web (le refus est consigné par la
  // console du navigateur : erreurs vidées ensuite).
  const pw = await auteur.page.evaluate(async () => (await fetch('/rpc/auth:login-password', { method: 'POST' })).status)
  expect([403, 404]).toContain(pw)
  auteur.errors.length = 0
})

test('S3-3 — publication à l\'identité forge de l\'utilisateur', async () => {
  auteurProject = await openItest(auteur, 'itest')
  const req = await firstRequirement(auteur, auteurProject)
  const before = await forgeHeadCommit()
  await invoke(auteur.page, 'requirements:update', auteurProject.localPath, req.id, { title: `${req.title} (web S3-3)` }, auteurProject.workspaceDir)
  await publishFromUi(auteur, 'S3-3 : publication web OIDC')
  await expect.poll(async () => (await forgeHeadCommit()).sha, { timeout: 60_000 }).not.toBe(before.sha)
  const head = await forgeHeadCommit()
  // Auteur = identité du compte sur la forge (nom complet et adresse), jamais un compte technique.
  const user = await (await fetch(`${OIDC.forgeUrl}/api/v1/user`, {
    headers: { Authorization: `Basic ${Buffer.from(`itest-auteur:${A.auteur}`).toString('base64')}` },
  })).json() as { login: string; full_name: string; email: string }
  expect(head.author).toBe(user.full_name || user.login)
  expect(head.email).toBe(user.email)
  expect(head.message).toContain('S3-3')
  expect(auteur.errors).toEqual([])
})

test('S3-4 — deux utilisateurs : espaces et clones distincts', async ({ browser }) => {
  testeur = await forgeLogin(browser, 'itest-testeur', A.testeur)
  const rootAuteur = await invoke<string>(auteur.page, 'web:workspaces-root')
  const rootTesteur = await invoke<string>(testeur.page, 'web:workspaces-root')
  expect(rootAuteur).not.toBe(rootTesteur)
  expect(rootTesteur).toContain('itest-testeur')

  // Modification non publiée de l'auteur : invisible pour le testeur.
  const req = await firstRequirement(auteur, auteurProject)
  await invoke(auteur.page, 'requirements:update', auteurProject.localPath, req.id, { title: 'Brouillon non publié (auteur)' }, auteurProject.workspaceDir)
  const testeurProject = await openItest(testeur, 'itest')
  const seen = await invoke<{ title: string }>(testeur.page, 'requirements:get', testeurProject.localPath, req.id)
  expect(seen.title).not.toBe('Brouillon non publié (auteur)')
  // L'espace de l'autre est inaccessible (garde des chemins).
  const status = await testeur.page.evaluate(async (dir) => {
    const csrf = decodeURIComponent(document.cookie.split('; ').find(c => c.startsWith('polenta_csrf='))!.split('=')[1])
    return (await fetch('/rpc/requirements:list', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Polenta-CSRF': csrf },
      body: JSON.stringify({ args: [dir] }),
    })).status
  }, auteurProject.localPath)
  expect(status).toBe(403)
})

test('S3-17 — lecteur : publication refusée, bannière dans le navigateur, session conservée', async ({ browser }) => {
  const lecteur = await forgeLogin(browser, 'itest-lecteur', A.lecteur)
  const p = await openItest(lecteur, 'itest')
  const req = await firstRequirement(lecteur, p)
  await invoke(lecteur.page, 'requirements:update', p.localPath, req.id, { title: `${req.title} (lecteur)` }, p.workspaceDir)
  await publishFromUi(lecteur, 'S3-17 : tentative du lecteur')
  await expect(lecteur.page.getByText(/pas le droit de publier/).first()).toBeVisible({ timeout: 60_000 })
  // Écriture refusée ≠ accès révoqué : la session reste ouverte.
  const me = await lecteur.page.evaluate(() => fetch('/auth/me').then(r => r.status))
  expect(me).toBe(200)
})

test('S3-6 — compte désactivé : accès révoqué, retour à la connexion, travail conservé', async () => {
  const p = await openItest(testeur, 'itest-2')
  const req = await firstRequirement(testeur, p)
  await invoke(testeur.page, 'requirements:update', p.localPath, req.id, { title: 'Travail du testeur avant désactivation' }, p.workspaceDir)
  admin('user disable itest-testeur')
  try {
    await publishFromUi(testeur, 'S3-6 : après désactivation')
    await testeur.page.waitForURL(`${OIDC.baseUrl}/auth/revoked`, { timeout: 60_000 })
    await expect(testeur.page.getByText(/accès a été révoqué/)).toBeVisible()
    // Session détruite côté serveur.
    expect(await testeur.page.evaluate(() => fetch('/auth/me').then(r => r.status))).toBe(401)
  } finally {
    admin('user enable itest-testeur')
  }
  // Reconnexion : le travail non publié est toujours là.
  await testeur.page.getByRole('link', { name: 'Se reconnecter' }).click()
  await completeForgeLogin(testeur.page, OIDC.baseUrl, 'itest-testeur', A.testeur)
  const kept = await invoke<{ title: string }>(testeur.page, 'requirements:get', p.localPath, req.id)
  expect(kept.title).toBe('Travail du testeur avant désactivation')
  // Seules erreurs admises : les refus 401/403 de la révocation elle-même.
  expect(testeur.errors.filter(e => !/status of 40[13]/.test(e))).toEqual([])
  testeur.errors.length = 0
})

test("S3-15 / S3-21 — projets de l'équipe et vue d'ouverture de l'équipe, dans le navigateur", async () => {
  // Configuration lue avec le jeton de la session : testeurs → « Projet de test », ouverture sur les
  // campagnes ; auteurs → interface en anglais sans choix personnel.
  await invoke(testeur.page, 'workspace:clear-last-opened')
  await testeur.page.goto(`${OIDC.baseUrl}/`)
  await expect(testeur.page.getByText(/Projets de votre équipe|Your team’s projects/)).toBeVisible({ timeout: 30_000 })
  await testeur.page.getByRole('button', { name: /Projet de test/ }).click()
  await expect(testeur.page).toHaveURL(/category=campaign/, { timeout: 60_000 })
  expect(testeur.errors).toEqual([])
  await expect(auteur.page.getByRole('button', { name: /^Publish$/ }).first()).toBeVisible()
})

test('S3-16 — « Créer sur le serveur » depuis le navigateur', async () => {
  const name = `s3-projet-${RUN}`
  await invoke(auteur.page, 'workspace:clear-last-opened')
  await auteur.page.goto(`${OIDC.baseUrl}/`)
  await auteur.page.getByRole('button', { name: HOME_ACTION }).click()
  await expect(auteur.page.getByRole('radio', { name: /Sur le serveur|On the server/ })).toBeChecked({ timeout: 30_000 })
  await auteur.page.getByLabel(/Nom du projet|Project name/).fill(name)
  await auteur.page.getByRole('button', { name: /^(Continuer|Continue)$/ }).click()
  await expect(auteur.page).toHaveURL(/projectId=/, { timeout: 60_000 })
  // La forge peut exposer le repo avant sa branche (publication initiale en cours) : on attend.
  await expect.poll(() => { try { return repoInfo(name) } catch { return null } }, { timeout: 30_000 })
    .toEqual({ exists: true, private: true, branches: ['main'] })
  // Le clone vit dans « Mes projets » de l'auteur sur le serveur.
  const projects = await invoke<Array<{ name: string }>>(auteur.page, 'web:list-workspaces')
  expect(projects.map(p => p.name)).toContain(name)
  expect(auteur.errors).toEqual([])
})
