import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH464 — Précédent / Suivant en tête de l'en-tête de la vue, tout à gauche (ils étaient dans le coin
 * de la barre d'onglets, peu vus). Une exigence ouverte par double-clic dans l'arbre se quitte par
 * Précédent, à la souris ; le raccourci clavier fait toujours un seul pas.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const sidebar = () => s.page.getByTestId('sidebar')
const back = () => s.page.getByTestId('history-back')
const param = (name: string) => new URL(s.page.url()).searchParams.get(name)
const tableView = () => s.page.getByTitle('Vue tableau')

/** Double-clic dans l'arbre latéral sur « Protection anti-débordement ». L'état de l'arbre survit d'un test
 *  à l'autre : le dossier « Réglementaire » n'est déplié que s'il est replié (un double-clic le replierait). */
async function openRequirementFromTree() {
  const leaf = sidebar().getByText('Protection anti-débordement', { exact: true })
  if (!(await leaf.isVisible())) await sidebar().getByText('Réglementaire', { exact: true }).dblclick()
  await leaf.dblclick()
  await expect.poll(() => param('view')).toBe('edit')
}

test('G1 — exigence ouverte par double-clic : Précédent dans l\'en-tête, à gauche, ramène à la vue précédente', async () => {
  await s.openView('Exigences')
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  await openRequirementFromTree()
  const item = param('item')

  // Plus dans la barre d'onglets : une seule paire de boutons, hors de la barre des onglets.
  await expect(back()).toHaveCount(1)
  await expect(s.page.getByTestId('tab-strip').getByTestId('history-back')).toHaveCount(0)

  // En tête de l'en-tête de la vue (au-dessus du contenu, collé au bord gauche de la zone principale).
  const [b, area] = await Promise.all([back().boundingBox(), s.page.locator('main').boundingBox()])
  expect(b).not.toBeNull()
  expect(area).not.toBeNull()
  expect(b!.y).toBeGreaterThanOrEqual(area!.y)
  expect(b!.y + b!.height).toBeLessThanOrEqual(area!.y + 60)
  expect(b!.x).toBeLessThanOrEqual(area!.x + 24)
  await s.shot('gh464-g1-edit-header')

  // Clic souris sur Précédent : retour au Tableau (l'élément sélectionné dans l'arbre y reste), sans Échap.
  await back().click()
  await expect.poll(() => param('view')).toBe('excel')
  expect(param('item')).toBe(item)
})

test('G2 — clic droit sur Précédent (en-tête) : liste de l\'historique, clic souris sur une entrée', async () => {
  await s.openView('Exigences')
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  await openRequirementFromTree()
  const editPage = s.page.url()

  await back().click({ button: 'right' })
  const menu = s.page.getByTestId('history-menu-back')
  await expect(menu).toBeVisible()
  const items = menu.getByRole('menuitem')
  await expect(items).not.toHaveCount(0)
  await items.first().click()
  await expect(menu).toBeHidden()
  await expect.poll(() => s.page.url()).not.toBe(editPage)
  await expect.poll(() => param('view')).toBe('excel')
})

test('G3 — Alt+← depuis l\'édition : un seul pas d\'historique, puis Alt+→ revient à l\'édition', async () => {
  await s.openView('Exigences')
  await tableView().click()
  await expect.poll(() => param('view')).toBe('excel')
  await openRequirementFromTree()
  const item = param('item')

  // Raccourci global : focus rendu au corps de la page (comme gh228).
  // Un seul pas : la page d'avant (Tableau, même élément sélectionné) et non deux pas en arrière.
  await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await s.page.keyboard.press('Alt+ArrowLeft')
  await expect.poll(() => param('view')).toBe('excel')
  expect(param('item')).toBe(item)

  await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await s.page.keyboard.press('Alt+ArrowRight')
  await expect.poll(() => param('view')).toBe('edit')
  expect(param('item')).toBe(item)
})
