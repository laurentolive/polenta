import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH450 — panneau Version : un dépôt en HEAD détachée (composant épinglé sur un commit ou un tag)
 * affiche « détaché » avec un avertissement dans sa combo de branche, au lieu d'une combo vide ;
 * l'infobulle donne le commit et dit que rien ne peut être publié. Un dépôt sur une branche garde
 * le nom de sa branche, sans avertissement.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

/** Combo de branche de la ligne du dépôt `label` dans le panneau Version. */
const comboOf = (label: string) =>
  s.page.locator('div', { has: s.page.getByText(label, { exact: true }) })
    .filter({ has: s.page.getByPlaceholder('branche…') }).last()
    .getByPlaceholder('branche…')

test('GH450-1 — composant détaché : « détaché » + avertissement ; produit sur sa branche : inchangé', async () => {
  // « Pompe de vidange » (démo) : pin v2.0, checkouté sur ce tag (detached HEAD).
  await s.openView('Version')
  // Hors de la vue « Version produit » (/versions) : l'arbre des dépôts s'affiche.
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/local-impact'))

  const pump = comboOf('Pompe de vidange')
  await expect(pump).toHaveValue('détaché', { timeout: 15_000 })
  await expect(pump).toHaveAttribute('data-warning', 'true')
  await expect(pump).toHaveAttribute('title', /^HEAD détachée sur le commit [0-9a-f]{7} : rien ne peut être commité ni publié/, { timeout: 15_000 })

  const root = comboOf('Lave-linge LL800')
  const { currentBranch } = await s.invoke<{ currentBranch: string }>('integration:state', s.project.localPath)
  await expect(root).toHaveValue(currentBranch, { timeout: 15_000 })
  await expect(root).not.toHaveAttribute('data-warning', /.*/)
  await s.shot('gh450-version-detached')

  // Ouverte, la combo sert au filtre : plus d'avertissement ni de libellé.
  await pump.click()
  await expect(pump).toHaveValue('')
  await expect(pump).not.toHaveAttribute('data-warning', /.*/)
})
