import { test, expect, type Page } from '@playwright/test'
import { activityBar, setupSession } from './support/session'

/**
 * GH123 — panneau latéral masquable, style VS Code : reclic sur le bouton actif de l'ActivityBar
 * ou Ctrl+B, préférence par poste. Scénarios E1–E4, E5–E10 et L3–L4 de specs/GH123-tests.md.
 */
const s = setupSession()

const KEY = 'polenta.sidebarCollapsed'

const sidebar = () => s.page.getByTestId('sidebar')
const resizeHandle = () => s.page.locator('div.cursor-col-resize')
const main = () => s.page.locator('main')

function button(page: Page, title: string) {
  return activityBar(page).and(page.locator(`[title="${title}"]`))
}

async function goto(url: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await s.page.waitForLoadState('networkidle')
}

async function stored(): Promise<string | null> {
  return s.page.evaluate(k => localStorage.getItem(k), KEY)
}

/** Ctrl+B hors champ éditable : focus rendu au corps de la page. */
async function pressToggle() {
  await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await s.page.keyboard.press('Control+b')
}

test.beforeEach(async () => {
  await s.page.evaluate(k => localStorage.removeItem(k), KEY)
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await s.openView('Exigences')
  await expect(sidebar()).toBeVisible()
})

test('E1/E2 — reclic sur le bouton actif : repli puis dépli, sans navigation, largeur conservée', async () => {
  const url = s.page.url()
  const width = (await sidebar().boundingBox())!.width
  const mainWidth = (await main().boundingBox())!.width

  await button(s.page, 'Exigences').click()
  await expect(sidebar()).toBeHidden()
  await expect(resizeHandle()).toHaveCount(0)
  await expect(button(s.page, 'Exigences')).toHaveAttribute('aria-expanded', 'false')
  expect(s.page.url()).toBe(url)
  expect((await main().boundingBox())!.width).toBeGreaterThan(mainWidth)
  await s.shot('gh123-e1-replie')

  await button(s.page, 'Exigences').click()
  await expect(sidebar()).toBeVisible()
  await expect(button(s.page, 'Exigences')).toHaveAttribute('aria-expanded', 'true')
  expect(s.page.url()).toBe(url)
  expect((await sidebar().boundingBox())!.width).toBe(width)
})

test('E3 — replié, clic sur un autre panneau : navigation et dépli', async () => {
  await button(s.page, 'Exigences').click()
  await expect(sidebar()).toBeHidden()
  await button(s.page, 'Version').click()
  await s.page.waitForURL(/\/graph/)
  await expect(sidebar()).toBeVisible()
  await expect(button(s.page, 'Version')).toHaveAttribute('aria-expanded', 'true')
})

test('E4/E7 — Ctrl+B bascule, l\'état replié survit au rechargement', async () => {
  await pressToggle()
  await expect(sidebar()).toBeHidden()
  expect(await stored()).toBe('1')
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await expect(sidebar()).toBeHidden()
  await pressToggle()
  await expect(sidebar()).toBeVisible()
  expect(await stored()).toBeNull()
})

test('E5 — Ctrl+B dans l\'éditeur richtext : gras, panneau toujours visible', async () => {
  // Exigence propre au test : la saisie est enregistrée (autosave), aucune exigence de la démo touchée.
  const [model] = await s.invoke<Array<{ objectTypeRef: string }>>('requirements:list', s.project.localPath)
  const req = await s.invoke<{ id: string }>('requirements:create', s.project.localPath, { objectTypeRef: model.objectTypeRef, title: 'GH123 E5' })
  await goto(s.projectUrl(`/req/${req.id}`, { repoPath: s.project.localPath }))
  const editor = s.page.locator('.ProseMirror[contenteditable="true"]').first()
  await editor.click()
  await s.page.keyboard.press('Control+b')
  await s.page.keyboard.type('GH123gras')
  await expect(editor.locator('strong', { hasText: 'GH123gras' })).toBeVisible()
  await expect(sidebar()).toBeVisible()
})

test('E6 — Ctrl+B dans un champ du panneau Recherche : panneau toujours visible', async () => {
  await s.openView('Recherche')
  const input = sidebar().locator('input').first()
  await input.click()
  await s.page.keyboard.press('Control+b')
  await expect(sidebar()).toBeVisible()
})

test('E8 — replié, navigation hors ActivityBar : reste replié, le bouton actif suit la route', async () => {
  await button(s.page, 'Exigences').click()
  await expect(sidebar()).toBeHidden()
  await goto(s.projectUrl('/parameters'))
  await expect(sidebar()).toBeHidden()
  await expect(button(s.page, 'Paramètres')).toHaveAttribute('aria-expanded', 'false')
  await expect(button(s.page, 'Exigences')).not.toHaveAttribute('aria-expanded', /.*/)
})

test('E9 — Compte : reclic replie et retire la surcharge, Ctrl+B redéplie sur le panneau de la route', async () => {
  await button(s.page, 'Compte').click()
  await expect(button(s.page, 'Compte')).toHaveAttribute('aria-expanded', 'true')
  await button(s.page, 'Compte').click()
  await expect(sidebar()).toBeHidden()
  await pressToggle()
  await expect(sidebar()).toBeVisible()
  await expect(button(s.page, 'Exigences')).toHaveAttribute('aria-expanded', 'true')
  await expect(button(s.page, 'Compte')).not.toHaveAttribute('aria-expanded', /.*/)
})

test('E10 — repli/dépli sans démontage du panneau', async () => {
  // Marqueur posé sur le contenu du panneau : un remontage le ferait disparaître.
  await sidebar().locator(':scope > *').first().evaluate(el => { (el as HTMLElement).dataset.gh123 = 'kept' })
  await pressToggle()
  await expect(sidebar()).toBeHidden()
  await pressToggle()
  await expect(sidebar().locator(':scope > [data-gh123="kept"]')).toHaveCount(1)
})

test('L3/L4 — largeur mémorisée inchangée, valeur illisible = déplié', async () => {
  const width = await s.page.evaluate(() => localStorage.getItem('polenta.sidebarWidth'))
  await pressToggle()
  await pressToggle()
  expect(await s.page.evaluate(() => localStorage.getItem('polenta.sidebarWidth'))).toBe(width)

  await s.page.evaluate(k => localStorage.setItem(k, 'garbage'), KEY)
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await expect(sidebar()).toBeVisible()
})
