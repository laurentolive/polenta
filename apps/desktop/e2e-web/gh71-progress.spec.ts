import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH71 — avancement des campagnes de la définition des tests au résultat : widget « Avancement par
 * campagne » (préréglage, drill-down), ouverture d'une entrée depuis la vue Suivi, pastilles et
 * filtre `progress` de la page campagne. Scénarios W1, W2, N1, C1–C3 de specs/GH71-tests.md.
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
const widget = (title: string) => s.page.locator('div.h-64').filter({ has: s.page.getByText(title, { exact: true }) })

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
  await s.invoke('campaigns:update-run', localPath, campaign.id, entry(passed!.id), 'PASS')
  await s.invoke('campaigns:update-run', localPath, campaign.id, entry(failed!.id), 'FAIL')
})

test('W1 / W2 / N1 — widget du seed : étapes ordonnées, drill-down « en revue », ouverture filtrée', async () => {
  await s.openView('Suivi')
  await s.page.getByText('Campagnes', { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
  const bars = widget('Avancement par campagne')
  const legend = bars.locator('.recharts-legend-item')
  await expect(legend.filter({ hasText: new RegExp(`^${reviewLabel}$`) })).toBeVisible()
  const labels = (await legend.allInnerTexts()).map(x => x.trim())
  // W1 — ordre canonique (d'autres étapes peuvent venir d'autres campagnes de la démo).
  const expected = [draftLabel, reviewLabel, 'Prêt à exécuter', 'Échoué', 'Passé']
  expect(labels.filter(l => expected.includes(l))).toEqual(expected)

  // W2 — segment « en revue » de la campagne → son entrée seule.
  const series = labels.indexOf(reviewLabel)
  const segments = bars.locator('g.recharts-bar').nth(series).locator('path.recharts-rectangle')
  await expect.poll(() => segments.count(), { timeout: 10_000 }).toBeGreaterThan(0)
  await s.page.waitForTimeout(600) // fin de l'animation de montage des barres (capture)
  await s.shot('gh71-w1-widget')
  let found = false
  for (let i = 0; i < (await segments.count()) && !found; i++) {
    await segments.nth(i).click()
    await expect(dialog()).toBeVisible()
    if ((await dialog().locator('h2').innerText()).includes(TITLE)) {
      found = true
      await expect(dialog().locator('tbody tr')).toHaveCount(1)
      // N1 — ouverture de l'entrée : campagne filtrée sur son étape.
      await dialog().locator('tbody tr').filter({ hasText: reviewId }).click()
    } else {
      await s.page.keyboard.press('Escape')
    }
  }
  expect(found).toBe(true)
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${campaign.id}\\?.*progress=prep%3A|progress=prep:`))
  await expect(s.page.getByText(reviewId, { exact: true })).toBeVisible()
  await expect(s.page.getByText(draftId, { exact: true })).toHaveCount(0)
})

test('C1–C3 — pastilles par étape, filtre, compatibilité `status=pending`', async () => {
  const p = s.page
  const base = { repoPath: s.project.localPath }
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}`, base))

  // C1 — une pastille par étape présente, dans l'ordre canonique.
  const pills = p.locator('button[data-progress]')
  await expect(pills).toHaveCount(5)
  expect(await pills.evaluateAll(els => els.map(e => e.getAttribute('data-progress')))).toEqual([
    expect.stringMatching(/^prep:/), expect.stringMatching(/^prep:/), 'ready', 'FAIL', 'PASS',
  ])
  await expect(pills.first()).toContainText(`1 ${draftLabel}`)
  await s.shot('gh71-c1-pastilles')

  // C2 — clic : filtre ; re-clic : retiré.
  const ready = p.locator('button[data-progress="ready"]')
  await ready.click()
  await expect(p).toHaveURL(/progress=ready/)
  await expect(p.getByText('Filtre : Prêt à exécuter ✕')).toBeVisible()
  await expect(p.getByText(draftId, { exact: true })).toHaveCount(0)
  await ready.click()
  await expect(p).not.toHaveURL(/progress=/)
  await expect(p.getByText(draftId, { exact: true })).toBeVisible()

  // C3 — lien GH65 `status=pending` : les trois entrées non exécutées.
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}`, { ...base, status: 'pending' }))
  for (const id of [draftId, reviewId]) await expect(p.getByText(id, { exact: true })).toBeVisible()
  await expect(p.getByText('Filtre : En attente ✕')).toBeVisible()
})
