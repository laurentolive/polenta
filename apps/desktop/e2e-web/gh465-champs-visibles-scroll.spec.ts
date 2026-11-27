import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH465 — popup « Champs visibles » ouverte : les barres de défilement et la molette de la vue
 * principale restent utilisables sans fermer la popup. Un clic franc hors de la popup la ferme
 * toujours ; un geste commencé dans la popup et relâché sur la vue ne la ferme pas (GH352).
 */
const s = setupSession()

// Chromium headless masque les barres de défilement par défaut : on les affiche pour les cliquer.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

test.beforeEach(async () => {
  s.allowConsoleErrors(/status of 404/)
  // Fenêtre basse et étroite : le Tableau de la démo défile dans les deux sens (cf. GH300).
  await s.page.setViewportSize({ width: 1000, height: 420 })
})

const panel = () => s.page.getByTestId('field-config-panel')
const scroller = () => s.page.locator('[data-view-scroll]')
const scrollPos = async () => scroller().evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }))

/** Géométrie de la vue : épaisseur de la barre verticale, hauteur de la barre horizontale (0 si absente). */
async function geometry() {
  const box = (await scroller().boundingBox())!
  const bars = await scroller().evaluate((el: HTMLElement) => {
    const cs = getComputedStyle(el)
    const px = (p: string) => parseFloat(cs.getPropertyValue(p)) || 0
    return {
      vBar: el.offsetWidth - px('border-left-width') - px('border-right-width') - el.clientWidth,
      hBar: el.offsetHeight - px('border-top-width') - px('border-bottom-width') - el.clientHeight,
    }
  })
  return { box, ...bars }
}

/** Tableau en haut de la vue, popup « Champs visibles » ouverte. */
async function openPanelOnTable() {
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await expect(scroller()).toBeVisible()
  await scroller().evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0 })
  await s.page.getByTitle('Configurer les colonnes').click()
  await expect(panel()).toBeVisible()
  const g = await geometry()
  expect(g.vBar, 'barre verticale visible').toBeGreaterThan(0)
  expect(g.hBar, 'barre horizontale visible').toBeGreaterThan(0)
  return g
}

test('barre verticale : un clic sur la piste ne ferme pas la popup et fait défiler la vue', async () => {
  const g = await openPanelOnTable()
  await s.page.mouse.click(g.box.x + g.box.width - g.vBar / 2, g.box.y + g.box.height * 0.6)
  await expect(panel()).toBeVisible()
  expect((await scrollPos()).top).toBeGreaterThan(0)
})

test('barre horizontale : un clic sur la piste ne ferme pas la popup et fait défiler la vue', async () => {
  const g = await openPanelOnTable()
  // La popup couvre la fin de la barre horizontale : on part de la fin de la vue, le pouce est alors
  // à droite et la piste à gauche du pouce reste libre.
  await scroller().evaluate((el: HTMLElement) => { el.scrollLeft = el.scrollWidth })
  const before = (await scrollPos()).left
  expect(before).toBeGreaterThan(0)
  await s.page.mouse.click(g.box.x + 120, g.box.y + g.box.height - g.hBar / 2)
  await expect(panel()).toBeVisible()
  expect((await scrollPos()).left).toBeLessThan(before)
})

test('pouce de la barre verticale : la popup reste ouverte à chaque étape du glissement', async () => {
  const g = await openPanelOnTable()
  const x = g.box.x + g.box.width - g.vBar / 2
  const y0 = g.box.y + 30
  await s.page.mouse.move(x, y0)
  await s.page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await s.page.mouse.move(x, y0 + i * 15)
    // Chaque image du geste, pas seulement l'état final (cf. lessons : états intermédiaires).
    await expect(panel()).toBeVisible()
  }
  await s.page.mouse.up()
  await expect(panel()).toBeVisible()
  expect((await scrollPos()).top).toBeGreaterThan(0)
})

test('molette sur la vue : la popup reste ouverte et la vue défile', async () => {
  const g = await openPanelOnTable()
  await s.page.mouse.move(g.box.x + g.box.width * 0.4, g.box.y + g.box.height * 0.5)
  await s.page.mouse.wheel(0, 200)
  await expect.poll(async () => (await scrollPos()).top).toBeGreaterThan(0)
  await expect(panel()).toBeVisible()
})

test('clic franc sur la vue : la popup se ferme toujours', async () => {
  const g = await openPanelOnTable()
  await s.page.mouse.click(g.box.x + g.box.width * 0.4, g.box.y + g.box.height * 0.5)
  await expect(panel()).toBeHidden()
})

test('appui dans la popup, relâché sur la vue : la popup reste ouverte (GH352)', async () => {
  const g = await openPanelOnTable()
  const label = panel().locator('[data-testid^="field-config-field-"]').first()
  const b = (await label.boundingBox())!
  await s.page.mouse.move(b.x + 5, b.y + b.height / 2)
  await s.page.mouse.down()
  await s.page.mouse.move(g.box.x + g.box.width * 0.4, g.box.y + g.box.height * 0.5, { steps: 5 })
  await s.page.mouse.up()
  await expect(panel()).toBeVisible()
})
