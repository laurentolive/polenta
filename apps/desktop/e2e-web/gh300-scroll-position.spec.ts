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

/** Position visible : premier nœud qui coupe le haut de la zone, son décalage, défilement
 *  horizontal — ce que voit l'utilisateur (le navigateur peut corriger `scrollTop` quand des lignes
 *  au-dessus changent de hauteur, sans déplacer le contenu affiché). */
interface Visible { node: string; offset: number; left: number }

function readVisible(el: HTMLElement): Visible {
  const area = el.getBoundingClientRect()
  for (const row of el.querySelectorAll<HTMLElement>('[data-node-id]')) {
    const r = row.getBoundingClientRect()
    if (r.height === 0 || r.bottom <= area.top) continue
    return { node: row.dataset.nodeId!, offset: Math.round(r.top - area.top), left: Math.round(el.scrollLeft) }
  }
  return { node: '', offset: 0, left: Math.round(el.scrollLeft) }
}

const position = () => scroller().evaluate(readVisible)
const same = (a: Visible, b: Visible) => a.node === b.node && Math.abs(a.offset - b.offset) <= 2 && Math.abs(a.left - b.left) <= 2

async function scrollTo(top: number, left = 0): Promise<Visible> {
  await scroller().evaluate((el, [t, l]) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) * t
    el.scrollLeft = (el.scrollWidth - el.clientWidth) * l
  }, [top, left])
  await s.page.waitForTimeout(400)
  return position()
}

async function expectPosition(expected: Visible) {
  await expect(scroller()).toBeVisible()
  await expect.poll(async () => { const p = await position(); return same(p, expected) ? 'ok' : JSON.stringify(p) }, { message: `position attendue ${JSON.stringify(expected)}` }).toBe('ok')
  // Pas de recalage tardif (rendu complet des lignes, ancrage…).
  await s.page.waitForTimeout(500)
  expect(await position()).toEqual(expect.objectContaining({ node: expected.node }))
  expect(same(await position(), expected)).toBe(true)
}

/** Échantillonne la position visible à chaque frame (installé avant le retour). */
async function startSampling() {
  await s.page.evaluate(`(() => {
    const readVisible = ${readVisible.toString()}
    window.__gh300 = []
    const start = performance.now()
    const tick = () => {
      const el = document.querySelector('[data-view-scroll]')
      // Seulement la page Exigences (l'onglet ou la vue quittés sont sur Tests).
      const onRequirements = new URL(location.href).searchParams.get('category') === 'requirement'
      if (onRequirements && el && el.querySelector('[data-node-id]')) window.__gh300.push(readVisible(el))
      if (performance.now() - start < 2500) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })()`)
}

/** Aucune frame peinte à une autre position que `expected` (pas d'à-coup). */
async function expectNoGlitch(expected: Visible) {
  await s.page.waitForTimeout(2600)
  const samples = await s.page.evaluate(() => (window as unknown as { __gh300: Visible[] }).__gh300)
  expect(samples.length).toBeGreaterThan(0)
  const off = samples.filter(p => !same(p, expected))
  expect(off, `frames hors position ${JSON.stringify(expected)} : ${JSON.stringify(off.slice(0, 5))}`).toEqual([])
}

async function roundTripThroughNewTab(sample = false) {
  const count = await tabs().count()
  // Onglet de départ = onglet actif (fond `bg-canvas`), les scénarios précédents en ont laissé d'autres.
  const start = (await tabs().evaluateAll(els => els.map(el => el.classList.contains('bg-canvas')))).indexOf(true)
  expect(start).toBeGreaterThanOrEqual(0)
  await s.page.getByTitle('Nouvel onglet (Ctrl+T)').click()
  await expect(tabs()).toHaveCount(count + 1)
  await s.openView('Tests')
  if (sample) await startSampling()
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
  expect(p.offset).toBeLessThanOrEqual(0)
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
  expect(p.node).toBeTruthy()
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

test('R7 — Tableau : position retrouvée après un passage par une autre vue (Exigences → Tests → Exigences), sans à-coup', async () => {
  await s.openView('Exigences')
  await clearSelection()
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  const p = await scrollTo(0.6, 0.5)
  await s.openView('Tests')
  await expect.poll(() => param('category')).not.toBe('requirement')
  await startSampling()
  await s.openView('Exigences')
  await expectPosition(p)
  await expectNoGlitch(p)
})

test("R8 — Tableau : pas d'à-coup au retour sur l'onglet, élément choisi dans l'arbre puis défilement", async () => {
  await s.openView('Exigences')
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  await s.page.getByTestId('sidebar').getByText('Réglementaire', { exact: true }).dblclick()
  await s.page.getByTestId('sidebar').getByText('Protection anti-débordement', { exact: true }).click()
  await expect.poll(() => param('item')).toBeTruthy()
  await s.page.waitForTimeout(400)
  const p = await scrollTo(0, 0.4)
  await roundTripThroughNewTab(true)
  await expectPosition(p)
  await expectNoGlitch(p)
})

test("R9 — Document : pas d'à-coup au retour sur l'onglet", async () => {
  await s.openView('Exigences')
  await clearSelection()
  await documentView().click()
  await expect.poll(() => param('view')).toBe('word')
  const p = await scrollTo(0.7)
  await roundTripThroughNewTab(true)
  await expectPosition(p)
  await expectNoGlitch(p)
})

test('R10 — Document : position retrouvée après Exigences → Tests → Exigences, sans à-coup', async () => {
  await s.openView('Exigences')
  await clearSelection()
  await documentView().click()
  await expect.poll(() => param('view')).toBe('word')
  const p = await scrollTo(0.5)
  await s.openView('Tests')
  await expect.poll(() => param('category')).not.toBe('requirement')
  await startSampling()
  await s.openView('Exigences')
  await expectPosition(p)
  await expectNoGlitch(p)
})

test("R11 — après le retour, re-cliquer l'élément sélectionné dans l'arbre le remet en vue", async () => {
  await s.openView('Exigences')
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  const sidebar = s.page.getByTestId('sidebar')
  const reg = sidebar.getByText('Protection anti-débordement', { exact: true })
  if (!(await reg.isVisible())) await sidebar.getByText('Réglementaire', { exact: true }).dblclick()
  await reg.click()
  await expect.poll(() => param('item')).toBeTruthy()
  const target = s.page.locator('[data-view-scroll] [data-node-id].outline-2, [data-view-scroll] [data-node-id][data-selected]').first()
  const nodeId = (await target.getAttribute('data-node-id'))!
  // Défilement qui sort la ligne de la vue : juste au-dessus si possible, sinon en dessous.
  await scroller().evaluate((el, id) => {
    const area = el.getBoundingClientRect()
    const r = el.querySelector(`[data-node-id="${id}"]`)!.getBoundingClientRect()
    const above = r.bottom - area.top + 40
    if (el.scrollTop + above <= el.scrollHeight - el.clientHeight) el.scrollTop += above
    else el.scrollTop -= area.bottom - r.top + 40
  }, nodeId)
  await s.page.waitForTimeout(400)
  const p = await position()
  await expect(s.page.locator(`[data-view-scroll] [data-node-id="${nodeId}"]`)).not.toBeInViewport()
  await roundTripThroughNewTab()
  await expectPosition(p)
  await expect(s.page.locator(`[data-view-scroll] [data-node-id="${nodeId}"]`)).not.toBeInViewport()
  await reg.click()
  await expect(s.page.locator(`[data-view-scroll] [data-node-id="${nodeId}"]`)).toBeInViewport()
})
