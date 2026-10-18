import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH106 sprint 2 — menu « Intégration » de l'onglet Structure (specs/GH106-tests.md T-11, T-13,
 * T-30, T-23) : nouvelle branche d'intégration créée et désignée, choix d'une autre `int-*` (checkout
 * sous la garde des modifications en attente), refus de supprimer la branche désignée, menu actif en
 * detached HEAD (composant épinglé sur un commit).
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface IntegrationState { currentBranch: string; headOid: string; configured: string; status: string; candidates: { name: string }[] }

const state = () => s.invoke<IntegrationState>('integration:state', s.project.localPath)
/** Le bouton du repo root (premier de l'onglet). */
const menuButton = () => s.page.getByRole('button', { name: /^Branche d'intégration de / }).first()

async function openStructure() {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/schema', { repoPath: s.project.localPath }))
  await s.page.waitForLoadState('networkidle')
  await expect(menuButton()).toBeVisible({ timeout: 15_000 })
}

test('GH106-S2-1 — « Nouvelle branche d\'intégration… » crée et désigne int-e2e-s2 (T-13)', async () => {
  await openStructure()
  await menuButton().click()
  await s.page.getByRole('menuitem', { name: "Nouvelle branche d'intégration…" }).click()
  const dialog = s.page.getByRole('dialog', { name: "Nouvelle branche d'intégration" })
  await dialog.locator('#new-int-suffix').fill('e2e s2')
  await expect(dialog.getByText(/Lettres, chiffres/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Créer et désigner' })).toBeDisabled()
  await dialog.locator('#new-int-suffix').fill('e2e-s2')
  await dialog.getByRole('button', { name: 'Créer et désigner' }).click()
  await expect(dialog).toHaveCount(0, { timeout: 15_000 })

  await expect(menuButton()).toHaveAccessibleName(/int-e2e-s2$/, { timeout: 15_000 })
  expect(await state()).toMatchObject({ currentBranch: 'int-e2e-s2', configured: 'int-e2e-s2', status: 'ok' })
  await s.shot('gh106-s2-nouvelle')
})

test('GH106-S2-2 — choix d\'une autre int-* depuis le menu : checkout confirmé puis désignée (T-11)', async () => {
  const { localPath } = s.project
  // Une seconde int-* (désignée à sa création), puis retour sur int-e2e-s2 par le menu.
  await s.invoke('integration:create', localPath, 'e2e-s3')
  expect((await state()).configured).toBe('int-e2e-s3')
  await openStructure()
  await menuButton().click()
  await s.page.getByRole('menuitemradio', { name: /int-e2e-s2/ }).click()
  // La démo a des modifications en attente : même garde qu'un checkout.
  const status = await s.invoke<{ staged: unknown[]; unstaged: unknown[] }>('sync:status', localPath)
  if (status.staged.length + status.unstaged.length > 0) {
    const force = s.page.getByRole('button', { name: 'Forcer le checkout' })
    await expect(force).toBeVisible()
    await force.click()
  }
  await expect(menuButton()).toHaveAccessibleName(/int-e2e-s2$/, { timeout: 15_000 })
  expect(await state()).toMatchObject({ currentBranch: 'int-e2e-s2', configured: 'int-e2e-s2', status: 'ok' })
})

test('GH106-S2-3 — suppression de la branche désignée refusée, code de refus transmis (T-30)', async () => {
  const { localPath } = s.project
  // La garde passe avant le refus natif de git (branche checkoutée) : c'est son marqueur qui revient.
  const err = await s.invoke('sync:delete-branch', localPath, 'int-e2e-s2').then(() => null, (e: unknown) => String(e))
  expect(err).toContain('⟦integration-guard {"code":"designated","branch":"int-e2e-s2"}⟧')
})

test('GH106-S2-4 — detached HEAD : menu actif, choisir une int-* en fait le checkout et la désigne (T-23)', async () => {
  const { localPath } = s.project
  await s.invoke('sync:checkout-commit', localPath, (await state()).headOid)
  expect((await state()).status).toBe('detached')
  await openStructure()
  await expect(menuButton()).toBeEnabled()
  await menuButton().click()
  await s.page.getByRole('menuitemradio', { name: /int-e2e-s3/ }).click()
  const status = await s.invoke<{ staged: unknown[]; unstaged: unknown[] }>('sync:status', localPath)
  if (status.staged.length + status.unstaged.length > 0) await s.page.getByRole('button', { name: 'Forcer le checkout' }).click()
  await expect(menuButton()).toHaveAccessibleName(/int-e2e-s3$/, { timeout: 15_000 })
  expect(await state()).toMatchObject({ currentBranch: 'int-e2e-s3', configured: 'int-e2e-s3', status: 'ok' })
})
