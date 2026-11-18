import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { publish } from './support/ui'
import { outsideClone } from './support/forge'

/**
 * GH407 — une ouverture d'onglet programmatique ne perd plus une saisie non enregistrée : popup
 * « Quitter cette page ? » (garde de GH405) au Ctrl+clic / clic du milieu sur un lien d'élément, à
 * « Résoudre les conflits » (ouvert sous flushSync après un `await`, GH37) et à « Reprendre la
 * résolution ». Rester garde la saisie ; Quitter ouvre l'onglet. Glisser d'un onglet depuis une autre
 * fenêtre : e2e-desktop/gh407-adopt.spec.ts. Voir specs/GH407.md.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const tabs = () => s.page.getByTestId('tab')
const activeTab = () => s.page.locator('[data-testid="tab"][data-active]')
const leaveDialog = () => s.page.getByRole('dialog').filter({ hasText: 'Quitter cette page ?' })
const pathname = () => new URL(s.page.url()).pathname

async function goto(url: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await s.page.waitForLoadState('networkidle')
}

/** Id de l'onglet actif, et vérification qu'il est le `index`-ième de la barre. */
async function expectActiveIs(index: number) {
  await expect(activeTab()).toHaveCount(1)
  expect(await activeTab().getAttribute('data-tab-id')).toBe(await tabs().nth(index).getAttribute('data-tab-id'))
}

/** Un seul onglet, non modifié, même après un test interrompu. */
async function resetTabs() {
  if (await leaveDialog().isVisible()) await leaveDialog().getByRole('button', { name: 'Rester' }).click().catch(() => {})
  await s.page.keyboard.press('Escape')
  for (let n = await tabs().count(); n > 0; n--) {
    await tabs().last().click({ button: 'middle' })
    const close = s.page.getByRole('dialog').getByRole('button', { name: 'Fermer sans enregistrer' })
    if (await close.isVisible().catch(() => false)) await close.click()
  }
  await expect(tabs()).toHaveCount(1)
}

test.afterEach(resetTabs)

test('G1 — Ctrl+clic et clic du milieu sur un lien d\'élément depuis une campagne en cours de modification', async () => {
  const { localPath, workspaceDir } = s.project
  const existing = await s.invoke<Array<{ objectTypeRef?: string }>>('campaigns:list', localPath)
  const objectTypeRef = existing.find(c => c.objectTypeRef)?.objectTypeRef
  test.skip(!objectTypeRef, 'la démo doit avoir une campagne typée')
  const [tc] = await s.invoke<Array<{ id: string }>>('tests:list', localPath)
  const campaign = await s.invoke<{ id: string }>('campaigns:create', localPath, {
    title: 'GH407 G1', objectTypeRef, fields: { description: 'Description GH407' }, testCaseIds: [tc.id],
  }, workspaceDir)

  await goto(s.projectUrl(`/campaign/${campaign.id}`, { repoPath: localPath }))
  await s.page.getByTitle('Modifier les champs').click()
  const editor = s.page.locator('.ProseMirror[contenteditable="true"]').filter({ hasText: 'Description GH407' })
  await editor.click()
  await s.page.keyboard.press('ControlOrMeta+a')
  await s.page.keyboard.type('Saisie GH407 non enregistrée')
  const link = s.page.locator(`[data-element-link="${tc.id}"]`).first()
  await expect(link).toBeVisible()

  // Ctrl+clic : popup, Rester → pas de nouvel onglet, saisie intacte.
  await link.click({ modifiers: ['Control'] })
  await expect(leaveDialog()).toBeVisible()
  await leaveDialog().getByRole('button', { name: 'Rester' }).click()
  await expect(leaveDialog()).toBeHidden()
  await expect(tabs()).toHaveCount(1)
  await expect(s.page.locator('.ProseMirror[contenteditable="true"]').filter({ hasText: 'Saisie GH407 non enregistrée' })).toBeVisible()
  expect(pathname()).toContain(`/campaign/${campaign.id}`)

  // Clic du milieu : même garde.
  await link.click({ button: 'middle' })
  await expect(leaveDialog()).toBeVisible()
  await leaveDialog().getByRole('button', { name: 'Rester' }).click()
  await expect(tabs()).toHaveCount(1)
  await expect(s.page.locator('.ProseMirror[contenteditable="true"]').filter({ hasText: 'Saisie GH407 non enregistrée' })).toBeVisible()

  // Ctrl+clic, Quitter sans enregistrer → nouvel onglet actif sur le test ; le premier reste la campagne.
  await link.click({ modifiers: ['Control'] })
  await leaveDialog().getByRole('button', { name: 'Quitter sans enregistrer' }).click()
  await expect(tabs()).toHaveCount(2)
  await expectActiveIs(1)
  await expect.poll(() => new URL(s.page.url()).searchParams.get('item')).toBe(tc.id)
  await expect(tabs().first()).toContainText('GH407 G1')
  const saved = await s.invoke<{ fields?: Record<string, unknown> }>('campaigns:get', localPath, campaign.id)
  expect(JSON.stringify(saved.fields ?? {})).not.toContain('Saisie GH407')
  await s.shot('gh407-g1-apres-quitter')
})

test('G2 — page non modifiée : Ctrl+clic ouvre l\'onglet sans popup', async () => {
  const { localPath } = s.project
  const campaigns = await s.invoke<Array<{ id: string; title: string; testCaseIds: string[] }>>('campaigns:list', localPath)
  const campaign = campaigns.find(c => c.title === 'GH407 G1') ?? campaigns.find(c => c.testCaseIds.length > 0)
  test.skip(!campaign, 'aucune campagne avec un test')
  await goto(s.projectUrl(`/campaign/${campaign!.id}`, { repoPath: localPath }))
  const link = s.page.locator(`[data-element-link="${campaign!.testCaseIds[0]}"]`).first()
  await link.click({ modifiers: ['Control'] })
  await expect(tabs()).toHaveCount(2)
  await expect(leaveDialog()).toBeHidden()
  await expectActiveIs(1)
})

test('G3 — « Résoudre les conflits » (flushSync, GH37) puis « Reprendre la résolution » depuis une exigence modifiée', async () => {
  const { localPath, workspaceDir } = s.project
  const rel = 'requirements/PRD-0001.yaml'
  // Conflit à la publication, comme parity P-4 : un autre poste et ce navigateur changent le titre de PRD-0001.
  const other = outsideClone('gh407')
  other.write(rel, other.read(rel).replace(/^title: .*$/m, 'title: Capacité de charge (autre poste GH407)'))
  other.commitAndPush('autre poste : titre PRD-0001 (GH407)')
  const prd = await s.invoke<{ status: string }>('requirements:get', localPath, 'PRD-0001')
  if (prd.status === 'approved') await s.invoke('requirements:transition', localPath, 'PRD-0001', { toStatus: 'draft' })
  await s.invoke('requirements:update', localPath, 'PRD-0001', { title: 'Capacité de charge (web GH407)' }, workspaceDir)

  // Exigence modifiée non enregistrée dans l'onglet actif.
  const [model] = await s.invoke<Array<{ objectTypeRef: string }>>('requirements:list', localPath)
  const req = await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: model.objectTypeRef, title: 'GH407 G3' })
  await goto(s.projectUrl(`/req/${req.id}`, { repoPath: localPath }))
  const input = s.page.locator('main input.input-field[type="text"]').first()
  await expect(input).toHaveValue('GH407 G3')
  await input.fill('GH407 G3 modifié')

  await publish(s.page, 'web : titre PRD-0001 (GH407)')
  await expect(s.page.getByRole('heading', { name: 'Publication impossible' })).toBeVisible({ timeout: 60_000 })
  await s.page.getByRole('button', { name: 'Résoudre les conflits' }).click()

  // Ouverture après un `await` : la garde s'affiche, Rester → même onglet, saisie intacte.
  await expect(leaveDialog()).toBeVisible({ timeout: 30_000 })
  await leaveDialog().getByRole('button', { name: 'Rester' }).click()
  await expect(leaveDialog()).toBeHidden()
  await expect(tabs()).toHaveCount(1)
  await expect(input).toHaveValue('GH407 G3 modifié')
  expect(pathname()).toContain(`/req/${req.id}`)

  // La session de résolution reste reprenable : « Reprendre la résolution » est gardé lui aussi.
  const resume = s.page.getByRole('button', { name: /Reprendre la résolution|Reprendre les résolutions/ })
  await expect(resume).toBeVisible({ timeout: 30_000 })
  await resume.click()
  await expect(leaveDialog()).toBeVisible()
  await leaveDialog().getByRole('button', { name: 'Rester' }).click()
  await expect(tabs()).toHaveCount(1)
  await expect(input).toHaveValue('GH407 G3 modifié')

  await resume.click()
  await leaveDialog().getByRole('button', { name: 'Quitter sans enregistrer' }).click()
  await expect(tabs()).toHaveCount(2)
  await expectActiveIs(1)
  await expect.poll(pathname).toContain('/merge-resolve')
  await expect(s.page.getByText('0 / 1 fichiers mergés').first()).toBeVisible()
  // GH37 : l'onglet précédent n'est pas réécrit sur /merge-resolve.
  await tabs().first().click()
  await expect.poll(pathname).toContain(`/req/${req.id}`)
  expect((await s.invoke<{ title: string }>('requirements:get', localPath, req.id)).title).toBe('GH407 G3')
  await s.shot('gh407-g3-apres-quitter')
})
