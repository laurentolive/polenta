import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH343 — client web : « Nouvelle fenêtre » ouvre un onglet du navigateur sur l'accueil, sans saut
 * vers le dernier projet ; le saut n'a lieu qu'au premier chargement de `/` ; « Fermer le projet »
 * reste sur l'accueil (specs/GH343-tests.md T17, T18).
 */
const s = setupSession()

const projectOf = (page: Page) => new URL(page.url()).searchParams.get('projectId')

async function expectStaysHome(page: Page): Promise<void> {
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
  await page.waitForTimeout(2_000)
  expect(new URL(page.url()).pathname).toBe('/')
  expect(new URL(page.url()).search).toBe('')
}

let projectId: string | null

/** Panneau Projet affiché (le bouton de la barre d'activité replie le panneau s'il l'est déjà). */
async function showProjectPanel(page: Page): Promise<void> {
  const probe = page.getByTestId('project-new-window')
  // Le panneau peut s'afficher après le premier rendu : l'attendre avant de décider de cliquer.
  await probe.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {})
  if (!(await probe.isVisible())) await page.locator('button[title="Projet"]').first().click()
  await expect(probe).toBeVisible()
}

test.beforeAll(async () => {
  await s.openView('Exigences')
  await expect.poll(() => projectOf(s.page)).toBeTruthy()
  projectId = projectOf(s.page)
})

test('T17 — « Nouvelle fenêtre » du panneau Projet : nouvel onglet sur l’accueil, sans saut', async () => {
  await showProjectPanel(s.page)
  const [popup] = await Promise.all([
    s.context.waitForEvent('page'),
    s.page.getByTestId('project-new-window').click(),
  ])
  await popup.waitForLoadState('networkidle')
  await expectStaysHome(popup)
  await popup.close()
})

test('T17 — premier chargement de `/` dans un nouvel onglet : saut vers le dernier projet', async () => {
  const other = await s.context.newPage()
  await other.goto('/')
  await expect.poll(() => projectOf(other), { timeout: 15_000 }).toBe(projectId)
  await other.close()
})

test('T18 — « Fermer le projet » : l’onglet reste sur l’accueil, les autres onglets gardent leur projet', async () => {
  const other = await s.context.newPage()
  await other.goto(new URL(s.page.url()).pathname + new URL(s.page.url()).search)
  await expect.poll(() => projectOf(other)).toBe(projectId)
  await showProjectPanel(other)
  await other.getByTitle('Fermer le projet').click()
  await expectStaysHome(other)
  expect(projectOf(s.page)).toBe(projectId)
  await other.close()
})
