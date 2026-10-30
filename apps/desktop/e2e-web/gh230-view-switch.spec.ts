import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH230 — la bascule Tableau ↔ Document montre le même élément : l'élément sélectionné (contour,
 * `item`) ou, à défaut, le premier affiché (aligné en haut, ancrage `top`), y compris au retour
 * Précédent / Suivant. Scénarios E1–E7 de specs/GH230-tests.md.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(async () => {
  s.allowConsoleErrors(/status of 404/)
  // Fenêtre basse : le Tableau de la démo (15 exigences) doit défiler.
  await s.page.setViewportSize({ width: 1440, height: 420 })
})

const sidebar = () => s.page.getByTestId('sidebar')
const scroller = () => s.page.locator('[data-view-scroll]')
const param = (name: string) => new URL(s.page.url()).searchParams.get(name)
const tableView = () => s.page.getByTitle('Vue tableau')
const documentView = () => s.page.getByTitle('Vue document')

/** Lignes d'objet du Tableau (`tr.group`, pas les titres de dossier) et cartes du Document. */
const OBJECT_NODES = 'tr.group[data-node-id], div[data-node-id]'

async function scrollToMiddle(): Promise<void> {
  await scroller().evaluate(el => { el.scrollTop = (el.scrollHeight - el.clientHeight) / 2 })
  await s.page.waitForTimeout(200)
}

/** Premier nœud de `selector` dont le milieu est sous le haut de la zone (scroll-margin compris). */
async function firstVisible(selector = '[data-node-id]'): Promise<{ nodeId: string; text: string }> {
  return scroller().evaluate((area, sel) => {
    const box = area.getBoundingClientRect()
    for (const el of area.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect()
      const top = box.top + (parseFloat(getComputedStyle(el).scrollMarginTop) || 0)
      if ((r.top + r.bottom) / 2 >= top) return { nodeId: el.dataset.nodeId!, text: el.textContent ?? '' }
    }
    return { nodeId: '', text: '' }
  }, selector)
}

/** L'objet `objectId` est le premier élément affiché en haut de la vue. */
async function expectAtTop(objectId: string) {
  await expect.poll(async () => (await firstVisible()).text).toContain(objectId)
}

async function expectOutlined(nodeId: string, outlined: boolean) {
  const cls = await s.page.locator(`[data-view-scroll] [data-node-id="${nodeId}"]`).first().getAttribute('class')
  expect(/outline-2|ring-2/.test(cls ?? '')).toBe(outlined)
}

test('E1/E2/E3 — premier élément affiché conservé, Précédent / Suivant y reviennent', async () => {
  await s.openView('Exigences')
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  await expect(scroller()).toBeVisible()
  await scrollToMiddle()
  const { nodeId } = await firstVisible(OBJECT_NODES)
  expect(nodeId).toBeTruthy()

  await documentView().click()
  await expect.poll(() => param('view')).toBe('word')
  const top = param('top')!
  expect(top).toBeTruthy()
  expect(param('item')).toBeNull()
  await expect.poll(async () => (await firstVisible()).nodeId).toBe(nodeId)
  await expectAtTop(top)
  await expectOutlined(nodeId, false)
  await s.shot('gh230-e1-document')

  // E2 — retour au Tableau par le bouton : même élément en haut.
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  await expectAtTop(top)

  // E3 — Précédent : Document, ancrage conservé ; encore Précédent : Tableau de départ, idem.
  await s.page.getByTestId('history-back').click()
  await expect.poll(() => param('view')).toBe('word')
  expect(param('top')).toBe(top)
  await expectAtTop(top)
  await s.page.getByTestId('history-back').click()
  await expect.poll(() => param('view')).toBe('excel')
  expect(param('top')).toBe(top)
  await expectAtTop(top)
  await s.page.getByTestId('history-forward').click()
  await expect.poll(() => param('view')).toBe('word')
  await expectAtTop(top)
})

test('E4 — élément ciblé dans l\'arbre : contour et item après la bascule', async () => {
  await s.openView('Exigences')
  await documentView().click()
  await expect.poll(() => param('view')).toBe('word')
  await sidebar().getByText('Réglementaire', { exact: true }).dblclick()
  await sidebar().getByText('Protection anti-débordement', { exact: true }).click()
  await expect.poll(() => param('item')).toBeTruthy()
  const item = param('item')!
  const target = s.page.locator('[data-view-scroll] [data-node-id].ring-2')
  await expect(target).toHaveCount(1)
  const nodeId = (await target.getAttribute('data-node-id'))!
  await scroller().evaluate(el => { el.scrollTop = 0 })

  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  expect(param('item')).toBe(item)
  const row = s.page.locator(`[data-view-scroll] [data-node-id="${nodeId}"]`)
  await expect(row).toBeInViewport()
  await expectOutlined(nodeId, true)
})

test('E5 — ligne sélectionnée dans le Tableau : contour après la bascule', async () => {
  await s.openView('Exigences')
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  await scrollToMiddle()
  const { nodeId } = await firstVisible(OBJECT_NODES)
  await s.page.locator(`[data-view-scroll] [data-node-id="${nodeId}"] td`).last().click()
  await expect(s.page.locator(`[data-node-id="${nodeId}"][data-selected]`)).toHaveCount(1)

  await documentView().click()
  await expect.poll(() => param('view')).toBe('word')
  expect(param('item')).toBeTruthy()
  await expect(s.page.locator(`[data-view-scroll] [data-node-id="${nodeId}"]`)).toBeInViewport()
  await expectOutlined(nodeId, true)
})

test('E6/E7 — depuis l\'Édition : élément édité ; bouton du mode actif sans effet', async () => {
  await s.openView('Exigences')
  await documentView().click()
  await expect.poll(() => param('view')).toBe('word')
  // Carte éditable (une exigence approuvée n'a que « Retour en brouillon »), loin du haut.
  const card = s.page.locator('[data-view-scroll] div[data-node-id]:has([title="Éditer"])').last()
  const nodeId = (await card.getAttribute('data-node-id'))!
  await card.getByTitle('Éditer').first().click()
  await expect.poll(() => param('view')).toBe('edit')
  const item = param('item')

  await documentView().click()
  await expect.poll(() => param('view')).toBe('word')
  expect(param('item')).toBe(item)
  await expect(s.page.locator(`[data-view-scroll] [data-node-id="${nodeId}"]`)).toBeInViewport()
  await expectOutlined(nodeId, true)

  // E7 — re-clic sur Document : URL inchangée, pas de nouvelle page.
  const url = s.page.url()
  await documentView().click()
  await s.page.waitForTimeout(200)
  expect(s.page.url()).toBe(url)
  await s.page.getByTestId('history-back').click()
  await expect.poll(() => param('view')).toBe('edit')
})

test('E8 — section choisie dans l\'arbre juste après la bascule : en haut de la vue, ancrage retiré', async () => {
  await s.openView('Exigences')
  // Clic dans le vide de l'arbre : plus de cible goto ni d'`item` laissés par les tests précédents.
  await sidebar().locator('div.min-h-12').last().click()
  await expect.poll(() => param('item')).toBeNull()
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  await scrollToMiddle()
  await documentView().click()
  await expect.poll(() => param('top')).toBeTruthy()
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  // Aussitôt affiché (rendu complet des lignes encore en cours) : la section l'emporte sur `top`.
  await sidebar().getByText('Performance', { exact: true }).click()
  await expect.poll(() => param('top')).toBeNull()
  await expect.poll(async () => (await firstVisible()).text).toContain('Performance')
  await s.page.waitForTimeout(300)
  expect((await firstVisible()).text).toContain('Performance')
})
