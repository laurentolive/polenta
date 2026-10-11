import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { E2E } from './support/env'
import { completeForgeLogin } from './support/forge-login'
import { collectErrors, invoke } from './support/helpers'
import { activityBar } from './support/session'
import { bulkRepos, deleteRepos, resetAccounts, seedItest, setTeamConfig, ssh, INSTANCE, type Accounts } from '../e2e-desktop/support/forge'

/**
 * GH44 S4 — client web **déployé par le kit** (`polenta-host instance web enable`), derrière Caddy,
 * dans son image Docker : HTTPS, connexion OIDC réelle, clone, impression PDF par le Chromium de
 * l'image, données de l'utilisateur dans `web-data/` de l'instance (specs/GH44-tests.md S4-5).
 *
 *   POLENTA_E2E_SSH="ssh -o BatchMode=yes debian@<hôte>" \
 *   POLENTA_E2E_WEB_URL=https://acme-web.forge.example.fr pnpm test:e2e:web s4-deployed
 *
 * Avec `POLENTA_E2E_MEASURE=1`, mesure en plus la mémoire du conteneur (S4-7) : redémarrage, puis
 * trois utilisateurs sur une copie du projet de démonstration poussée sur la forge.
 */
const WEB_URL = (process.env['POLENTA_E2E_WEB_URL'] ?? '').replace(/\/$/, '')
test.describe.configure({ mode: 'serial' })
test.skip(!WEB_URL || !process.env['POLENTA_E2E_SSH'], 'POLENTA_E2E_WEB_URL et POLENTA_E2E_SSH requis')

// Configuration d'équipe neutre : langue du navigateur (fr), aucun projet imposé.
const TEAM_CONFIG = `version: 1
defaults:
  updates: auto
  projects: []
  preferences: {}
`

let A: Accounts
const RUN = Date.now().toString(36)
const contexts: BrowserContext[] = []

/** Connexion d'un utilisateur par la forge, clone de `<org>/<repo>` dans « Mes projets », ouverture. */
async function loginAndOpen(browser: Browser, login: string, password: string, repo: string): Promise<{ context: BrowserContext; page: Page; dir: string }> {
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'fr-FR' })
  contexts.push(ctx)
  const p = await ctx.newPage()
  await p.goto(`${WEB_URL}/auth/login`)
  await completeForgeLogin(p, WEB_URL, login, password)
  const dir = await invoke<string>(p, 'web:new-workspace-dir', `${repo}-${RUN}`)
  await invoke(p, 'workspace:create-from-clone', dir, `${A.baseUrl}/${A.org}/${repo}.git`)
  await invoke(p, 'workspace:open-project', dir)
  await invoke(p, 'workspace:mark-recent', dir)
  await p.goto(`${WEB_URL}/dashboard?projectId=${Buffer.from(dir, 'utf-8').toString('base64url')}`)
  // Vue Exigences : un clic pendant le chargement de la vue d'accueil du projet peut être perdu.
  await expect(async () => {
    await activityBar(p).and(p.locator('[title="Exigences"]')).click()
    // Titre du panneau latéral de la vue (`.section-label`).
    await expect(p.locator('p', { hasText: /^Exigences$/ })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  await p.waitForLoadState('networkidle')
  return { context: ctx, page: p, dir }
}

/** Export PDF de la vue courante, depuis l'interface ; renvoie le fichier. */
async function exportPdf(p: Page, name: string): Promise<Buffer> {
  await p.getByRole('button', { name: 'Exporter' }).first().click()
  const downloadPromise = p.waitForEvent('download', { timeout: 90_000 })
  await p.getByRole('button', { name: 'PDF' }).click()
  const download = await downloadPromise
  const target = path.join(E2E.downloadsDir, `${name}-${download.suggestedFilename()}`)
  await download.saveAs(target)
  // Bouton texte du popover « Téléchargé » (la démo affiche aussi un bandeau fermable « Fermer »).
  await p.getByText('Fermer', { exact: true }).click()
  return fs.readFileSync(target)
}

/** Mémoire du conteneur du client web, en Mo (`docker stats`). */
function containerMemoryMb(): number {
  const raw = ssh(`sudo docker stats --no-stream --format '{{.MemUsage}}' polenta-web-${INSTANCE}`).trim()
  const m = /^([\d.]+)\s*(KiB|MiB|GiB)/.exec(raw)
  if (!m) throw new Error(`docker stats illisible : ${raw}`)
  const factor = { KiB: 1 / 1024, MiB: 1, GiB: 1024 }[m[2] as 'KiB' | 'MiB' | 'GiB']
  return Math.round(Number(m[1]) * factor)
}

test.beforeAll(() => {
  A = resetAccounts()
  seedItest()
  setTeamConfig(TEAM_CONFIG)
})

test.afterAll(async () => {
  for (const c of contexts) await c.close()
})

test('S4-5 — HTTPS, en-têtes de sécurité, santé', async ({ request }) => {
  expect(WEB_URL.startsWith('https://')).toBe(true)
  const health = await request.get(`${WEB_URL}/healthz`)
  expect(health.status()).toBe(200)
  expect(await health.json()).toMatchObject({ ok: true })
  const home = await request.get(`${WEB_URL}/`)
  expect(home.headers()['strict-transport-security']).toBeTruthy()
  expect(home.headers()['x-content-type-options']).toBe('nosniff')
  // Le login part vers la forge de l'instance, avec PKCE.
  const login = await request.get(`${WEB_URL}/auth/login`, { maxRedirects: 0 })
  expect(login.status()).toBe(302)
  const target = new URL(login.headers()['location']!)
  expect(target.origin).toBe(A.baseUrl)
  expect(target.searchParams.get('code_challenge_method')).toBe('S256')
  expect(target.searchParams.get('redirect_uri')).toBe(`${WEB_URL}/auth/callback`)
})

test("S4-5 — connexion par la forge, clone, export PDF imprimé dans l'image", async ({ browser }) => {
  const u = await loginAndOpen(browser, 'itest-auteur', A.auteur, 'itest')
  const errors = collectErrors(u.page)
  const me = await u.page.evaluate(() => fetch('/auth/me').then(r => r.json()))
  expect(me).toMatchObject({ login: 'itest-auteur' })
  const sid = (await u.context.cookies(WEB_URL)).find(c => c.name === 'polenta_sid')
  expect(sid).toMatchObject({ httpOnly: true, secure: true })
  const pdf = await exportPdf(u.page, 'deployed')
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.length).toBeGreaterThan(5_000)
  expect(errors).toEqual([])
})

test("S4-5 — espace de l'utilisateur dans web-data de l'instance", () => {
  const listing = ssh(`sudo ls /opt/polenta/instances/${INSTANCE}/web-data/users/itest-auteur/workspaces`)
  expect(listing).toContain(`itest-${RUN}`)
})

test('S4-7 — mémoire : trois utilisateurs sur le projet de démonstration', async ({ browser }) => {
  test.skip(process.env['POLENTA_E2E_MEASURE'] !== '1', 'POLENTA_E2E_MEASURE=1 pour mesurer')
  test.setTimeout(15 * 60_000)
  // Copie de la démo sur la forge (le serveur web ne clone que depuis sa forge).
  deleteRepos('s4demo')
  bulkRepos('s4demo', 1)
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-demo-'))
  execFileSync('git', ['clone', '-q', '--bare', E2E.demoSource, bare])
  const remote = new URL(`${A.baseUrl}/${A.org}/s4demo00.git`)
  remote.username = 'itest-auteur'
  remote.password = A.auteur
  execFileSync('git', ['-C', bare, 'push', '-q', remote.toString(), 'refs/heads/*:refs/heads/*'])
  fs.rmSync(bare, { recursive: true, force: true })

  // Référence : conteneur redémarré, aucun utilisateur.
  ssh(`sudo docker restart polenta-web-${INSTANCE}`)
  await expect.poll(async () => (await fetch(`${WEB_URL}/healthz`).catch(() => null))?.status ?? 0, { timeout: 60_000 }).toBe(200)
  const idle = containerMemoryMb()

  const users = [['itest-auteur', A.auteur], ['itest-testeur', A.testeur], ['itest-lecteur', A.lecteur]] as const
  const sessions = []
  for (const [login, password] of users) sessions.push(await loginAndOpen(browser, login, password, 's4demo00'))
  for (const u of sessions) await expect(u.page.getByText('PRD-0001').first()).toBeVisible({ timeout: 60_000 })
  const withUsers = containerMemoryMb()
  for (const [i, u] of sessions.entries()) {
    const pdf = await exportPdf(u.page, `mesure-${i}`)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  }
  const withPrinter = containerMemoryMb()
  const perUser = Math.round((withUsers - idle) / users.length)
  console.log(`[S4-7] repos ${idle} Mo ; ${users.length} utilisateurs ${withUsers} Mo (${perUser} Mo par utilisateur) ; après impression ${withPrinter} Mo`)
  expect(perUser).toBeLessThan(300)
})
