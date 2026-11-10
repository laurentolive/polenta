import { test, expect } from '@playwright/test'
import { activityBar, setupSession } from './support/session'

/**
 * GH338 — le titre de fenêtre (ici `document.title`, cf. bridge web `app:set-title`) porte la
 * version et le projet dès le chargement, quel que soit le panneau actif : avant, seul le panneau
 * « Projet » le posait. Scénarios de specs/GH338.md.
 */
const s = setupSession()

let version: string

test.beforeAll(async () => {
  version = await s.invoke<string>('app:get-version')
})

test('W1 — rechargement (= démarrage) hors panneau Projet : version, projet et chemin dans le titre', async () => {
  // Le rechargement restaure l'onglet ouvert (Suivi) : titre repart de celui d'index.html et
  // panneau « Projet » non monté, comme au démarrage de l'application.
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await expect(activityBar(s.page).and(s.page.locator('[title="Projet"]'))).not.toHaveAttribute('aria-expanded', 'true')
  await expect(s.page).toHaveTitle(new RegExp(`v${escape(version)} — .+ — ${escape(s.project.localPath)}$`))
})

test('W2 — changement de panneau sans passer par « Projet » : le titre reste celui du projet', async () => {
  await s.openView('Suivi')
  await s.openView('Version')
  await expect(s.page).toHaveTitle(new RegExp(` — ${escape(s.project.localPath)}$`))
})

test('W3 — fermeture du projet : le titre revient à « <produit> v<version> »', async () => {
  await s.openView('Projet')
  await s.page.getByTitle('Fermer le projet').click()
  await expect(s.page).toHaveTitle(new RegExp(` v${escape(version)}$`))
})

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
