import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH342 — client web : « Ouvrir dans une nouvelle fenêtre » ouvre un onglet du navigateur sur la
 * même page, et une URL de page ouverte directement (nouvel onglet, F5) affiche cette page au lieu
 * de l'accueil (specs/GH342-tests.md W1–W3).
 */
const s = setupSession()

const tabs = (page: Page) => page.getByTestId('tab')
const pageOf = (url: string) => { const u = new URL(url); return u.pathname + u.search }

let reqPage: string

test.beforeAll(async () => {
  await s.openView('Exigences')
  await expect.poll(() => new URL(s.page.url()).searchParams.get('projectId')).toBeTruthy()
  reqPage = pageOf(s.page.url())
})

test('W1 — menu d’onglet → nouvel onglet du navigateur sur la même page', async () => {
  await tabs(s.page).first().click({ button: 'right' })
  const item = s.page.getByRole('button', { name: 'Ouvrir dans une nouvelle fenêtre' })
  await expect(item).toBeVisible()
  const [popup] = await Promise.all([
    s.context.waitForEvent('page'),
    item.dispatchEvent('mousedown'),
  ])
  await popup.waitForLoadState('networkidle')
  expect(pageOf(popup.url())).toBe(reqPage)
  await expect(tabs(popup)).toHaveCount(1)
  // L'onglet d'origine reste (copie).
  await expect(tabs(s.page)).toHaveCount(1)
  await popup.close()
})

test('W2 — URL d’une page collée dans un nouvel onglet : la page s’affiche', async () => {
  const other = await s.context.newPage()
  await other.goto(reqPage)
  await other.waitForLoadState('networkidle')
  expect(pageOf(other.url())).toBe(reqPage)
  await expect(tabs(other)).toHaveCount(1)
  await other.close()
})

test('W4 — onglet navigateur fermé avec un onglet Polenta non sauvegardé : confirmation du navigateur', async () => {
  // Exigence en brouillon : une exigence approuvée est verrouillée (champs en lecture seule).
  const reqs = await s.invoke<{ id: string; status: string }[]>('requirements:list', s.project.localPath)
  const draft = reqs.find(r => r.status === 'draft') ?? reqs[0]
  const route = `/req/${draft.id}?${new URLSearchParams({ repoPath: s.project.localPath, projectId: new URL(s.page.url()).searchParams.get('projectId') ?? '' })}`
  const other = await s.context.newPage()
  await other.goto(route)
  await other.waitForLoadState('networkidle')
  const title = other.locator('main input.input-field[type="text"]:not([readonly])').first()
  await expect(title).toBeVisible()
  await title.fill(`${await title.inputValue()} (brouillon)`)
  await expect(other.getByTestId('tab').first().locator('span.rounded-full')).toBeVisible()   // point « modifié »

  const dialogs: string[] = []
  other.on('dialog', d => { dialogs.push(d.type()); void d.dismiss() })
  await other.close({ runBeforeUnload: true })
  await expect.poll(() => dialogs).toEqual(['beforeunload'])
  expect(other.isClosed()).toBe(false)

  // Modification annulée : plus de confirmation.
  other.removeAllListeners('dialog')
  await title.fill(await title.inputValue().then(v => v.replace(' (brouillon)', '')))
  await expect(other.getByTestId('tab').first().locator('span.rounded-full')).toBeHidden()
  const closed = other.waitForEvent('close')
  await other.close({ runBeforeUnload: true })
  await closed
})

test('W3 — F5 : même page après rechargement', async () => {
  await s.openView('Tests')
  const before = pageOf(s.page.url())
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  expect(pageOf(s.page.url())).toBe(before)
})
