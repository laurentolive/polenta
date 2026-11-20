import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { testedVersionArg, typeOfCategory } from './support/demo-types'

/**
 * GH399 — lien et popup d'aperçu d'une exécution (specs/GH399-tests.md E1–E8) : grille des exécutions,
 * onglet Popup de la vue Exécutions, navigation (page d'exécution, relecture, aucune), pastille de
 * résultat d'une campagne, origine d'une issue, ID d'exécution écrit dans des notes.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string }> }

const TYPE_LABEL = 'GH399 Essai'
let ta = ''
let c1: Campaign
let c2: Campaign
let c3: Campaign
let issueType = ''
let issueId = ''
const runs: Record<string, string> = {}

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

async function openTestExecutions() {
  await navigate(s.page, s.projectUrl(`/test/${ta}`, { repoPath: s.project.localPath }))
  const section = s.page.getByTestId('executions-section')
  await section.locator('summary').click()
  await expect(section.locator('[data-testid^="execution-row-"]')).toHaveCount(5)   // 4 runs + 1 en attente
  return section
}

/** Survol d'un lien d'exécution : popup de cette exécution. */
async function hoverRun(link: ReturnType<Page['locator']>, runId: string) {
  await s.page.mouse.move(0, 0)
  await link.hover()
  const popup = s.page.getByTestId('element-preview')
  await expect(popup).toBeVisible()
  await expect(popup.getByTestId('element-preview-id')).toHaveText(runId)
  return popup
}

const runLink = (runId: string) => s.page.locator(`[data-element-link="${runId}"]`).first()

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: 'gh399_essai', label: TYPE_LABEL, prefix: 'GHR', category: 'test', fields: [],
    statuses: [{ name: 'valide', isApproval: true }],
    runFields: [{ name: 'gh399Banc', label: 'Banc GH399', type: 'text' }], stepFields: [],
  } as TypeLike]
  issueType = typeOfCategory(root, 'issue', { name: 'gh399-issue', label: 'Issue', prefix: 'GHI', category: 'issue', fields: [], statuses: [{ name: 'ouverte' }] })
  await s.invoke('schema:save', localPath, schema)
  ta = (await s.invoke<{ id: string }>('tests:create', localPath, {
    title: 'GH399 TA', objectTypeRef: 'root::gh399_essai', fields: {},
    steps: [{ order: 1, action: 'Mesurer', expectedResult: 'OK', notes: '' }],
  }, workspaceDir)).id
  const execute = async (key: string, result: string, campaign?: Campaign, extra: Record<string, unknown> = {}) => {
    const entryId = campaign?.runs[0].entryId
    const run = await s.invoke<{ id: string }>('tests:execute', localPath, ta, {
      result, fields: { gh399Banc: `B-${key}` }, stepResults: [{ order: 1, result, comment: '' }],
      ...(campaign && entryId ? { campaignEntry: { campaignId: campaign.id, entryId } } : {}),
      ...await testedVersionArg(s), ...extra,
    }, workspaceDir)
    runs[key] = run.id
    if (campaign && entryId) await s.invoke('campaigns:update-run', localPath, campaign.id, entryId, result, run.id)
  }
  // C1 ouverte : R1. C2 clôturée : R2 remplacé par R3. R4 isolé.
  c1 = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH399 C1', testCaseIds: [ta] }, workspaceDir)
  await execute('r1', 'PASS', c1)
  c2 = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH399 C2', testCaseIds: [ta] }, workspaceDir)
  await execute('r2', 'FAIL', c2)
  await execute('r3', 'PASS', c2)
  await s.invoke('campaigns:close', localPath, c2.id, 'completed')
  // R4 isolé : ses notes citent R1 et un ID inexistant.
  await execute('r4', 'BLOCKED', undefined, { notes: `<p>Voir ${runs.r1 ?? ''} et ${ta}-run-9999</p>` })
  // C3 ouverte : une entrée en attente (pas d'exécution) — reste un bouton vers la page d'exécution.
  c3 = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH399 C3', testCaseIds: [ta] }, workspaceDir)
  issueId = (await s.invoke<{ id: string }>('issues:create', localPath, { objectTypeRef: `root::${issueType}`, title: 'GH399 issue', fields: {} }, workspaceDir)).id
  await s.invoke('issues:add-run', localPath, issueId, runs.r1, workspaceDir)
})

test('E1/E8 — popup d\'une exécution depuis la grille, Échap la ferme', async () => {
  const section = await openTestExecutions()
  const popup = await hoverRun(section.locator(`[data-element-link="${runs.r1}"]`), runs.r1)
  await expect(popup.getByTestId('run-preview-campaign')).toContainText(c1.id)
  await expect(popup.getByTestId('run-preview-header')).toContainText(/Passé|Passed/)
  await expect(popup.getByTestId('element-preview-title')).toContainText('GH399 TA')
  await s.shot('gh399-run-preview')
  await s.page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
})

test('E2 — onglet Popup de la vue Exécutions : champ d\'exécution affiché', async () => {
  await s.openView('Campagnes')
  await s.page.getByTestId('campaigns-nav-executions').click()
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(TYPE_LABEL)
  await s.page.locator('button').filter({ hasText: TYPE_LABEL }).first().click()
  await s.page.getByTestId('executions-config').click()
  await s.page.getByTestId('execution-config-tab-popup').click()
  const banc = s.page.getByTestId('execution-config-popup-run:gh399Banc')
  await banc.click()
  await expect(banc).toBeChecked()
  await s.page.getByTestId('execution-config-close').click()

  const popup = await hoverRun(runLink(runs.r1), runs.r1)
  await expect(popup.getByTestId('run-preview-field-run:gh399Banc')).toContainText('B-r1')
})

test('E3 — clic : page d\'exécution (campagne ouverte), relecture (close)', async () => {
  await openTestExecutions()
  await runLink(runs.r1).click()
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${c1.id}/execute/`))
  await openTestExecutions()
  await runLink(runs.r3).click()
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${c2.id}/run/`))
  // Entrée en attente : pas d'exécution (pas de popup), bouton vers la page d'exécution.
  const section = await openTestExecutions()
  await section.getByTestId(`execution-entry-pending:${c3.id}:${c3.runs[0].entryId}`).locator('button').click()
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${c3.id}/execute/`))
})

test('E4 — remplacée et isolée : popup, pas de navigation', async () => {
  const section = await openTestExecutions()
  const popup = await hoverRun(section.locator(`[data-element-link="${runs.r2}"]`), runs.r2)
  await expect(popup.getByTestId('run-preview-campaign')).toContainText(/remplacé|superseded/)
  const url = s.page.url()
  await section.locator(`[data-element-link="${runs.r2}"]`).click()
  await section.locator(`[data-element-link="${runs.r4}"]`).click()
  await s.page.waitForTimeout(300)
  expect(s.page.url()).toBe(url)
  const isolated = await hoverRun(section.locator(`[data-element-link="${runs.r4}"]`), runs.r4)
  await expect(isolated.getByTestId('run-preview-campaign')).toContainText(/isolée|isolated/i)
})

test('E5 — pastille de résultat d\'une entrée de campagne', async () => {
  await navigate(s.page, s.projectUrl(`/campaign/${c1.id}`, { repoPath: s.project.localPath }))
  await hoverRun(runLink(runs.r1), runs.r1)
})

test('E6 — origine d\'une issue', async () => {
  await navigate(s.page, s.projectUrl('/product', { category: 'issue', node: 'root', type: issueType, view: 'edit', item: issueId }))
  const origin = s.page.getByTestId('issue-origin')
  await expect(origin).toBeVisible()
  await hoverRun(origin.locator(`[data-element-link="${runs.r1}"]`), runs.r1)
})

test('E7 — ID d\'exécution écrit dans des notes : lien si existant, texte sinon', async () => {
  await openTestExecutions()
  await s.page.getByTestId(`execution-toggle-${runs.r4}`).waitFor()
  // Notes du run isolé, dans le Document de la vue Exécutions.
  await s.openView('Campagnes')
  await s.page.getByTestId('campaigns-nav-executions').click()
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(TYPE_LABEL)
  await s.page.locator('button').filter({ hasText: TYPE_LABEL }).first().click()
  await s.page.getByTestId('executions-mode-word').click()
  const card = s.page.getByTestId(`execution-card-${runs.r4}`)
  await expect(card).toContainText(`${ta}-run-9999`)
  await hoverRun(card.locator(`[data-element-ref="${runs.r1}"]`), runs.r1)
  await expect(card.locator(`[data-element-ref="${ta}-run-9999"]`)).toHaveCount(0)
  await expect(card.locator(`[data-element-ref="${ta}"]`)).toHaveCount(0)
})
