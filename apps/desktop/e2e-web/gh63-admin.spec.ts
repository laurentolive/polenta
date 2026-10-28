import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { E2E } from './support/env'

/**
 * GH63 Sprint 4 — page Administration de la version web contre un faux service d'administration
 * (support/fake-admin-service.mjs) : S4-1, S4-2, S4-5, suivi d'un travail, bandeau, confirmation par
 * le nom, refus 409, DNS, journal. Le droit « propriétaire » est simulé par le faux service.
 */
const s = setupSession({ project: null })

async function setRole(level: 'instance' | 'host' | null, durationMs = 1500) {
  const res = await fetch(`${E2E.adminUrl}/__role`, { method: 'POST', body: JSON.stringify({ level, durationMs }) })
  expect(res.ok).toBe(true)
}

async function openAccount(page: Page) {
  await s.openView('Compte')
}

async function openAdmin(page: Page) {
  // Par le panneau Compte (l'URL seule ne suffit pas : les onglets restaurés priment).
  const entry = page.getByTestId('account-admin')
  if (!(await entry.isVisible())) await openAccount(page)
  await entry.click()
  await expect(page.getByRole('tablist', { name: 'Administration' })).toBeVisible()
}

test('S4-2 — non-propriétaire : aucune entrée, aucune erreur console, API en 403', async () => {
  await setRole(null)
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await openAccount(s.page)
  await expect(s.page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
  await expect(s.page.getByTestId('account-admin')).toHaveCount(0)
  const status = await s.page.evaluate(async () => (await fetch('/admin/api/me')).status)
  expect(status).toBe(403)
  s.allowConsoleErrors(/403/)
})

test('S4-1 — propriétaire (niveau instance) : entrée Administration, page, pas d\'onglet Hôte', async () => {
  await setRole('instance')
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await openAdmin(s.page)
  await expect(s.page.getByText("Vous administrez l'instance acme.")).toBeVisible()
  await expect(s.page.getByRole('tab', { name: 'Hôte' })).toHaveCount(0)
  await expect(s.page.getByTestId('admin-instances').getByRole('row')).toHaveCount(2)
  // Sa propre instance : ni arrêt ni suppression proposés.
  await expect(s.page.getByRole('button', { name: 'Arrêter' })).toHaveCount(0)
  await expect(s.page.getByRole('button', { name: 'Supprimer' })).toHaveCount(0)
  await s.shot('gh63-s4-1-instances')
})

test('sauvegarde : travail suivi jusqu\'à « Réussi », bandeau pendant le travail, refus 409 explicite', async () => {
  await setRole('instance', 8000)
  await openAdmin(s.page)
  await s.page.getByRole('button', { name: 'Sauvegarder' }).click()
  const job = s.page.getByTestId('admin-job')
  await expect(job.getByTestId('admin-job-state')).toHaveText('En cours')
  await expect(s.page.getByTestId('admin-job-banner')).toBeVisible({ timeout: 10_000 })
  // Seconde opération pendant la première : message « qui, quoi, depuis ».
  await s.page.getByRole('button', { name: 'Remettre à niveau' }).click()
  await expect(s.page.getByRole('alert').filter({ hasText: 'Une autre opération est en cours : Sauvegarde par e2e' })).toBeVisible()
  s.allowConsoleErrors(/409/)
  await expect(job.getByTestId('admin-job-state')).toHaveText('Réussi', { timeout: 20_000 })
  await setRole('instance')
  await expect(job.getByTestId('admin-job-log')).toContainText('Terminé.')
  await s.shot('gh63-s4-backup')
})

test('S4-5 — niveau hôte : toutes les instances, onglet Hôte, suppression confirmée par le nom', async () => {
  await setRole('host')
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await openAdmin(s.page)
  await expect(s.page.getByRole('tab', { name: 'Hôte' })).toBeVisible()
  await expect(s.page.getByTestId('admin-instances').getByRole('row')).toHaveCount(3)
  await s.page.getByRole('button', { name: 'Supprimer' }).first().click()
  const dialog = s.page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: 'Supprimer' })
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('textbox').fill('acm')
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('textbox').fill('acme')
  await confirm.click()
  await expect(s.page.getByTestId('admin-job').getByTestId('admin-job-state')).toHaveText('Réussi', { timeout: 10_000 })
  await s.page.getByRole('tab', { name: 'Hôte' }).click()
  await expect(s.page.getByTestId('admin-agent-state')).toHaveText('présent')
  // Redémarrage : nom d'hôte exigé.
  await s.page.getByRole('button', { name: "Redémarrer l'hôte" }).click()
  await expect(s.page.getByRole('dialog').getByRole('button', { name: "Redémarrer l'hôte" })).toBeDisabled()
  await s.page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click()
  await s.shot('gh63-s4-5-host')
})

test('DNS et journal', async () => {
  await openAdmin(s.page)
  await s.page.getByRole('tab', { name: 'DNS' }).click()
  await s.page.getByRole('textbox', { name: 'Domaine' }).fill('beta.forge.test')
  await s.page.getByRole('button', { name: 'Vérifier' }).click()
  await expect(s.page.getByTestId('admin-dns-result')).toContainText('pointe vers cet hôte')
  await s.page.getByRole('tab', { name: 'Journal' }).click()
  await expect(s.page.getByTestId('admin-audit')).toContainText('backup.run')
  await expect(s.page.getByRole('link', { name: 'Exporter en CSV' })).toHaveAttribute('href', /\/admin\/api\/audit\.csv/)
})
