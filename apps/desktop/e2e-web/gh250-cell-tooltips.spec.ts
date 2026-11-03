import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH250 — vue tableau (Excel) : plus d'info-bulle native sur les cellules ni sur les liens
 * d'élément, elle recouvrait la popup d'aperçu. Seules les colonnes calculées gardent la leur
 * (texte fourni par le projet, cf. gh70-computed-column).
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

/** Vue tableau du type ouvert, toutes les colonnes affichées (les colonnes de lien sont masquées par défaut). */
async function openExcelAllColumns(view: string) {
  await s.openView(view)
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
  await s.page.getByTitle('Configurer les colonnes').click()
  const modal = s.page.locator('.fixed.inset-0.z-50')
  for (const box of await modal.getByRole('checkbox').all()) {
    if (await box.isEnabled()) await box.check()
  }
  await modal.click({ position: { x: 5, y: 5 } })
  await expect(s.page.locator('tbody td').first()).toBeVisible()
}

for (const view of ['Exigences', 'Tests']) {
  test(`GH250 — ${view} : ni cellule ni lien d'élément ne porte d'info-bulle native`, async () => {
    await openExcelAllColumns(view)

    // Le contrôle porte bien sur des liens rendus.
    await expect(s.page.locator('tbody [data-element-link]').first()).toBeVisible()
    await expect(s.page.locator('tbody td[title]:not([data-computed-cell])')).toHaveCount(0)
    await expect(s.page.locator('[data-element-link][title]')).toHaveCount(0)
  })
}
