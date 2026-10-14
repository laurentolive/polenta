import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { recordResult } from './support/campaign'

/**
 * GH71, adapté à GH74 — avancement des campagnes de la définition des tests au résultat : widget
 * « Avancement par campagne » du seed (étape `entryStep` de la bibliothèque projet, drill-down),
 * ouverture d'une entrée depuis la vue Suivi ; page campagne : pastilles par statut brut (GH74 §11).
 * Tests brouillon / en revue et campagne créés par le test (IPC).
 */
const s = setupSession()

interface TestLike { id: string; objectTypeRef: string; status: string; fields: Record<string, unknown> }
interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string; status: string }> }
interface StatusLike { name: string; label?: string; isApproval?: boolean }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: Array<{ name: string; category: string; statuses?: StatusLike[] }> }> }

const TITLE = 'GH71 avancement'
let campaign: Campaign
let draftId: string, reviewId: string
/** Libellés des statuts de préparation (schéma de la démo). */
let draftLabel: string, reviewLabel: string

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

const dialog = () => s.page.getByRole('dialog')
const widget = (title: string) => s.page.getByTestId('widget-card').filter({ has: s.page.getByText(title, { exact: true }) })

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const tests = await s.invoke<TestLike[]>('tests:list', localPath)
  // Un type de test avec deux statuts avant l'approbation et trois tests approuvés.
  let ref = '', statuses: StatusLike[] = [], approved: TestLike[] = []
  for (const node of schema.nodes) {
    for (const type of node.objectTypes ?? []) {
      const sts = type.statuses ?? []
      const approval = sts.find(st => st.isApproval)?.name
      const candidates = tests.filter(t => t.objectTypeRef === `${node.name}::${type.name}` && t.status === approval)
      if (type.category === 'test' && approval && sts.filter(st => !st.isApproval).length >= 2 && candidates.length >= 3 && !ref) {
        ref = `${node.name}::${type.name}`; statuses = sts; approved = candidates
      }
    }
  }
  test.skip(!ref, 'la démo doit avoir un type de test à deux statuts de préparation et trois tests approuvés')
  const [first, second] = statuses.filter(st => !st.isApproval)
  draftLabel = first!.label ?? first!.name
  reviewLabel = second!.label ?? second!.name

  const create = (title: string) => s.invoke<TestLike>('tests:create', localPath, {
    title, objectTypeRef: ref, fields: approved[0]!.fields,
    steps: [{ order: 1, action: 'Action', expectedResult: 'OK', notes: null }],
  }, workspaceDir)
  draftId = (await create('GH71 brouillon')).id
  reviewId = (await create('GH71 en revue')).id
  await s.invoke('tests:update', localPath, draftId, { status: first!.name }, workspaceDir)
  await s.invoke('tests:update', localPath, reviewId, { status: second!.name }, workspaceDir)

  const [ready, passed, failed] = approved
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, {
    title: TITLE, testCaseIds: [passed!.id, draftId, failed!.id, reviewId, ready!.id],
  }, workspaceDir)
  const entry = (id: string) => campaign.runs.find(r => r.testCaseId === id)!.entryId
  await recordResult(s, campaign.id, entry(passed!.id), 'PASS')
  await recordResult(s, campaign.id, entry(failed!.id), 'FAIL')
})

// GH74 — le widget du seed est un modèle « Barres » sur l'étape `entryStep` de la bibliothèque
// projet (rendu Vega-Lite, SVG) ; l'ouverture d'une entrée filtre la campagne sur son statut brut.
test('W1 / W2 / N1 — widget du seed : étapes ordonnées, drill-down « en revue », ouverture filtrée', async () => {
  await s.openView('Suivi')
  await s.page.getByText('Campagnes', { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
  const bars = widget('Avancement par campagne')
  const legend = bars.locator('[aria-roledescription="legend"]')
  await expect(legend).toHaveCount(1, { timeout: 15_000 })
  // W1 — ordre canonique (d'autres étapes peuvent venir d'autres campagnes de la démo).
  const legendLabel = (await legend.getAttribute('aria-label')) ?? ''
  const labels = legendLabel.replace(/^.*values?: /, '').split(', ').map(x => x.trim())
  const expected = [draftLabel, reviewLabel, 'Prêt à exécuter', 'Échoué', 'Passé']
  expect(labels.filter(l => expected.includes(l))).toEqual(expected)
  await s.shot('gh71-w1-widget')

  // W2 — segment « en revue » de la campagne → son entrée seule.
  const segment = bars.locator(`[aria-roledescription="bar"][aria-label*="campaignTitle: ${TITLE};"][aria-label*="stepLabel: ${reviewLabel}"]`)
  await expect(segment).toHaveCount(1)
  await segment.click()
  await expect(dialog()).toBeVisible()
  const rows = dialog().getByTestId('drilldown-objects').locator('tbody tr')
  await expect(rows).toHaveCount(1)
  // N1 — ouverture de l'entrée (non exécutée) : campagne filtrée sur son statut brut.
  await rows.filter({ hasText: campaign.id }).click()
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${campaign.id}\?.*status=pending`))
  await expect(s.page.getByText(reviewId, { exact: true })).toBeVisible()
})

test('C1–C3 — pastilles par statut brut, filtre ; paramètre `progress` (GH71) ignoré', async () => {
  const p = s.page
  const base = { repoPath: s.project.localPath }
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}`, base))

  // C1 — une pastille par statut d'entrée présent (GH74 : plus d'étape d'avancement).
  const pills = p.locator('button[data-status]')
  await expect(pills).toHaveCount(3)
  expect(await pills.evaluateAll(els => els.map(e => e.getAttribute('data-status')))).toEqual(['PASS', 'FAIL', 'pending'])
  await expect(p.locator('button[data-status="pending"]')).toContainText('3 ')
  await expect(p.locator('button[data-progress]')).toHaveCount(0)
  await s.shot('gh71-c1-pastilles')

  // C2 — clic : filtre ; re-clic : retiré.
  const pending = p.locator('button[data-status="pending"]')
  await pending.click()
  await expect(p).toHaveURL(/status=pending/)
  for (const id of [draftId, reviewId]) await expect(p.getByText(id, { exact: true })).toBeVisible()
  await pending.click()
  await expect(p).not.toHaveURL(/status=/)

  // C3 — ancien lien GH71 `progress=ready` : ignoré, toutes les entrées affichées.
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}`, { ...base, progress: 'ready' }))
  for (const id of [draftId, reviewId]) await expect(p.getByText(id, { exact: true })).toBeVisible()
  await expect(p.getByTestId('campaign-status-filter-clear')).toHaveCount(0)
})
