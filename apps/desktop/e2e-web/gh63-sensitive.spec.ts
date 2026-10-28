import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { E2E } from './support/env'

/**
 * GH63 Sprint 5 — opérations sensibles de la page Administration contre le faux service
 * (support/fake-admin-service.mjs) : S5-2 clé de sauvegarde à usage unique, S5-5/S5-7 stockage S3
 * (indice seul, purge en deux temps), S5-10 restauration confirmée par le nom, S5-12/S5-14 exports,
 * S5-16 import CSV, S5-19 rapport d'accès, S5-20 invitation, S5-21 lien vers la forge.
 */
const s = setupSession({ project: null })

async function setRole(level: 'instance' | 'host' | null) {
  const res = await fetch(`${E2E.adminUrl}/__role`, { method: 'POST', body: JSON.stringify({ level, durationMs: 800 }) })
  expect(res.ok).toBe(true)
}

async function openTab(page: Page, tab: string) {
  const entry = page.getByTestId('account-admin')
  if (!(await page.getByRole('tablist', { name: 'Administration' }).isVisible())) {
    if (!(await entry.isVisible())) await s.openView('Compte')
    await entry.click()
  }
  await page.getByRole('tab', { name: tab }).click()
}

test.beforeAll(async () => {
  await setRole('host')
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
})

test('S5-2 — clé de sauvegarde : nom exigé, affichée une fois, masquée par défaut', async () => {
  await openTab(s.page, 'Sauvegardes')
  await s.page.getByRole('button', { name: 'Afficher la clé de sauvegarde' }).click()
  const dialog = s.page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: 'Afficher la clé de sauvegarde' })
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('textbox').fill('globex')
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('textbox').fill('ops')
  await confirm.click()
  const job = s.page.getByTestId('admin-job')
  await expect(job.getByTestId('admin-job-state')).toHaveText('Réussi', { timeout: 10_000 })
  await job.getByRole('button', { name: 'Afficher la valeur à usage unique' }).click()
  const value = s.page.getByTestId('admin-secret-value')
  await expect(value).not.toContainText('e2e-restic')
  await s.page.getByTestId('admin-secret').getByRole('button', { name: 'Afficher' }).click()
  await expect(value).toHaveText('e2e-restic-cle-0123456789')
  // Le journal du travail ne contient pas la clé ; une seconde lecture est refusée.
  await expect(job.getByTestId('admin-job-log')).not.toContainText('e2e-restic')
  const again = await s.page.evaluate(async () => {
    const jobs = await (await fetch('/admin/api/jobs')).json()
    return (await fetch(`/admin/api/jobs/${jobs.jobs[0].id}/secret`)).status
  })
  expect(again).toBe(404)
  s.allowConsoleErrors(/404/)
})

test('S5-10 — restauration : confirmation par le nom de l\'instance cible', async () => {
  await openTab(s.page, 'Sauvegardes')
  await s.page.getByTestId('admin-snapshots').getByRole('button', { name: 'Restaurer' }).first().click()
  const dialog = s.page.getByRole('dialog')
  await expect(dialog).toContainText('pre-restore')
  await expect(dialog.getByRole('button', { name: 'Restaurer' })).toBeDisabled()
  await dialog.getByRole('textbox').fill('ops')
  await dialog.getByRole('button', { name: 'Restaurer' }).click()
  await expect(s.page.getByTestId('admin-job').getByTestId('admin-job-state')).toHaveText('Réussi', { timeout: 10_000 })
})

test('S5-12/S5-14 — exports : liste, téléchargement, suppression confirmée', async () => {
  await openTab(s.page, 'Exports')
  const table = s.page.getByTestId('admin-exports')
  await expect(table).toContainText('acme-20261028-101500.tar.gz')
  await expect(table).toContainText('7.0 Mo')
  const [download] = await Promise.all([s.page.waitForEvent('download'), table.getByRole('link', { name: 'Télécharger' }).click()])
  expect(download.suggestedFilename()).toBe('acme-20261028-101500.tar.gz')
  await table.getByRole('button', { name: 'Supprimer' }).click()
  await s.page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click()
  await expect(s.page.getByTestId('admin-job').getByTestId('admin-job-state')).toHaveText('Réussi', { timeout: 10_000 })
})

test('S5-5/S5-7 — stockage S3 : indice de clé seul, purge en deux temps (inventaire, clé, phrase)', async () => {
  await openTab(s.page, 'Stockage S3')
  await expect(s.page.getByTestId('admin-s3')).toContainText('…7XYZ')
  await expect(s.page.getByRole('button', { name: 'Remplacer la clé' })).toBeDisabled()
  await s.page.getByRole('textbox', { name: 'Instance supprimée' }).fill('ancien')
  await s.page.getByRole('button', { name: "Lire l'inventaire" }).click()
  const inv = s.page.getByTestId('admin-purge-inventory')
  await expect(inv).toContainText('4 instantanés, 12 objets, 3.0 Mo')
  const purge = inv.getByRole('button', { name: 'Purger' })
  await expect(purge).toBeDisabled()
  await inv.getByLabel("Clé d'accès de purge").fill('purge-access')
  await inv.getByLabel('Clé secrète de purge').fill('purge-secret')
  await inv.getByRole('checkbox').check()
  await expect(inv.getByRole('alert')).toContainText('définitivement perdues')
  await purge.click()
  const dialog = s.page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Purger' })).toBeDisabled()
  await dialog.getByRole('textbox').fill('ancien')
  await expect(dialog.getByRole('button', { name: 'Purger' })).toBeDisabled()
  await dialog.getByRole('textbox').fill('supprimer définitivement les sauvegardes de ancien')
  await dialog.getByRole('button', { name: 'Purger' }).click()
  await expect(s.page.getByTestId('admin-job').getByTestId('admin-job-state')).toHaveText('Réussi', { timeout: 10_000 })
  // Les clés saisies ont été vidées et ne sont jamais réaffichées.
  await expect(s.page.getByTestId('admin-purge-inventory')).toHaveCount(0)
})

test('S5-16, S5-19, S5-20, S5-21 — utilisateurs : import CSV, rapport d\'accès, invitation, lien forge', async () => {
  await openTab(s.page, 'Utilisateurs')
  await s.page.getByLabel('Fichier CSV').setInputFiles({ name: 'users.csv', mimeType: 'text/csv', buffer: Buffer.from('login,email\nzoe,z@x.test\nyann,y@x.test\nzoe,z@x.test\n') })
  const preview = s.page.getByTestId('admin-import-preview')
  await expect(preview).toContainText('2 ligne(s) valide(s), 1 rejetée(s).')
  await expect(preview).toContainText('Ligne 4 zoe : login en double')
  await expect(preview).toContainText('Équipes inconnues (ignorées) : inconnue')
  await preview.getByRole('button', { name: 'Créer 2 compte(s)' }).click()
  const job = s.page.getByTestId('admin-job')
  await expect(job.getByTestId('admin-job-state')).toHaveText('Réussi', { timeout: 10_000 })
  await job.getByRole('button', { name: 'Afficher la valeur à usage unique' }).click()
  await expect(s.page.getByTestId('admin-secret')).toContainText('zoe')
  await expect(s.page.getByTestId('admin-secret')).toContainText('yann')
  const [pwFile] = await Promise.all([s.page.waitForEvent('download'), s.page.getByTestId('admin-secret').getByRole('button', { name: 'Télécharger' }).click()])
  expect(pwFile.suggestedFilename()).toMatch(/\.csv$/)

  const report = s.page.getByTestId('admin-access-report')
  await expect(report.getByRole('row')).toHaveCount(4)
  await s.page.getByLabel('Filtrer par utilisateur ou dépôt').fill('moteur')
  await expect(report.getByRole('row')).toHaveCount(2)

  await s.page.getByRole('textbox', { name: 'Login' }).fill('zoe')
  await s.page.getByRole('button', { name: 'Préparer le message' }).click()
  await expect(s.page.getByTestId('admin-invite')).toContainText('polenta://connect?server=https://acme.forge.test&login=zoe')

  const forge = s.page.getByRole('link', { name: /Administration de la forge/ })
  await expect(forge).toHaveAttribute('target', '_blank')
  await expect(forge).toHaveAttribute('rel', /noopener/)
  await s.shot('gh63-s5-users')
})
