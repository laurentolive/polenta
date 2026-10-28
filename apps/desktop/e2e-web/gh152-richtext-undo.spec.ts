import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH152 — Ctrl+Z dans l'éditeur richtext n'annule pas la dernière opération sur l'arbre
 * (raccourcis globaux de SystemViewContext ignorés dans un contenteditable).
 */
const s = setupSession()

const sidebar = () => s.page.getByTestId('sidebar')
const undoButton = () => s.page.getByTitle('Annuler (Ctrl+Z)')

test('Ctrl+Z dans un champ richtext : l\'opération sur l\'arbre n\'est pas annulée', async () => {
  await s.openView('Exigences')

  // Opération sur l'arbre : nouveau dossier à la racine (zone vide sous l'arbre).
  await sidebar().locator('div.min-h-12').last().click({ button: 'right' })
  await s.page.getByText('Créer un dossier', { exact: true }).click()
  const rename = sidebar().locator('input:focus')
  await expect(rename).toHaveValue('Nouveau dossier')
  await rename.press('Enter')
  await expect(sidebar().getByText('Nouveau dossier', { exact: true })).toBeVisible()
  await expect(undoButton()).toBeEnabled()

  // Ouvre une exigence dans la vue d'édition (ligne du tableau) et place le curseur dans un richtext.
  await s.page.locator('main tbody tr').filter({ hasText: /[A-Z]+-\d{4}/ }).first().locator('td').first().click()
  const editor = s.page.locator('.ProseMirror[contenteditable="true"]').first()
  await editor.click()
  await s.page.keyboard.press('Control+z')

  await expect(sidebar().getByText('Nouveau dossier', { exact: true })).toBeVisible()
  await expect(undoButton()).toBeEnabled()
})
