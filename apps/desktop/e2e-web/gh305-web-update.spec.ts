import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { E2E } from './support/env'

/**
 * GH305 — mise à jour du client web en un clic (specs/GH305-tests.md E1 à E5), contre le faux
 * service d'administration : popover W2 de l'administrateur (confirmation, travail `web.update`
 * lancé sur son instance avec la version de la release, échec affiché) et formulaire « Client web »
 * d'Administration › Instances (prérempli, saisie libre). La réponse de `web:update-state` est simulée.
 */
const s = setupSession({ project: null })

const UPDATE_STATE = /\/rpc\/web(?:%3A|:)update-state$/
const badge = (page: Page) => page.locator('[data-update-state]')

interface FakeJob { id: string; operation: string; instance: string | null; params: Record<string, unknown>; state: string }

async function setRole(level: 'instance' | 'host' | null, opts: { durationMs?: number; fail?: string[] } = {}) {
  const res = await fetch(`${E2E.adminUrl}/__role`, { method: 'POST', body: JSON.stringify({ level, durationMs: opts.durationMs ?? 1500, fail: opts.fail ?? [] }) })
  expect(res.ok).toBe(true)
}

async function webJobs(): Promise<FakeJob[]> {
  const res = await fetch(`${E2E.adminUrl}/__jobs`)
  return ((await res.json()) as { jobs: FakeJob[] }).jobs.filter(j => j.operation === 'web.update')
}

let served: string

async function withRelease(page: Page) {
  await page.unroute(UPDATE_STATE)
  await page.route(UPDATE_STATE, route => route.fulfill({
    json: { ok: true, value: { status: 'available', currentVersion: served, availableVersion: '99.0.0', releaseUrl: 'https://example.org/releases/v99.0.0' } },
  }))
  await page.reload()
  await page.waitForLoadState('networkidle')
}

async function openAdmin(page: Page) {
  const entry = page.getByTestId('account-admin')
  if (!(await entry.isVisible())) await s.openView('Compte')
  await entry.click()
  await expect(page.getByRole('tablist', { name: 'Administration' })).toBeVisible()
}

test.beforeAll(async () => {
  served = await s.invoke<string>('app:get-version')
})

test.afterEach(async () => {
  await s.page.unrouteAll({ behavior: 'ignoreErrors' })
  await setRole(null)
})

test('E1 / E2 — popover administrateur : confirmation annonçant la coupure, « Annuler » ne lance rien, puis travail web.update suivi', async () => {
  await setRole('instance')
  await withRelease(s.page)
  const before = (await webJobs()).length

  await badge(s.page).click()
  const popover = s.page.getByRole('dialog')
  await popover.getByRole('button', { name: 'Mettre à jour vers v99.0.0' }).click()
  const confirm = popover.getByTestId('web-update-confirm')
  await expect(confirm).toContainText('Le client web de acme passe en v99.0.0')
  await expect(confirm).toContainText('tous les utilisateurs')
  await confirm.getByRole('button', { name: 'Annuler' }).click()
  expect((await webJobs()).length).toBe(before)

  await popover.getByRole('button', { name: 'Mettre à jour vers v99.0.0' }).click()
  await s.shot('gh305-e1-confirm')
  await popover.getByTestId('web-update-confirm').getByRole('button', { name: 'Mettre à jour' }).click()
  const progress = popover.getByTestId('web-update-progress')
  await expect(progress).toContainText('Mise à jour du client web en cours')
  await expect.poll(async () => (await webJobs()).length).toBe(before + 1)
  const job = (await webJobs()).pop()!
  expect(job).toMatchObject({ instance: 'acme', params: { version: '99.0.0' } })
  await expect(progress).toHaveAttribute('data-job-state', 'succeeded', { timeout: 15_000 })
  await expect(progress).toContainText('Client web mis à jour')

  // Popover fermé puis rouvert : le suivi du travail est conservé.
  await s.page.keyboard.press('Escape')
  await badge(s.page).click()
  await expect(s.page.getByRole('dialog').getByTestId('web-update-progress')).toHaveAttribute('data-job-state', 'succeeded')
  await s.shot('gh305-e2-done')
})

test('E3 — échec du travail : message affiché, « Réessayer » repropose la mise à jour', async () => {
  await setRole('instance', { fail: ['web.update'] })
  await withRelease(s.page)
  await badge(s.page).click()
  const popover = s.page.getByRole('dialog')
  await popover.getByRole('button', { name: 'Mettre à jour vers v99.0.0' }).click()
  await popover.getByTestId('web-update-confirm').getByRole('button', { name: 'Mettre à jour' }).click()
  const progress = popover.getByTestId('web-update-progress')
  await expect(progress).toHaveAttribute('data-job-state', 'failed', { timeout: 15_000 })
  await expect(progress.getByRole('alert')).toContainText('La mise à jour a échoué : image introuvable')
  await s.shot('gh305-e3-failed')
  await progress.getByRole('button', { name: 'Réessayer' }).click()
  await expect(popover.getByRole('button', { name: 'Mettre à jour vers v99.0.0' })).toBeVisible()
})

test('E4 — Administration › Instances : formulaire « Client web » seulement avec client web, prérempli avec la release, saisie libre', async () => {
  await setRole('host')
  await withRelease(s.page)
  await openAdmin(s.page)
  const table = s.page.getByTestId('admin-instances')
  await expect(table.getByLabel('Version du client web pour acme')).toHaveValue('99.0.0')
  await expect(table.getByLabel('Version du client web pour ops')).toHaveValue('99.0.0')
  await expect(table.getByLabel('Version du client web pour globex')).toHaveCount(0)
  await expect(table.locator('tr', { hasText: 'acme' }).first()).toContainText('web 0.3.2')

  const before = (await webJobs()).length
  await table.getByLabel('Version du client web pour acme').fill('0.3.1')
  await table.locator('tr', { hasText: 'acme.forge.test' }).getByRole('button', { name: 'Mettre à jour le client web' }).click()
  const dialog = s.page.getByRole('dialog')
  await expect(dialog).toContainText('Mettre à jour le client web de acme en 0.3.1 ?')
  await s.shot('gh305-e4-instances')
  await dialog.getByRole('button', { name: 'Mettre à jour' }).click()
  await expect.poll(async () => (await webJobs()).length).toBe(before + 1)
  expect((await webJobs()).pop()).toMatchObject({ instance: 'acme', params: { version: '0.3.1' } })
})

test('E5 — non-administrateur : ni bouton de mise à jour, ni route accessible', async () => {
  s.allowConsoleErrors(/403/)
  await setRole(null)
  await withRelease(s.page)
  await expect(badge(s.page)).toHaveCount(0)
  const status = await s.page.evaluate(async () => (await fetch('/admin/api/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'web.update', instance: 'acme', params: { version: '99.0.0' }, confirm: true }),
  })).status)
  expect([401, 403]).toContain(status)
})
