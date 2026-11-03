import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH250 — vue tableau (Excel) : la cellule de lien ne porte plus d'info-bulle native, qui
 * recouvrait la popup d'aperçu des liens.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const linkCells = () => s.page.locator('td[data-link-cell]')

test('GH250-1 — cellule de lien, remplie ou vide : pas d\'info-bulle native', async () => {
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
  if (await linkCells().count() === 0) {
    await s.page.getByTitle('Configurer les colonnes').click()
    const modal = s.page.locator('.fixed.inset-0.z-50')
    const links = modal.locator('div.border-t').filter({ has: s.page.getByText('Liens', { exact: true }) })
    for (const box of await links.getByRole('checkbox').all()) await box.check()
    await modal.click({ position: { x: 5, y: 5 } })
  }
  await expect(linkCells().first()).toBeVisible()

  await expect(linkCells().locator('[data-element-link]').first()).toBeVisible()
  await expect(s.page.locator('td[data-link-cell][title]')).toHaveCount(0)
})
