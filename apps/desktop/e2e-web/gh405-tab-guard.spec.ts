import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH405 — changer d'onglet ne perd plus une saisie non enregistrée : popup « Quitter cette page ? »
 * au clic sur un onglet, au menu ▾, à `+` et à « Récemment fermés ». Les raccourcis Ctrl+Tab /
 * Ctrl+PageUp/PageDown sont desktop seulement (e2e-desktop/gh405-tabs.spec.ts).
 * Scénarios W1–W6 de specs/GH405-tests.md.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const tabs = () => s.page.getByTestId('tab')
const activeTab = () => s.page.locator('[data-testid="tab"][data-active]')
const dialog = () => s.page.getByRole('dialog')
const pathname = () => new URL(s.page.url()).pathname

async function goto(url: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await s.page.waitForLoadState('networkidle')
}

async function newRequirement(title: string): Promise<{ id: string; objectTypeRef: string }> {
  const [model] = await s.invoke<Array<{ objectTypeRef: string }>>('requirements:list', s.project.localPath)
  return s.invoke<{ id: string; objectTypeRef: string }>('requirements:create', s.project.localPath, { objectTypeRef: model.objectTypeRef, title })
}

const savedTitle = async (id: string) => (await s.invoke<{ title: string }>('requirements:get', s.project.localPath, id)).title

/** Deux onglets : le premier sur la page de l'exigence `id` (actif, titre modifié non enregistré),
 *  le second sur la vue Exigences. */
async function dirtyRequirementTab(title: string) {
  const req = await newRequirement(title)
  await s.openView('Exigences')
  await s.page.getByTitle('Nouvel onglet (Ctrl+T)').click()
  await expect(tabs()).toHaveCount(2)
  await tabs().first().click()
  await goto(s.projectUrl(`/req/${req.id}`, { repoPath: s.project.localPath }))
  const input = s.page.locator('main input.input-field[type="text"]').first()
  await input.fill(`${title} modifié`)
  return { req, input }
}

/** Un seul onglet, non modifié, même après un test interrompu : popups refermées, onglets fermés
 *  (saisie abandonnée), le dernier est remis sur l'accueil par sa fermeture. */
async function resetTabs() {
  if (await dialog().isVisible()) await dialog().getByRole('button', { name: 'Rester' }).click().catch(() => {})
  await s.page.keyboard.press('Escape')
  for (let n = await tabs().count(); n > 0; n--) {
    await tabs().last().click({ button: 'middle' })
    const close = dialog().getByRole('button', { name: 'Fermer sans enregistrer' })
    if (await close.isVisible().catch(() => false)) await close.click()
  }
  await expect(tabs()).toHaveCount(1)
  await expect(dialog()).toBeHidden()
}

test.afterEach(resetTabs)

test('W1 — clic sur un autre onglet depuis une page modifiée : Rester / Quitter', async () => {
  const { req, input } = await dirtyRequirementTab('GH405 W1')
  await tabs().nth(1).click()
  await expect(dialog()).toContainText('Quitter cette page ?')
  await dialog().getByRole('button', { name: 'Rester' }).click()
  await expect(dialog()).toBeHidden()
  await expect(input).toHaveValue('GH405 W1 modifié')
  await expect(activeTab()).toHaveCount(1)
  expect(await activeTab().getAttribute('data-tab-id')).toBe(await tabs().first().getAttribute('data-tab-id'))
  expect(pathname()).toContain(`/req/${req.id}`)

  await tabs().nth(1).click()
  await dialog().getByRole('button', { name: 'Quitter sans enregistrer' }).click()
  await expect.poll(pathname).not.toContain('/req/')
  expect(await activeTab().getAttribute('data-tab-id')).toBe(await tabs().nth(1).getAttribute('data-tab-id'))
  expect(await savedTitle(req.id)).toBe('GH405 W1')
  await s.shot('gh405-w1-apres-quitter')
})

test('W2 — menu ▾ : choix d\'un onglet ouvert', async () => {
  const { req, input } = await dirtyRequirementTab('GH405 W2')
  await s.page.getByTitle('Tous les onglets').click()
  const menuItems = s.page.locator('.absolute.top-full button')
  await menuItems.nth(1).click()
  await expect(dialog()).toContainText('Quitter cette page ?')
  await dialog().getByRole('button', { name: 'Rester' }).click()
  await expect(input).toHaveValue('GH405 W2 modifié')

  await s.page.getByTitle('Tous les onglets').click()
  await menuItems.nth(1).click()
  await dialog().getByRole('button', { name: 'Quitter sans enregistrer' }).click()
  await expect.poll(pathname).not.toContain('/req/')
  expect(await savedTitle(req.id)).toBe('GH405 W2')
})

test('W3 — bouton + et « Récemment fermés »', async () => {
  const { req, input } = await dirtyRequirementTab('GH405 W3')
  // `+` : popup, Rester → pas de nouvel onglet.
  await s.page.getByTitle('Nouvel onglet (Ctrl+T)').click()
  await expect(dialog()).toContainText('Quitter cette page ?')
  await dialog().getByRole('button', { name: 'Rester' }).click()
  await expect(tabs()).toHaveCount(2)
  await expect(input).toHaveValue('GH405 W3 modifié')

  // « Récemment fermés » : fermer le second onglet (non modifié), puis le rouvrir depuis le menu.
  await tabs().nth(1).click({ button: 'middle' })
  await expect(tabs()).toHaveCount(1)
  await s.page.getByTitle('Tous les onglets').click()
  await s.page.getByText('Récemment fermés').locator('..').locator('button').first().click()
  await expect(dialog()).toContainText('Quitter cette page ?')
  await dialog().getByRole('button', { name: 'Quitter sans enregistrer' }).click()
  await expect(tabs()).toHaveCount(2)
  await expect.poll(pathname).not.toContain('/req/')
  expect(await savedTitle(req.id)).toBe('GH405 W3')
})

test('W4 — vue Édition : la saisie en cours est enregistrée, pas de popup', async () => {
  // Vue Document → « Éditer » sur le premier bloc (comme GH228 E1) : vue Édition d'un élément.
  await s.openView('Exigences')
  await s.page.getByTitle('Nouvel onglet (Ctrl+T)').click()
  await tabs().first().click()
  await s.page.getByTitle('Vue document').click()
  await s.page.locator('[data-node-id]').getByTitle('Éditer').first().click()
  await expect.poll(() => new URL(s.page.url()).searchParams.get('view')).toBe('edit')
  const id = new URL(s.page.url()).searchParams.get('item')!
  const before = await savedTitle(id)
  try {
    const input = s.page.locator(`main input[value="${before.replace(/"/g, '\\"')}"]`).first()
    await input.click()
    await input.fill(`${before} GH405`)
    await tabs().nth(1).click()
    await expect(dialog()).toBeHidden()
    expect(await activeTab().getAttribute('data-tab-id')).toBe(await tabs().nth(1).getAttribute('data-tab-id'))
    await expect.poll(() => savedTitle(id)).toBe(`${before} GH405`)
  } finally {
    // Données de la démo : titre d'origine rétabli.
    await s.invoke('requirements:update', s.project.localPath, id, { title: before })
  }
})

test('W5/W6 — page non modifiée : pas de popup ; Ctrl+PageDown non intercepté sur le web', async () => {
  await s.openView('Exigences')
  await s.page.getByTitle('Nouvel onglet (Ctrl+T)').click()
  await expect(tabs()).toHaveCount(2)
  await tabs().first().click()
  await expect(dialog()).toBeHidden()
  const first = await tabs().first().getAttribute('data-tab-id')
  expect(await activeTab().getAttribute('data-tab-id')).toBe(first)

  await s.page.locator('body').click()
  await s.page.keyboard.press('Control+PageDown')
  await s.page.keyboard.press('Control+PageUp')
  await expect(dialog()).toBeHidden()
  expect(await activeTab().getAttribute('data-tab-id')).toBe(first)
})
