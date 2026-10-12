import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH65 sprint 2 — navigation depuis la vue Suivi : drill-down (popup de détail), ouverture des
 * objets, filtre par statut de la page campagne. Scénarios 2.1, 2.4, 2.6–2.9, 2.20 de
 * specs/GH65-tests.md. La campagne est créée par le test.
 */
const s = setupSession()

interface Campaign { id: string; title: string; runs: Array<{ entryId: string; testCaseId: string; status: string }> }

const TITLE = 'GH65 navigation'
let campaign: Campaign

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const tests = await s.invoke<Array<{ id: string }>>('tests:list', localPath)
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: TITLE, testCaseIds: tests.slice(0, 4).map(t => t.id) }, workspaceDir)
  const [e1, e2, e3] = campaign.runs.map(r => r.entryId)
  await s.invoke('campaigns:update-run', localPath, campaign.id, e1, 'PASS')
  await s.invoke('campaigns:update-run', localPath, campaign.id, e2, 'FAIL')
  await s.invoke('campaigns:update-run', localPath, campaign.id, e3, 'FAIL')
})

async function openCampaignsDashboard() {
  await s.openView('Suivi')
  // Le libellé figure aussi dans la barre d'onglets (au-dessus, dans le DOM) : l'entrée du panneau.
  await s.page.getByText('Campagnes', { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
}

const dialog = () => s.page.getByRole('dialog')
const widget = (title: string) => s.page.locator('div.h-64').filter({ has: s.page.getByText(title, { exact: true }) })

test('2.1 — clic sur le segment FAIL de la campagne → ses entrées FAIL', async () => {
  await openCampaignsDashboard()
  // Un calque `g.recharts-bar` par série, dans l'ordre de la légende.
  const bars = widget('Avancement par campagne')
  await expect(bars.locator('.recharts-legend-item').filter({ hasText: /^FAIL$/ })).toBeVisible()
  const series = await bars.locator('.recharts-legend-item').evaluateAll(els => els.findIndex(e => e.textContent?.trim() === 'FAIL'))
  expect(series).toBeGreaterThanOrEqual(0)
  const segments = bars.locator('g.recharts-bar').nth(series).locator('path.recharts-rectangle')
  // Barres animées au montage (recharts) : attendre qu'elles soient dessinées.
  await expect.poll(() => segments.count(), { timeout: 10_000 }).toBeGreaterThan(0)
  const count = await segments.count()
  let found = false
  for (let i = 0; i < count && !found; i++) {
    await segments.nth(i).click()
    await expect(dialog()).toBeVisible()
    if ((await dialog().locator('h2').innerText()).includes(TITLE)) {
      found = true
      const rows = dialog().locator('tbody tr')
      await expect(rows).toHaveCount(2)
      for (const entry of campaign.runs.slice(1, 3)) await expect(rows.filter({ hasText: entry.entryId })).toHaveCount(1)
      await expect(dialog().getByTestId('drilldown-fallback')).toHaveCount(0)
    }
    if (!found) await s.page.keyboard.press('Escape')
  }
  expect(found).toBe(true)
})

test('2.6 — ligne d\'une entrée exécutée → résultat d\'exécution', async () => {
  // Popup ouverte par le test précédent (fichier en série).
  const failed = campaign.runs[1].entryId
  await dialog().locator('tbody tr').filter({ hasText: failed }).click()
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${campaign.id}/run/${failed}`))
})

test('2.4 / 2.7 — KPI « % exécuté » → toutes les entrées ; ligne pending → campagne filtrée', async () => {
  await openCampaignsDashboard()
  await widget('% exécuté').locator('[data-drilldown="kpi"]').click()
  await expect(dialog()).toBeVisible()
  const pending = campaign.runs[3].entryId
  const row = dialog().locator('tbody tr').filter({ hasText: campaign.id }).filter({ hasText: pending })
  await expect(row).toHaveCount(1)
  await row.click()
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${campaign.id}\\?.*status=pending`))
  await expect(s.page.getByRole('button', { name: /1 pending/ })).toHaveAttribute('aria-pressed', 'true')
})

test('2.9 — pastilles de statut : filtre, re-clic pour retirer', async () => {
  // Page de la campagne ouverte par le test précédent, filtrée sur `pending`.
  const fail = s.page.getByRole('button', { name: /2 FAIL/ })
  await fail.click()
  await expect(s.page).toHaveURL(/status=FAIL/)
  await expect(fail).toHaveAttribute('aria-pressed', 'true')
  await expect(s.page.getByRole('button', { name: /1 pending/ })).toHaveAttribute('aria-pressed', 'false')
  // La liste affiche l'ID du test de chaque entrée.
  await expect(s.page.getByText(campaign.runs[3].testCaseId, { exact: true })).toHaveCount(0)
  await expect(s.page.getByText(campaign.runs[1].testCaseId, { exact: true })).toBeVisible()
  await fail.click()
  await expect(s.page).not.toHaveURL(/status=/)
  await expect(s.page.getByText(campaign.runs[3].testCaseId, { exact: true })).toBeVisible()
})

test('2.8 / 2.20 — cible d\'une exigence ; requête SQL avec jointure → repli', async () => {
  const { localPath, workspaceDir } = s.project
  const reqs = await s.invoke<Array<{ id: string }>>('requirements:list', localPath)
  const target = await s.invoke<{ kind: string; id: string }>('queries:resolve-row-target', localPath, { id: reqs[0].id }, workspaceDir)
  expect(target).toMatchObject({ kind: 'requirement', id: reqs[0].id })

  const drill = await s.invoke<{ mode: string; rows: unknown[] }>('queries:drill-down', localPath, {
    mode: 'sql',
    sqlText: 'SELECT r.status AS status, COUNT(*) AS n FROM requirements r JOIN requirements q ON q.id = r.id GROUP BY r.status',
  }, { values: { status: 'approved' } }, workspaceDir)
  expect(drill.mode).toBe('result')
  expect(drill.rows.length).toBeLessThanOrEqual(1)
})
