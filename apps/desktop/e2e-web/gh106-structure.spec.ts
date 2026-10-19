import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH106 sprint 2 — onglet Structure (specs/GH106-tests.md T-11, T-13, T-30, T-23) : la combo de
 * branche est le seul contrôle de la ligne ; y créer une `int-*` la désigne ; l'intégration n'est
 * affichée que si elle diffère de la branche checkoutée (« Désigner » sur une `int-*` non
 * désignée) ; refus de supprimer la branche désignée ; combo présente en detached HEAD.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface IntegrationState { currentBranch: string; headOid: string; configured: string; status: string; candidates: { name: string }[] }

const state = () => s.invoke<IntegrationState>('integration:state', s.project.localPath)
/** La combo du repo root (première ligne de l'onglet). */
const combo = () => s.page.getByPlaceholder('branche…').first()
/** En-tête de la ligne du repo root (les composants de la démo ont leur propre libellé). */
const rootRow = () => s.page.locator('div', { has: s.page.getByText('Lave-linge LL800', { exact: true }) }).filter({ has: combo() }).last()
const integrationLabel = () => rootRow().getByText(/^Intégration : /)
const designateButton = (branch: string) => rootRow().getByRole('button', { name: `Désigner ${branch} comme intégration` })

async function openStructure() {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/schema', { repoPath: s.project.localPath }))
  await s.page.waitForLoadState('networkidle')
  await expect(combo()).toBeVisible({ timeout: 15_000 })
}

/** Checkout sous la garde des modifications en attente (la démo en a). */
async function confirmCheckoutIfDirty() {
  const status = await s.invoke<{ staged: unknown[]; unstaged: unknown[] }>('sync:status', s.project.localPath)
  if (status.staged.length + status.unstaged.length > 0) await s.page.getByRole('button', { name: 'Forcer le checkout' }).click()
}

test('GH106-S2-1 — « Nouvelle branche… » int-e2e-s2 dans la combo : créée et désignée, rien d\'autre affiché (T-13)', async () => {
  await openStructure()
  await combo().click()
  await s.page.getByRole('button', { name: 'Nouvelle branche…' }).click()
  await s.page.getByPlaceholder('nom-de-branche').fill('int-e2e-s2')
  await s.page.getByPlaceholder('nom-de-branche').press('Enter')

  await expect(combo()).toHaveValue('int-e2e-s2', { timeout: 15_000 })
  await expect.poll(async () => (await state()).configured, { timeout: 15_000 }).toBe('int-e2e-s2')
  // Branche courante = intégration : pas de libellé « Intégration » en plus de la combo.
  await expect(integrationLabel()).toHaveCount(0)
  await expect(designateButton('int-e2e-s2')).toHaveCount(0)
  // L'intégration est marquée dans la liste de la combo.
  await combo().click()
  await expect(s.page.getByRole('button', { name: /int-e2e-s2\s*intégration/ })).toBeVisible()
  await s.page.getByText(/^Arbre des repos du workspace/).click()   // ferme la liste (clic extérieur)
  await s.shot('gh106-s2-nouvelle')
})

test('GH106-S2-2 — int-* créée sans désignation (cas PH2) : « Désigner », puis plus rien d\'affiché (T-11)', async () => {
  const { localPath } = s.project
  // Branche ordinaire : son project.yaml, hérité, désigne encore int-e2e-s2.
  await s.invoke('sync:create-branch', localPath, 'int-e2e-s3')
  expect(await state()).toMatchObject({ currentBranch: 'int-e2e-s3', configured: 'int-e2e-s2', status: 'incoherent' })
  await openStructure()
  await expect(combo()).toHaveValue('int-e2e-s3', { timeout: 15_000 })

  const designate = designateButton('int-e2e-s3')
  await expect(designate).toBeVisible({ timeout: 15_000 })
  await designate.click()
  await expect(designate).toHaveCount(0, { timeout: 15_000 })
  await expect(integrationLabel()).toHaveCount(0)
  expect(await state()).toMatchObject({ currentBranch: 'int-e2e-s3', configured: 'int-e2e-s3', status: 'ok' })
})

test('GH106-S2-3 — suppression de la branche désignée refusée, code de refus transmis (T-30)', async () => {
  const { localPath } = s.project
  // La garde passe avant le refus natif de git (branche checkoutée) : c'est son marqueur qui revient.
  const err = await s.invoke('sync:delete-branch', localPath, 'int-e2e-s3').then(() => null, (e: unknown) => String(e))
  expect(err).toContain('⟦integration-guard {"code":"designated","branch":"int-e2e-s3"}⟧')
})

test('GH106-S2-4 — detached HEAD : combo sur le commit, intégration affichée, choisir la branche y revient (T-23)', async () => {
  const { localPath } = s.project
  const { headOid } = await state()
  await s.invoke('sync:checkout-commit', localPath, headOid)
  expect((await state()).status).toBe('detached')
  await openStructure()
  await expect(combo()).toHaveValue(headOid.slice(0, 7), { timeout: 15_000 })
  await expect(integrationLabel()).toBeVisible({ timeout: 15_000 })

  await combo().click()
  await s.page.getByRole('button', { name: /^int-e2e-s3/ }).click()
  await confirmCheckoutIfDirty()
  await expect(combo()).toHaveValue('int-e2e-s3', { timeout: 15_000 })
  await expect(integrationLabel()).toHaveCount(0, { timeout: 15_000 })
  expect(await state()).toMatchObject({ currentBranch: 'int-e2e-s3', configured: 'int-e2e-s3', status: 'ok' })
})

test('GH106-S2-5 — composant épinglé sur une baseline : la combo montre le tag, pin non répété', async () => {
  await openStructure()
  // « Pompe de vidange » (démo) : pin v2.0, checkouté sur ce tag (detached HEAD).
  const row = s.page.locator('div', { has: s.page.getByText('Pompe de vidange', { exact: true }) })
    .filter({ has: s.page.getByPlaceholder('branche…') }).last()
  await expect(row.getByPlaceholder('branche…')).toHaveValue('v2.0', { timeout: 15_000 })
  await expect(row.locator('code', { hasText: 'v2.0' })).toHaveCount(0)
})
