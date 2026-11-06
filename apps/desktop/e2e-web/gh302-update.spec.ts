import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { E2E } from './support/env'

/**
 * GH302 — mise à jour côté client web (specs/GH302-tests.md E1, E2) : un onglet ouvert détecte que
 * le serveur sert une nouvelle version (« Recharger la page », tout utilisateur) ; une release plus
 * récente n'est montrée qu'à l'administrateur de l'instance (faux service d'administration). La
 * réponse de `web:update-state` est simulée : le serveur de test ne contacte pas GitHub.
 */
const s = setupSession({ project: null })

const UPDATE_STATE = /\/rpc\/web(?:%3A|:)update-state$/

async function setRole(level: 'instance' | null) {
  const res = await fetch(`${E2E.adminUrl}/__role`, { method: 'POST', body: JSON.stringify({ level, durationMs: 1500 }) })
  expect(res.ok).toBe(true)
}

async function routeUpdateState(page: Page, value: Record<string, unknown>) {
  await page.unroute(UPDATE_STATE)
  await page.route(UPDATE_STATE, route => route.fulfill({ json: { ok: true, value } }))
}

const badge = (page: Page) => page.locator('[data-update-state]')

let served: string

test.beforeAll(async () => {
  served = await s.invoke<string>('app:get-version')
})

test.afterEach(async () => {
  await s.page.unrouteAll({ behavior: 'ignoreErrors' })
  await setRole(null)
})

test('E1 — le serveur sert une nouvelle version : « Recharger la page » pour tout utilisateur', async () => {
  await setRole(null)
  await s.page.clock.install()
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await expect(badge(s.page)).toHaveCount(0)

  // Redéploiement : le serveur répond désormais avec une autre version.
  await routeUpdateState(s.page, { status: 'idle', currentVersion: '99.0.0' })
  await s.page.clock.fastForward('05:01')
  await expect(badge(s.page)).toHaveAttribute('data-update-state', 'reload')

  await badge(s.page).click()
  const popover = s.page.getByRole('dialog')
  await expect(popover).toContainText('Nouvelle version en service')
  await expect(popover).toContainText(served)
  await s.shot('gh302-e1-recharger')

  // Après rechargement, la page exécute la version servie (ici : le serveur réel, réponse simulée
  // retirée) : plus rien à proposer.
  await s.page.unroute(UPDATE_STATE)
  await popover.getByRole('button', { name: 'Recharger la page' }).click()
  await s.page.waitForLoadState('networkidle')
  await expect(badge(s.page)).toHaveCount(0)
})

test('E2 — release disponible : visible pour l’administrateur avec la commande de mise à jour', async () => {
  await setRole('instance')
  await routeUpdateState(s.page, {
    status: 'available', currentVersion: served, availableVersion: '99.0.0', releaseUrl: 'https://example.org/releases/v99.0.0',
  })
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await expect(badge(s.page)).toHaveAttribute('data-update-state', 'release')

  await badge(s.page).click()
  const popover = s.page.getByRole('dialog')
  await expect(popover).toContainText(`Version actuelle ${served} → 99.0.0`)
  await expect(popover).toContainText('polenta-host instance web enable acme --version 99.0.0')
  const notes = popover.getByRole('link', { name: 'Voir les nouveautés' })
  await expect(notes).toHaveAttribute('href', 'https://example.org/releases/v99.0.0')
  // Lisible : couleur du texte différente du fond du popover (un jeton « -fg » est blanc).
  const [color, background] = await Promise.all([
    notes.evaluate(el => getComputedStyle(el).color),
    popover.evaluate(el => getComputedStyle(el).backgroundColor),
  ])
  expect(color).not.toBe(background)
  await s.shot('gh302-e2-release-admin')
})

test('E2b — release disponible : rien pour un utilisateur non administrateur', async () => {
  s.allowConsoleErrors(/403/)
  await setRole(null)
  await routeUpdateState(s.page, { status: 'available', currentVersion: served, availableVersion: '99.0.0' })
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await expect(badge(s.page)).toHaveCount(0)
})
