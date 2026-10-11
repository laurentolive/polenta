import { test, expect, type BrowserContext } from '@playwright/test'
import { completeForgeLogin } from './support/forge-login'
import { resetAccounts, seedItest, type Accounts } from '../e2e-desktop/support/forge'

/**
 * GH57 — pas de page de consentement de la forge pour le client web déployé par le kit
 * (`polenta-host instance web enable` installe une page personnalisée, specs/GH57-design.md), mais
 * la page d'origine pour toute autre application (specs/GH57-tests.md T4, T5).
 *
 *   POLENTA_E2E_SSH="ssh -o BatchMode=yes debian@<hôte>" \
 *   POLENTA_E2E_WEB_URL=https://acme-web.forge.example.fr pnpm test:e2e:web gh57
 */
const WEB_URL = (process.env['POLENTA_E2E_WEB_URL'] ?? '').replace(/\/$/, '')
test.describe.configure({ mode: 'serial' })
test.skip(!WEB_URL || !process.env['POLENTA_E2E_SSH'], 'POLENTA_E2E_WEB_URL et POLENTA_E2E_SSH requis')

const AUTHORIZE = /^(Authorize Application|Autoriser l.application)$/
let A: Accounts
const contexts: BrowserContext[] = []

test.beforeAll(() => {
  // Comptes supprimés puis recréés : aucune autorisation antérieure de polenta-web.
  A = resetAccounts()
  seedItest()
})

test.afterAll(async () => {
  for (const c of contexts) await c.close()
})

function basicAuth(login: string, password: string): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`, 'Content-Type': 'application/json' }
}

test('T4 — première connexion au client web : aucune page de consentement', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'fr-FR' })
  contexts.push(context)
  const page = await context.newPage()
  await page.goto(`${WEB_URL}/auth/login`)
  const { consentShown } = await completeForgeLogin(page, WEB_URL, 'itest-auteur', A.auteur)
  expect(consentShown, 'page de consentement présentée').toBe(false)
  // L'autorisation est enregistrée comme un clic sur « Autoriser » : visible et révocable.
  await page.goto(`${A.baseUrl}/user/settings/applications`)
  await expect(page.getByText('polenta-web', { exact: true }).first()).toBeVisible()
})

test('T5 — une autre application nommée « polenta-web » garde la page de consentement', async ({ browser }) => {
  const redirect = 'http://127.0.0.1:9/callback'
  const created = await fetch(`${A.baseUrl}/api/v1/user/applications/oauth2`, {
    method: 'POST',
    headers: basicAuth('itest-testeur', A.testeur),
    body: JSON.stringify({ name: 'polenta-web', redirect_uris: [redirect], confidential_client: true }),
  })
  expect(created.status).toBe(201)
  const app = (await created.json()) as { id: number; client_id: string }
  try {
    const context = await browser.newContext({ locale: 'fr-FR' })
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(`${A.baseUrl}/user/login`)
    await page.getByRole('textbox', { name: /Username or email address|Nom d.utilisateur ou adresse courriel/ }).fill('itest-testeur')
    await page.getByRole('textbox', { name: /Password|Mot de passe/ }).fill(A.testeur)
    await page.getByRole('main').getByRole('button', { name: /^(Sign in|Connexion)$/ }).click()
    await expect(page).not.toHaveURL(/\/user\/login/)
    const params = new URLSearchParams({ client_id: app.client_id, redirect_uri: redirect, response_type: 'code', state: 'gh57', scope: 'openid' })
    await page.goto(`${A.baseUrl}/login/oauth/authorize?${params}`)
    await expect(page.getByRole('button', { name: AUTHORIZE })).toBeVisible()
  } finally {
    await fetch(`${A.baseUrl}/api/v1/user/applications/oauth2/${app.id}`, { method: 'DELETE', headers: basicAuth('itest-testeur', A.testeur) })
  }
})
