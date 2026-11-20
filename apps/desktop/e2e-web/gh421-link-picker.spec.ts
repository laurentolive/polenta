import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH421 — sélecteur d'ajout de lien (LinkCombobox, popover de cellule de lien en vue Tableau) :
 * ↓ ↑ parcourent les candidats, Entrée ajoute le candidat surligné ; un clic souris sur la ligne
 * ajoute le candidat ; survoler son ID ouvre la popup d'aperçu de l'élément (GH229). Échap ferme
 * le popover : couvert par GH169-2.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const popover = () => s.page.locator('div[data-link-popover]')
const linkCells = () => s.page.locator('td[data-link-cell]')
const options = () => popover().locator('[role="option"]')

/** Vue tableau des exigences, toutes les colonnes de lien affichées (masquées par défaut). */
async function openExcelWithLinks() {
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
  if (await linkCells().count() > 0) return
  await s.page.getByTitle('Configurer les colonnes').click()
  const modal = s.page.locator('.fixed.inset-0.z-50')
  const links = modal.locator('div.border-t').filter({ has: s.page.getByText('Liens', { exact: true }) })
  for (const box of await links.getByRole('checkbox').all()) await box.check()
  await modal.click({ position: { x: 5, y: 5 } })
  await expect(linkCells().first()).toBeVisible()
}

/** Ouvre le popover d'édition des liens d'une cellule de lien, la liste des candidats affichée. */
async function openPickerWithCandidates() {
  await linkCells().nth(0).dblclick({ position: { x: 2, y: 2 } })
  await expect(popover()).toBeVisible()
  await expect(options().first()).toBeVisible()
  expect(await options().count()).toBeGreaterThan(2)
}

/** Identifiant porté par une ligne de candidat (premier texte, avant le titre). */
async function candidateId(index: number): Promise<string> {
  const text = (await options().nth(index).innerText()).trim()
  return text.split(/\s+/)[0]
}

test('GH421-1 — clavier : ↓ ↑ parcourent les candidats, Entrée ajoute le surligné', async () => {
  await openExcelWithLinks()
  await openPickerWithCandidates()

  await expect(options().first()).toHaveAttribute('aria-selected', 'true')
  await s.page.keyboard.press('ArrowDown')
  await expect(options().nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(options().first()).toHaveAttribute('aria-selected', 'false')
  await s.page.keyboard.press('ArrowUp')
  await expect(options().first()).toHaveAttribute('aria-selected', 'true')

  const peerId = await candidateId(1)
  await s.page.keyboard.press('ArrowDown')
  await s.page.keyboard.press('Enter')
  await expect(popover().locator(`[data-link-chip="${peerId}"]`)).toBeVisible()
  await s.shot('gh421-keyboard-added')
})

test('GH421-2 — souris : clic sur le titre d\'un candidat l\'ajoute', async () => {
  await openExcelWithLinks()
  await openPickerWithCandidates()

  const peerId = await candidateId(0)
  await options().first().locator('span.truncate').click()
  await expect(popover().locator(`[data-link-chip="${peerId}"]`)).toBeVisible()
})

test('GH421-3 — survol de l\'ID d\'un candidat : popup d\'aperçu de l\'élément', async () => {
  await openExcelWithLinks()
  await openPickerWithCandidates()

  const peerId = await candidateId(1)
  await options().nth(1).locator('[data-element-link]').hover()
  const preview = s.page.getByTestId('element-preview')
  await expect(preview).toBeVisible()
  await expect(s.page.getByTestId('element-preview-id')).toHaveText(peerId)
  await s.shot('gh421-hover-preview')
})

