import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH169 — vue tableau (Excel) : les IDs d'une colonne de lien sont cliquables directement, comme
 * dans la vue document (Word). Un clic ouvre l'objet lié (GH229 : en Tableau) sans passer par
 * l'édition de la cellule.
 * Le popover d'édition des liens se referme par Échap et par un clic hors de sa cellule.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const popover = () => s.page.locator('div[data-link-popover]')
const linkCells = () => s.page.locator('td[data-link-cell]')

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

/** Ouvre le popover d'édition des liens d'une cellule de lien (double-clic hors ID). */
async function openLinkPopover(index: number) {
  await linkCells().nth(index).dblclick({ position: { x: 2, y: 2 } })
  await expect(popover()).toBeVisible()
}

test('GH169-1 — clic sur un ID d\'une cellule de lien : navigation vers l\'objet lié, sans popover d\'édition', async () => {
  await openExcelWithLinks()

  const linkId = linkCells().locator('[data-element-link]').first()
  await expect(linkId).toBeVisible()
  const peerId = (await linkId.textContent())!.trim()
  expect(peerId).toMatch(/^[A-Z]+-\d+$/)

  await linkId.click()

  // L'objet lié est ouvert — GH229 : dans le même type de vue (Tableau), positionné sur lui ;
  // retour par Précédent (GH228).
  await expect.poll(() => new URL(s.page.url()).searchParams.get('item')).toBe(peerId)
  expect(new URL(s.page.url()).searchParams.get('view')).toBe('excel')
  // Le clic sur l'ID n'ouvre pas l'éditeur de liens de la cellule.
  await expect(popover()).toHaveCount(0)
  await s.shot('gh169-navigated')
})

test('GH169-2 — popover d\'édition des liens : refermé par Échap, clic hors cellule et clic sur une autre cellule de lien', async () => {
  await openExcelWithLinks()

  await openLinkPopover(0)
  await s.page.keyboard.press('Escape')
  await expect(popover()).toHaveCount(0)

  await openLinkPopover(0)
  await s.page.locator('thead th').nth(1).click({ position: { x: 2, y: 2 } })
  await expect(popover()).toHaveCount(0)

  await openLinkPopover(0)
  await linkCells().nth(1).click({ position: { x: 2, y: 2 } })
  await expect(popover()).toHaveCount(0)
})
