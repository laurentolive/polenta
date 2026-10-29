import { test, expect, type Page } from '@playwright/test'
import { activityBar, setupSession } from './support/session'

/**
 * GH56 — ActivityBar personnalisable : ordre par drag & drop, boutons masqués par clic droit.
 * Scénarios E1–E7 et cas limites L1–L3, L5, L6 de specs/GH56-tests.md.
 */
const s = setupSession()

const KEY = 'polenta.activityBarLayout'
const DEFAULT_TITLES = [
  'Compte', 'Projet', 'Suivi', 'Exigences', 'Tests', 'Campagnes', 'Changements', 'Paramètres', 'Recherche', 'Version',
]

function button(page: Page, title: string) {
  return activityBar(page).and(page.locator(`[title="${title}"]`))
}

async function titles(page: Page): Promise<string[]> {
  return activityBar(page).evaluateAll(els => els.map(e => e.getAttribute('title') ?? ''))
}

async function storedLayout(page: Page): Promise<string | null> {
  return page.evaluate(k => localStorage.getItem(k), KEY)
}

/** Glisse `from` sur la moitié haute de `to` (dépôt « avant »). */
async function dragBefore(page: Page, from: string, to: string) {
  await button(page, from).dragTo(button(page, to), { targetPosition: { x: 24, y: 8 } })
}

async function openMenu(page: Page, title: string | null) {
  if (title) await button(page, title).click({ button: 'right' })
  // Zone vide de la barre, sous le dernier bouton.
  else await page.locator('div.w-12.bg-activity-bg').click({ button: 'right', position: { x: 24, y: 700 } })
  await expect(page.getByRole('menu')).toBeVisible()
}

test.beforeEach(async () => {
  await s.page.evaluate(k => localStorage.removeItem(k), KEY)
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
})

test('E1 — drag & drop : Version avant Suivi, persistant', async () => {
  expect(await titles(s.page)).toEqual(DEFAULT_TITLES)
  await dragBefore(s.page, 'Version', 'Suivi')
  const expected = ['Compte', 'Projet', 'Version', 'Suivi', 'Exigences', 'Tests', 'Campagnes', 'Changements', 'Paramètres', 'Recherche']
  expect(await titles(s.page)).toEqual(expected)
  await s.page.reload()
  expect(await titles(s.page)).toEqual(expected)
  await s.shot('gh56-e1-ordre')
})

test('E2/E3 — masquer par clic droit puis réafficher depuis la zone vide', async () => {
  await openMenu(s.page, 'Recherche')
  await s.page.getByRole('menuitem', { name: 'Masquer « Recherche »' }).click()
  await expect(button(s.page, 'Recherche')).toHaveCount(0)
  await s.page.reload()
  await expect(button(s.page, 'Recherche')).toHaveCount(0)

  await openMenu(s.page, null)
  await s.shot('gh56-e3-menu')
  const entry = s.page.getByRole('menuitemcheckbox', { name: 'Recherche' })
  await expect(entry).toHaveAttribute('aria-checked', 'false')
  await entry.click()
  expect(await titles(s.page)).toEqual(DEFAULT_TITLES)
})

test('E4 — Compte et Projet non masquables', async () => {
  await openMenu(s.page, 'Compte')
  await expect(s.page.getByRole('menuitem', { name: /^Masquer/ })).toHaveCount(0)
  for (const name of ['Compte', 'Projet']) {
    const entry = s.page.getByRole('menuitemcheckbox', { name, exact: true })
    await expect(entry).toHaveAttribute('aria-disabled', 'true')
    await expect(entry).toHaveAttribute('aria-checked', 'true')
  }
  await s.page.getByRole('menuitemcheckbox', { name: 'Projet', exact: true }).click({ force: true })
  await expect(button(s.page, 'Projet')).toHaveCount(1)
  await s.page.keyboard.press('Escape')
})

test('E5 — réinitialiser la disposition', async () => {
  await dragBefore(s.page, 'Version', 'Suivi')
  await openMenu(s.page, 'Tests')
  await s.page.getByRole('menuitem', { name: 'Masquer « Tests »' }).click()
  expect(await titles(s.page)).not.toEqual(DEFAULT_TITLES)

  await openMenu(s.page, null)
  await s.page.getByRole('menuitem', { name: 'Réinitialiser la disposition' }).click()
  expect(await titles(s.page)).toEqual(DEFAULT_TITLES)
  expect(await storedLayout(s.page)).toBeNull()
})

test('E6 — un clic simple sur un bouton réordonné navigue', async () => {
  await dragBefore(s.page, 'Exigences', 'Compte')
  await s.openView('Exigences')
  await expect(s.page).toHaveURL(/category=requirement/)
})

test('L2 — masquer le panneau actif laisse la vue affichée', async () => {
  await s.openView('Exigences')
  const url = s.page.url()
  await openMenu(s.page, 'Exigences')
  await s.page.getByRole('menuitem', { name: 'Masquer « Exigences »' }).click()
  await expect(button(s.page, 'Exigences')).toHaveCount(0)
  expect(s.page.url()).toBe(url)
})

test('L3 — dépôt à la position d\'origine : aucun changement', async () => {
  await button(s.page, 'Version').dragTo(button(s.page, 'Version'))
  expect(await storedLayout(s.page)).toBeNull()
  expect(await titles(s.page)).toEqual(DEFAULT_TITLES)
})

test('L5 — clic extérieur et Échap ferment le menu sans rien changer', async () => {
  await openMenu(s.page, 'Version')
  await s.page.keyboard.press('Escape')
  await expect(s.page.getByRole('menu')).toHaveCount(0)
  await openMenu(s.page, 'Version')
  await s.page.mouse.click(600, 300)
  await expect(s.page.getByRole('menu')).toHaveCount(0)
  expect(await storedLayout(s.page)).toBeNull()
})

test('L6 — préférence corrompue : disposition par défaut', async () => {
  await s.page.evaluate(k => localStorage.setItem(k, '{'), KEY)
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  expect(await titles(s.page)).toEqual(DEFAULT_TITLES)
})

test('E7/L1 — préférence commune aux projets ; bouton grisé déplaçable', async () => {
  await dragBefore(s.page, 'Version', 'Suivi')
  const ordered = await titles(s.page)
  await s.cloneAndOpen('demo-ll800-produit', 'gh56-second')
  expect(await titles(s.page)).toEqual(ordered)

  // Sans projet : les boutons de projet sont grisés mais restent déplaçables.
  await s.invoke('workspace:clear-last-opened')
  await s.page.goto('/')
  await s.page.waitForLoadState('networkidle')
  await expect(button(s.page, 'Exigences')).toHaveAttribute('aria-disabled', 'true')
  await dragBefore(s.page, 'Exigences', 'Projet')
  expect((await titles(s.page)).slice(0, 2)).toEqual(['Compte', 'Exigences'])
})
