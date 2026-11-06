import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH300 — la position de défilement du Tableau et du Document est retrouvée au retour sur un
 * onglet, et au retour sur une vue après une bascule Tableau ↔ Document.
 */
const s = setupSession()
test.beforeEach(async () => {
  s.allowConsoleErrors(/status of 404/)
  // Fenêtre basse et étroite : le Tableau de la démo défile dans les deux sens.
  await s.page.setViewportSize({ width: 1000, height: 420 })
})

const scroller = () => s.page.locator('[data-view-scroll]')
const param = (name: string) => new URL(s.page.url()).searchParams.get(name)
const tableView = () => s.page.getByTitle('Vue tableau')
const documentView = () => s.page.getByTitle('Vue document')
const tabs = () => s.page.locator('div.overflow-x-auto > button:not([title^="Nouvel onglet"])')

async function scrollTo(top: number, left = 0): Promise<{ top: number; left: number }> {
  await scroller().evaluate((el, [t, l]) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) * t
    el.scrollLeft = (el.scrollWidth - el.clientWidth) * l
  }, [top, left])
  await s.page.waitForTimeout(400)
  return position()
}

const position = () => scroller().evaluate(el => ({ top: Math.round(el.scrollTop), left: Math.round(el.scrollLeft) }))

async function expectPosition(expected: { top: number; left: number }) {
  await expect(scroller()).toBeVisible()
  await expect.poll(async () => {
    const p = await position()
    return Math.abs(p.top - expected.top) <= 2 && Math.abs(p.left - expected.left) <= 2
  }, { message: `position attendue ${JSON.stringify(expected)}` }).toBe(true)
  // Pas de recalage tardif (rendu complet des lignes, ancrage…).
  await s.page.waitForTimeout(500)
  const p = await position()
  expect(Math.abs(p.top - expected.top)).toBeLessThanOrEqual(2)
  expect(Math.abs(p.left - expected.left)).toBeLessThanOrEqual(2)
}

async function roundTripThroughNewTab() {
  const count = await tabs().count()
  // Onglet de départ = onglet actif (fond `bg-canvas`), les scénarios précédents en ont laissé d'autres.
  const start = (await tabs().evaluateAll(els => els.map(el => el.classList.contains('bg-canvas')))).indexOf(true)
  expect(start).toBeGreaterThanOrEqual(0)
  await s.page.getByTitle('Nouvel onglet (Ctrl+T)').click()
  await expect(tabs()).toHaveCount(count + 1)
  await tabs().nth(start).click()
}

async function clearSelection() {
  // Clic dans le vide de l'arbre : plus de cible goto ni d'`item`.
  await s.page.getByTestId('sidebar').locator('div.min-h-12').last().click()
  await expect.poll(() => param('item')).toBeNull()
}

test('R1 — Tableau : position retrouvée au retour sur l\'onglet', async () => {
  await s.openView('Exigences')
  await clearSelection()
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  const p = await scrollTo(0.6, 0.5)
  expect(p.top).toBeGreaterThan(0)
  expect(p.left).toBeGreaterThan(0)
  await roundTripThroughNewTab()
  await expect.poll(() => param('view')).toBe('excel')
  await expectPosition(p)
})

test('R2 — Document : position retrouvée au retour sur l\'onglet', async () => {
  await s.openView('Exigences')
  await clearSelection()
  await documentView().click()
  await expect.poll(() => param('view')).toBe('word')
  const p = await scrollTo(0.6)
  expect(p.top).toBeGreaterThan(0)
  await roundTripThroughNewTab()
  await expect.poll(() => param('view')).toBe('word')
  await expectPosition(p)
})

test('R3 — défilement après une bascule Tableau ↔ Document : retrouvé au retour sur l\'onglet', async () => {
  await s.openView('Exigences')
  await clearSelection()
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  await scrollTo(0.5)
  await documentView().click()
  await expect.poll(() => param('view')).toBe('word')
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  await s.page.waitForTimeout(400)
  const p = await scrollTo(0.1, 0.3)
  await roundTripThroughNewTab()
  await expectPosition(p)
})

test('R4 — Tableau : position retrouvée par Précédent après une autre vue', async () => {
  await s.openView('Exigences')
  await clearSelection()
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  const p = await scrollTo(0.6, 0.5)
  await documentView().click()
  await expect.poll(() => param('view')).toBe('word')
  await scrollTo(0.1)
  await s.page.getByTestId('history-back').click()
  await expect.poll(() => param('view')).toBe('excel')
  await expectPosition(p)
})

test('R5 — après le retour sur l\'onglet, un clic dans l\'arbre l\'emporte sur la position mémorisée', async () => {
  await s.openView('Exigences')
  await clearSelection()
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  const p = await scrollTo(0, 0.5)
  await roundTripThroughNewTab()
  await expectPosition(p)
  await s.page.getByTestId('sidebar').getByText('Performance', { exact: true }).click()
  // Section en haut de la vue (GH230 E8) : la cible l'emporte sur la position rétablie.
  await expect.poll(() => scroller().evaluate(el => {
    const box = el.getBoundingClientRect()
    for (const row of el.querySelectorAll<HTMLElement>('[data-node-id]')) {
      const r = row.getBoundingClientRect()
      const top = box.top + (parseFloat(getComputedStyle(row).scrollMarginTop) || 0)
      if ((r.top + r.bottom) / 2 >= top) return row.textContent ?? ''
    }
    return ''
  })).toContain('Performance')
})

test('R6 — Tableau : position retrouvée à chaque retour sur l\'onglet, y compris après un nouveau défilement', async () => {
  await s.openView('Exigences')
  await clearSelection()
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  const p1 = await scrollTo(0.7, 0.2)
  await roundTripThroughNewTab()
  await expectPosition(p1)
  await roundTripThroughNewTab()
  await expectPosition(p1)
  const p2 = await scrollTo(0.3, 0.6)
  await roundTripThroughNewTab()
  await expectPosition(p2)
})
