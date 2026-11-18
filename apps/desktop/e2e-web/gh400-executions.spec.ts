import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { testedVersionArg } from './support/demo-types'

/**
 * GH400 — vue Exécutions (specs/GH400-tests.md E1–E10) : icônes du panneau Campagnes, un type de test
 * à la fois, exécutions remplacées / retirées / isolées / en attente, filtre de la colonne Campagne,
 * lien de la fiche campagne, réglages du 👁, mode Document. Deux types de test dédiés (préfixes
 * GHX / GHY) et deux campagnes créés par le test.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string }> }

const TYPE_A = 'GH400 Essai A'
const TYPE_B = 'GH400 Essai B'
let ta1 = ''
let ta2 = ''
let tb1 = ''
let c1: Campaign
let c2: Campaign
const runs: Record<string, string> = {}

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

async function chooseType(label: string) {
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(label)
  await s.page.locator('button').filter({ hasText: label }).first().click()
}

async function openExecutions(type: string) {
  await s.openView('Campagnes')
  await s.page.getByTestId('campaigns-nav-executions').click()
  await expect(s.page.getByTestId('executions-view')).toBeVisible()
  await chooseType(type)
}

const rows = () => s.page.locator('[data-testid^="execution-row-"]')

async function filterColumn(col: string, text: string) {
  await s.page.getByTestId(`execution-header-${col}`).locator('[data-column-filter-icon]').click()
  const popover = s.page.locator('[data-column-filter-popover]')
  await popover.getByTestId('column-filter-input').fill(text)
  await s.page.getByTestId('execution-count').click()
  await expect(popover).toHaveCount(0)
}

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  const type = (name: string, label: string, prefix: string, field: string, fieldLabel: string) => ({
    name, label, prefix, category: 'test', fields: [], statuses: [{ name: 'valide', isApproval: true }],
    runFields: [{ name: field, label: fieldLabel, type: 'text' }], stepFields: [],
  })
  root.objectTypes = [
    ...(root.objectTypes ?? []),
    type('gh400_a', TYPE_A, 'GHX', 'gh400Banc', 'Banc GH400') as TypeLike,
    type('gh400_b', TYPE_B, 'GHY', 'gh400Op', 'Opérateur GH400') as TypeLike,
  ]
  await s.invoke('schema:save', localPath, schema)
  const create = async (title: string, ref: string) => (await s.invoke<{ id: string }>('tests:create', localPath, {
    title, objectTypeRef: ref, fields: {}, steps: [{ order: 1, action: 'Mesurer', expectedResult: 'OK', notes: '' }],
  }, workspaceDir)).id
  ta1 = await create('GH400 TA1', 'root::gh400_a')
  ta2 = await create('GH400 TA2', 'root::gh400_a')
  tb1 = await create('GH400 TB1', 'root::gh400_b')
  const execute = async (key: string, testId: string, result: string, campaign?: Campaign, entryId?: string, fields: Record<string, string> = {}) => {
    const run = await s.invoke<{ id: string }>('tests:execute', localPath, testId, {
      result, fields, stepResults: [{ order: 1, result, comment: `étape ${key}` }],
      ...(campaign && entryId ? { campaignEntry: { campaignId: campaign.id, entryId } } : {}),
      ...await testedVersionArg(s),
    }, workspaceDir)
    runs[key] = run.id
    if (campaign && entryId) await s.invoke('campaigns:update-run', localPath, campaign.id, entryId, result, run.id)
  }

  // C1 (clôturée) : TA1 exécuté deux fois (le premier essai est remplacé), TA2 exécuté puis retiré.
  c1 = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH400 C1', testCaseIds: [ta1, ta2] }, workspaceDir)
  const e1 = c1.runs.find(r => r.testCaseId === ta1)!.entryId
  const e2 = c1.runs.find(r => r.testCaseId === ta2)!.entryId
  await execute('first', ta1, 'FAIL', c1, e1, { gh400Banc: 'B-1' })
  await execute('retry', ta1, 'PASS', c1, e1, { gh400Banc: 'B-2' })
  await execute('removed', ta2, 'PASS', c1, e2)
  await s.invoke('campaigns:remove-entries', localPath, c1.id, [e2])
  await s.invoke('campaigns:close', localPath, c1.id, 'completed')
  // C2 (ouverte) : TA1 en attente, TB1 exécuté.
  c2 = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH400 C2', testCaseIds: [ta1, tb1] }, workspaceDir)
  await execute('b', tb1, 'PASS', c2, c2.runs.find(r => r.testCaseId === tb1)!.entryId, { gh400Op: 'alice' })
  // Exécution isolée de TA2.
  await execute('isolated', ta2, 'BLOCKED')
})

test('GH400-1 — icônes Campagnes / Exécutions du panneau', async () => {
  await s.openView('Campagnes')
  await expect(s.page.getByTestId('campaigns-nav-campaigns')).toHaveAttribute('aria-pressed', 'true')
  await s.page.getByTestId('campaigns-nav-executions').click()
  await expect(s.page).toHaveURL(/\/executions/)
  await expect(s.page.getByTestId('campaigns-nav-executions')).toHaveAttribute('aria-pressed', 'true')
  await expect(s.page.getByTestId('executions-panel-hint')).toBeVisible()
  await s.page.getByTestId('campaigns-nav-campaigns').click()
  await expect(s.page).toHaveURL(/\/product\?.*category=campaign/)
})

test('GH400-2 — un type à la fois : remplacé, retiré, isolé, en attente ; champs du type seulement', async () => {
  await openExecutions(TYPE_A)
  await expect(rows()).toHaveCount(5)
  await expect(s.page.getByTestId(`execution-row-${runs.first}`)).toContainText(/remplacé|superseded/)
  await expect(s.page.getByTestId(`execution-row-${runs.removed}`)).toContainText(/retirée|removed/)
  await expect(s.page.getByTestId(`execution-row-${runs.isolated}`)).toContainText(/isolée|isolated/i)
  await expect(s.page.getByTestId(`execution-row-${runs.b}`)).toHaveCount(0)

  await s.page.getByTestId('executions-config').click()
  await expect(s.page.getByTestId('execution-config-excel-run:gh400Banc')).toBeVisible()
  await expect(s.page.getByTestId('execution-config-excel-run:gh400Op')).toHaveCount(0)
  await s.page.getByTestId('execution-config-close').click()

  await chooseType(TYPE_B)
  await expect(rows()).toHaveCount(1)
  await expect(s.page.getByTestId(`execution-row-${runs.b}`)).toBeVisible()
  await s.page.goBack()
  await expect(rows()).toHaveCount(5)
  await s.shot('gh400-executions-table')
})

test('GH400-3 — filtre de la colonne Campagne', async () => {
  await openExecutions(TYPE_A)
  await filterColumn('campaign', c1.id)
  await expect(rows()).toHaveCount(3)
  await expect(s.page.getByTestId(`execution-row-${runs.first}`)).toBeVisible()
  await expect(s.page.getByTestId(`execution-row-${runs.removed}`)).toBeVisible()
})

test('GH400-4 — « Voir les exécutions » de la fiche campagne, même colonne masquée', async () => {
  await openExecutions(TYPE_A)
  // Colonne Campagne masquée dans le Tableau : le lien l'affiche sans changer la préférence.
  await s.page.getByTestId('executions-config').click()
  const campaignBox = s.page.getByTestId('execution-config-excel-campaign')
  await campaignBox.click()
  await expect(campaignBox).not.toBeChecked()
  await s.page.getByTestId('execution-config-close').click()

  await navigate(s.page, s.projectUrl(`/campaign/${c1.id}`, { repoPath: s.project.localPath }))
  await s.page.getByTestId('campaign-view-executions').click()
  await expect(s.page).toHaveURL(new RegExp(`campaign=${c1.id}`))
  await expect(rows()).toHaveCount(3)
  await expect(s.page.getByTestId('execution-header-campaign')).toBeVisible()
  await s.page.getByTestId('executions-config').click()
  await expect(s.page.getByTestId('execution-config-excel-campaign')).not.toBeChecked()
  await s.page.getByTestId('execution-config-excel-campaign').click()   // rétabli pour la suite
  await s.page.getByTestId('execution-config-close').click()
})

test('GH400-5 — navigation : relecture (C1 clôturée), pas de lien pour remplacé / retiré / isolé', async () => {
  await openExecutions(TYPE_A)
  await expect(s.page.getByTestId(`execution-entry-${runs.first}`).locator('button')).toHaveCount(0)
  await expect(s.page.getByTestId(`execution-entry-${runs.removed}`).locator('button')).toHaveCount(0)
  await s.page.getByTestId(`execution-entry-${runs.retry}`).locator('button').click()
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${c1.id}/run/`))
})

test('GH400-6 — 👁 Tableau : colonne masquée persistée, section de l\'éditeur inchangée', async () => {
  await openExecutions(TYPE_A)
  await s.page.getByTestId('executions-config').click()
  await s.page.getByTestId('execution-config-excel-date').click()
  await s.page.getByTestId('execution-config-close').click()
  await expect(s.page.getByTestId('execution-header-date')).toHaveCount(0)
  await s.page.reload()
  await expect(s.page.getByTestId('executions-view')).toBeVisible()
  await expect(rows()).toHaveCount(5)
  await expect(s.page.getByTestId('execution-header-date')).toHaveCount(0)

  await navigate(s.page, s.projectUrl(`/test/${ta1}`, { repoPath: s.project.localPath }))
  const section = s.page.getByTestId('executions-section')
  await section.locator('summary').click()
  await expect(section.getByTestId('execution-header-date')).toBeVisible()
})

test('GH400-7 — Document : une fiche par exécution filtrée, champs de l\'onglet Document, étapes', async () => {
  await openExecutions(TYPE_A)
  await filterColumn('campaign', c1.id)
  await s.page.getByTestId('executions-mode-word').click()
  await expect(s.page.getByTestId('executions-document').locator(':scope > section')).toHaveCount(3)
  await expect(s.page.getByTestId(`execution-card-${runs.isolated}`)).toHaveCount(0)   // filtre du Tableau
  const retry = s.page.getByTestId(`execution-card-${runs.retry}`)
  await expect(retry.getByTestId('execution-card-steps')).toContainText('étape retry')

  // Onglet Document : champ d'exécution ajouté, persisté par type.
  await s.page.getByTestId('executions-config').click()
  await expect(s.page.getByTestId('execution-config-tab-word')).toHaveAttribute('aria-selected', 'true')
  await s.page.getByTestId('execution-config-word-run:gh400Banc').click()
  await s.page.getByTestId('execution-config-close').click()
  await expect(retry.getByTestId('execution-card-field-run:gh400Banc')).toContainText('B-2')
  await s.shot('gh400-executions-document')

  // Type B : son propre réglage (champ de A absent).
  await chooseType(TYPE_B)
  await expect(s.page.getByTestId(`execution-card-${runs.b}`)).toBeVisible()
  await s.page.getByTestId('executions-config').click()
  await s.page.getByTestId('execution-config-tab-word').click()
  await expect(s.page.getByTestId('execution-config-word-run:gh400Banc')).toHaveCount(0)
  await expect(s.page.getByTestId('execution-config-word-run:gh400Op')).not.toBeChecked()
  // Réinitialiser : retour au défaut (étapes cochées).
  await s.page.getByTestId('execution-config-word-steps').click()
  await expect(s.page.getByTestId('execution-config-word-steps')).not.toBeChecked()
  await s.page.getByTestId('execution-config-reset').click()
  await expect(s.page.getByTestId('execution-config-word-steps')).toBeChecked()
  await s.page.getByTestId('execution-config-close').click()
})
