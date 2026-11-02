import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH229 — liens de navigation sur les ID d'élément (+ #236) : clic = page de la cible dans le
 * même type de vue, élément sélectionné ; Ctrl+clic = nouvel onglet, onglet source intact ; survol
 * de 500 ms = popup d'aperçu configurable (onglet « Popup » du ⚙️). Scénarios de
 * specs/GH229-tests.md.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const param = (name: string) => new URL(s.page.url()).searchParams.get(name)
const linkCells = () => s.page.locator('td[data-link-cell]')
const links = () => linkCells().locator('[data-element-link]')
const preview = () => s.page.getByTestId('element-preview')
const tabs = () => s.page.locator('button.group[title]')

/** Vue tableau des exigences, toutes les colonnes de lien affichées (masquées par défaut). */
async function openExcelWithLinks() {
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
  if (await linkCells().count() === 0) {
    await s.page.getByTitle('Configurer les colonnes').click()
    const modal = s.page.getByTestId('field-config-panel')
    const section = modal.locator('div.border-t').filter({ has: s.page.getByText('Liens', { exact: true }) })
    for (const box of await section.getByRole('checkbox').all()) await box.check()
    await modal.click({ position: { x: 5, y: 5 } })
  }
  await expect(links().first()).toBeVisible()
}

/** Premier lien d'une cellule vers un test (exigence → test vérifiant). */
async function firstTestLink() {
  const testIds = new Set((await s.invoke<Array<{ id: string }>>('tests:list', s.project.localPath)).map(t => t.id))
  for (const link of await links().all()) {
    const id = (await link.getAttribute('data-element-link'))!
    if (testIds.has(id)) return { link, id }
  }
  throw new Error('aucun lien vers un test dans le Tableau des exigences')
}

test('N1 / #236 — clic : page de la cible en Tableau, élément sélectionné, Précédent revient', async () => {
  await openExcelWithLinks()
  const { link, id } = await firstTestLink()
  const before = s.page.url()

  await link.click()

  await expect.poll(() => param('item')).toBe(id)
  expect(param('view')).toBe('excel')
  expect(param('category')).toBe('test')
  // Pas de page vide : la ligne de la cible est affichée, contourée et sélectionnée.
  const row = s.page.locator('tr[data-node-id]').filter({ has: s.page.locator('td', { hasText: id }) }).first()
  await expect(row).toBeVisible()
  await expect(row).toHaveClass(/outline-2/)
  await expect(row).toHaveAttribute('data-selected', '')
  // Arbre de la barre latérale : une seule ligne sélectionnée.
  await expect(s.page.locator('[data-tree-node].bg-status-info-solid')).toHaveCount(1)
  await s.shot('gh229-n1-target')

  await s.page.getByTestId('history-back').click()
  await expect.poll(() => s.page.url()).toBe(before)
})

test('L9 — clic sur un ID : ni sélection de ligne, ni édition de la cellule', async () => {
  await openExcelWithLinks()
  const { link } = await firstTestLink()
  await link.click({ modifiers: ['Control'] })
  // Nouvel onglet ouvert : on revient au premier sans rien vérifier d'autre ici (N4).
  await tabs().first().click()
  await expect(s.page.locator('div[data-link-popover]')).toHaveCount(0)
  await expect(s.page.locator('td[data-link-cell] [contenteditable], td[data-link-cell] input')).toHaveCount(0)
})

test('N4 / #236 — Ctrl+clic : nouvel onglet sur la cible, onglet source inchangé', async () => {
  await openExcelWithLinks()
  const { link, id } = await firstTestLink()
  const sourceUrl = s.page.url()
  const count = await tabs().count()
  // Historique de l'onglet source (GH228) : état des boutons avant le Ctrl+clic.
  const backBefore = await s.page.getByTestId('history-back').isEnabled()
  const forwardBefore = await s.page.getByTestId('history-forward').isEnabled()

  await link.click({ modifiers: ['Control'] })

  await expect(tabs()).toHaveCount(count + 1)
  await expect.poll(() => param('item')).toBe(id)
  expect(param('view')).toBe('excel')
  // Plus la fiche autonome /test/… : la vue système.
  expect(new URL(s.page.url()).pathname).toMatch(/\/product$/)

  await tabs().first().click()
  await expect.poll(() => s.page.url()).toBe(sourceUrl)
  // Ni entrée ajoutée ni entrée remplacée dans l'historique de l'onglet source.
  expect(await s.page.getByTestId('history-back').isEnabled()).toBe(backBefore)
  expect(await s.page.getByTestId('history-forward').isEnabled()).toBe(forwardBefore)
})

test('N5 / L7 / L8 — popup : 500 ms de survol, en-tête et titre, fermée en quittant', async () => {
  await openExcelWithLinks()
  const { link, id } = await firstTestLink()

  // L7 — survol bref : pas de popup.
  await link.hover()
  await s.page.mouse.move(0, 0)
  await s.page.waitForTimeout(700)
  await expect(preview()).toHaveCount(0)

  // N5 — survol immobile.
  await link.hover()
  await expect(preview()).toBeVisible({ timeout: 2_000 })
  await expect(preview().getByTestId('element-preview-id')).toHaveText(id)
  await expect(preview().getByTestId('element-preview-title')).not.toBeEmpty()
  await s.shot('gh229-n5-preview')

  // L8 — du lien à la popup : elle reste ouverte ; hors des deux : fermée.
  const box = (await preview().boundingBox())!
  await s.page.mouse.move(box.x + 20, box.y + 10)
  await s.page.waitForTimeout(400)
  await expect(preview()).toBeVisible()
  await s.page.mouse.move(2, 2)
  await expect(preview()).toHaveCount(0, { timeout: 1_000 })
})

test('N6 — onglet « Popup » du ⚙️ : champs de la popup, défaut aucun', async () => {
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.getByTitle('Configurer les colonnes').click()
  const modal = s.page.getByTestId('field-config-panel')
  await modal.getByRole('button', { name: 'Popup', exact: true }).click()
  await expect(modal.getByTestId('field-config-popup-hint')).toBeVisible()
  // Défaut : rien de coché, pas de case « titres des dossiers ».
  await expect(modal.getByTestId('field-config-show-folders')).toHaveCount(0)
  const boxes = modal.locator('input[type="checkbox"]:checked')
  await expect(boxes).toHaveCount(0)

  const version = modal.getByTestId('field-config-field-version')
  await version.check()
  // Persisté : panneau refermé puis rouvert, l'onglet Popup garde la case.
  await modal.click({ position: { x: 5, y: 5 } })
  await s.page.getByTitle('Configurer les colonnes').click()
  await modal.getByRole('button', { name: 'Popup', exact: true }).click()
  await expect(version).toBeChecked()
  // L'onglet Tableau n'est pas touché.
  await modal.getByRole('button', { name: 'Tableau', exact: true }).click()
  await expect(modal.getByTestId('field-config-show-folders')).toBeVisible()
  await modal.getByRole('button', { name: 'Popup', exact: true }).click()
  await modal.getByTestId('field-config-reset').click()
  await expect(version).not.toBeChecked()
  await s.page.keyboard.press('Escape')
})
