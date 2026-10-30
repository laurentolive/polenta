import { test, expect } from '@playwright/test'
import { activityBar, setupSession } from './support/session'

/**
 * GH228 — Précédent / Suivant comme dans un navigateur : historique par onglet, vue système dans
 * l'URL (`view`, `item`), popup sur une page modifiée, menu d'historique, boutons de la souris.
 * Scénarios E1–E7 de specs/GH228-tests.md (E8 : gh105-cross-repo-links.spec.ts, GH105-2).
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const back = () => s.page.getByTestId('history-back')
const forward = () => s.page.getByTestId('history-forward')
const param = (name: string) => new URL(s.page.url()).searchParams.get(name)

async function goto(url: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await s.page.waitForLoadState('networkidle')
}

/** Raccourci global, focus rendu au corps de la page. */
async function press(keys: string) {
  await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await s.page.keyboard.press(keys)
}

/** Vue Édition de l'élément `id` (champ système ID). */
async function expectEditing(id: string) {
  await expect(s.page.locator('main')).toContainText(new RegExp(`ID\\s*\\(sys\\)\\s*${id}`))
}

async function expectView(view: string) {
  await expect.poll(() => param('view')).toBe(view)
}

test('E1/E2 — vue système dans l\'URL : Précédent / Suivant au clavier, lien direct', async () => {
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await expectView('excel')
  await s.page.getByTitle('Vue document').click()
  await expectView('word')
  await s.page.locator('[data-node-id]').getByTitle('Éditer').first().click()
  await expectView('edit')
  const item = param('item')
  expect(item).toBeTruthy()
  // Pas s.openView : son Échap quitterait l'Édition (une page de plus dans l'historique).
  await activityBar(s.page).and(s.page.locator('[title="Version"]')).click()
  await expect.poll(() => new URL(s.page.url()).pathname).not.toBe('/product')

  await press('Alt+ArrowLeft')
  await expectView('edit')
  expect(param('item')).toBe(item)
  await expectEditing(item!)
  await press('Alt+ArrowLeft')
  await expectView('word')
  await press('Alt+ArrowLeft')
  await expectView('excel')
  await press('Alt+ArrowRight')
  await expectView('word')
  await press('Alt+ArrowRight')
  await expectView('edit')
  await s.shot('gh228-e1-edition')

  // E2 — l'URL suffit à réafficher l'Édition de l'élément (lien collé depuis une autre page ; un
  // rechargement repart de l'accueil du projet, comportement de démarrage inchangé).
  const url = s.page.url()
  await activityBar(s.page).and(s.page.locator('[title="Version"]')).click()
  await expect.poll(() => new URL(s.page.url()).pathname).not.toBe('/product')
  await goto(url)
  await expectEditing(item!)
  expect(param('item')).toBe(item)
})

test('E3/E4 — boutons grisés selon l\'historique, onglets indépendants', async () => {
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await expect(back()).toBeEnabled()

  await s.page.getByTitle('Nouvel onglet (Ctrl+T)').click()
  await expect(back()).toBeDisabled()
  await expect(forward()).toBeDisabled()
  await s.openView('Exigences')
  await s.page.getByTitle('Vue document').click()
  await expectView('word')
  await back().click()
  await expect(forward()).toBeEnabled()
  await s.page.getByTitle('Vue tableau').click()
  await expectView('excel')
  await expect(forward()).toBeDisabled()

  // Retour sur le premier onglet : son historique est intact, l'activation n'a rien ajouté.
  await s.page.locator('button.group[title]').first().click()
  await expect(back()).toBeEnabled()
  await expect(forward()).toBeDisabled()
})

test('E5 — page modifiée : popup, Rester garde la saisie, Quitter n\'enregistre pas', async () => {
  const [model] = await s.invoke<Array<{ objectTypeRef: string }>>('requirements:list', s.project.localPath)
  const req = await s.invoke<{ id: string }>('requirements:create', s.project.localPath, { objectTypeRef: model.objectTypeRef, title: 'GH228 E5' })
  await s.openView('Version')
  await s.openView('Exigences')
  await goto(s.projectUrl(`/req/${req.id}`, { repoPath: s.project.localPath }))

  // Sans modification : pas de popup.
  await press('Alt+ArrowLeft')
  await expect.poll(() => new URL(s.page.url()).pathname).not.toContain('/req/')
  await press('Alt+ArrowRight')
  await expect.poll(() => new URL(s.page.url()).pathname).toContain('/req/')

  const title = s.page.locator('main input.input-field[type="text"]').first()
  await title.fill('GH228 E5 modifié')
  await title.focus()
  await s.page.keyboard.press('Alt+ArrowLeft')
  const dialog = s.page.getByRole('dialog')
  await expect(dialog).toContainText('Quitter cette page ?')
  await dialog.getByRole('button', { name: 'Rester' }).click()
  await expect(dialog).toBeHidden()
  await expect(title).toHaveValue('GH228 E5 modifié')
  expect(new URL(s.page.url()).pathname).toContain('/req/')

  await back().click()
  await s.page.getByRole('dialog').getByRole('button', { name: 'Quitter sans enregistrer' }).click()
  await expect.poll(() => new URL(s.page.url()).pathname).not.toContain('/req/')
  const saved = await s.invoke<{ title: string }>('requirements:get', s.project.localPath, req.id)
  expect(saved.title).toBe('GH228 E5')
})

test('E6 — boutons latéraux de la souris', async () => {
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await expectView('excel')
  await s.page.getByTitle('Vue document').click()
  await expectView('word')
  const mouse = (button: number) => s.page.evaluate(b => {
    dispatchEvent(new MouseEvent('mousedown', { button: b, bubbles: true, cancelable: true }))
    dispatchEvent(new MouseEvent('mouseup', { button: b, bubbles: true, cancelable: true }))
  }, button)
  await mouse(3)
  await expectView('excel')
  await mouse(4)
  await expectView('word')
})

test('E7 — clic droit sur Précédent : historique, saut direct', async () => {
  await s.openView('Version')
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await expectView('excel')
  await s.page.getByTitle('Vue document').click()
  await expectView('word')

  await back().click({ button: 'right' })
  const menu = s.page.getByTestId('history-menu-back')
  const items = menu.getByRole('menuitem')
  expect(await items.count()).toBeGreaterThanOrEqual(3)
  await s.shot('gh228-e7-menu')
  await items.nth(2).click()
  await expect(menu).toBeHidden()
  await expect.poll(() => new URL(s.page.url()).pathname).not.toBe('/product')

  await forward().click({ button: 'right' })
  await expect(s.page.getByTestId('history-menu-forward').getByRole('menuitem')).toHaveCount(3)
  await s.page.keyboard.press('Escape')
})
