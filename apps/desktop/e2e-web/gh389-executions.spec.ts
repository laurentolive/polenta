import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { testedVersionArg } from './support/demo-types'

/**
 * GH389 — historique des exécutions sur la grille commune (specs/GH389-tests.md E10, spec §4 et
 * critère C10) : en-têtes sans tri, filtre par colonne et compteur, barre d'outils commune, test et
 * campagne en liens d'élément (popup), Entrée sur une cellule de lien non éditable (suit le lien).
 * Type de test, exigence, liens, deux campagnes et deux runs créés par IPC.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface SchemaLike { nodes: Array<{ name: string; objectTypes?: Array<{ name: string; category: string }> }>; linkTypes?: Array<{ name: string }> }
interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string }> }

let reqId = ''
const testIds: string[] = []
const campaigns: Campaign[] = []

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: 'gh389x_essai', label: 'GH389X Essai', prefix: 'GH389X', category: 'test', fields: [],
    statuses: [{ name: 'valide', isApproval: true }],
  } as never]
  await s.invoke('schema:save', localPath, schema)
  const reqTypes = schema.nodes.flatMap(n => (n.objectTypes ?? []).filter(t => t.category === 'requirement').map(t => `${n.name}::${t.name}`))
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: reqTypes[0], title: 'GH389X R' })).id
  for (const [i, result] of (['FAIL', 'PASS'] as const).entries()) {
    const testId = (await s.invoke<{ id: string }>('tests:create', localPath, {
      title: `GH389X T${i + 1}`, objectTypeRef: 'root::gh389x_essai', fields: {},
      steps: [{ order: 1, action: 'Mesurer', expectedResult: '12 V', notes: '' }],
    }, workspaceDir)).id
    testIds.push(testId)
    await s.invoke('requirements:link-create', localPath, { type: schema.linkTypes?.[0]?.name ?? 'verification', sourceId: testId, targetId: reqId })
    const campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: `GH389X campagne ${i + 1}`, testCaseIds: [testId] }, workspaceDir)
    campaigns.push(campaign)
    const entry = campaign.runs[0]
    const run = await s.invoke<{ id: string }>('tests:execute', localPath, testId, {
      result, stepResults: [{ order: 1, result }],
      campaignEntry: { campaignId: campaign.id, entryId: entry.entryId },
      ...await testedVersionArg(s),
    }, workspaceDir)
    await s.invoke('campaigns:update-run', localPath, campaign.id, entry.entryId, result, run.id)
  }
})

test('E10 — sans tri, filtre par colonne, liens d’élément, Entrée sur un lien', async () => {
  const p = s.page
  await navigate(p, s.projectUrl(`/req/${reqId}`, { repoPath: s.project.localPath }))
  const section = p.getByTestId('executions-section')
  await section.locator('summary').click()
  const rows = section.locator('tr[data-node-id]')
  await expect(rows).toHaveCount(2)
  const order = () => rows.evaluateAll(els => els.map(e => e.getAttribute('data-node-id')))
  const before = await order()

  // Barre d'outils commune : 👁, Exporter, compteur ; plus de bouton ⚙️.
  await expect(section.getByTestId('execution-columns')).toBeVisible()
  await expect(section.getByTestId('execution-count')).toContainText('2 / 2')
  await expect(section.getByTestId('execution-columns-button')).toHaveCount(0)

  // En-têtes : un clic ne trie plus (D4).
  for (const col of ['verdict', 'test', 'campaign']) {
    await section.getByTestId(`execution-header-${col}`).click({ position: { x: 8, y: 8 } })
    expect(await order()).toEqual(before)
  }

  // Filtre par colonne sur le test : une ligne, compteur « 1 / 2 », icône active.
  const header = section.getByTestId('execution-header-test')
  await header.locator('[data-column-filter-icon]').click()
  const popover = p.locator('[data-column-filter-popover]')
  await popover.getByTestId('column-filter-input').fill(testIds[1])
  await section.getByTestId('execution-count').click()
  await expect(popover).toHaveCount(0)
  await expect(rows).toHaveCount(1)
  await expect(section.getByTestId('execution-count')).toContainText('1 / 2')
  await expect(header.locator('[data-column-filter-icon]')).toHaveAttribute('data-active', 'true')
  await header.locator('[data-column-filter-icon]').click()
  await p.getByTestId('column-filter-input').press('Escape')
  await expect(rows).toHaveCount(2)

  // Test et campagne : liens d'élément avec popup d'aperçu.
  const row = section.locator(`tr[data-node-id]`, { has: p.locator(`[data-element-link="${testIds[0]}"]`) })
  const testLink = row.locator(`td[data-col="test"] [data-element-link="${testIds[0]}"]`)
  await testLink.hover()
  await expect(p.getByTestId('element-preview')).toBeVisible()
  await expect(p.getByTestId('element-preview')).toContainText(testIds[0])
  await p.mouse.move(0, 0)
  await expect(p.getByTestId('element-preview')).toHaveCount(0)
  const campaignCell = row.locator('td[data-col="campaign"]')
  await expect(campaignCell.locator(`[data-element-link="${campaigns[0].id}"]`)).toBeVisible()
  await s.shot('gh389-executions')

  // Entrée sur la cellule de campagne (non éditable) : suit le lien, comme le clic.
  const box = (await campaignCell.boundingBox())!
  await campaignCell.click({ position: { x: box.width - 4, y: box.height / 2 } })
  await expect(campaignCell).toHaveAttribute('data-active', 'true')
  await p.keyboard.press('Enter')
  await expect.poll(() => new URL(p.url()).pathname).toContain(`/campaign/${campaigns[0].id}`)
})
