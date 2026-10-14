import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { recordResult } from './support/campaign'

/**
 * GH65 sprint 2, adapté à GH74 (graphe de données, scripts, rendu Vega-Lite) — navigation depuis la
 * vue Suivi : drill-down (popup de détail des objets d'une marque), ouverture des objets, filtre par
 * statut de la page campagne, requête SQL d'avant GH74 en lecture seule. La campagne est créée par
 * le test ; les widgets viennent du seed « Campagnes » (modèles GH74).
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
  await recordResult(s, campaign.id, e1, 'PASS')
  await recordResult(s, campaign.id, e2, 'FAIL')
  await recordResult(s, campaign.id, e3, 'FAIL')
})

async function openCampaignsDashboard() {
  await s.openView('Suivi')
  // Le libellé figure aussi dans la barre d'onglets (au-dessus, dans le DOM) : l'entrée du panneau.
  await s.page.getByText('Campagnes', { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
}

const dialog = () => s.page.getByRole('dialog')
const widget = (title: string) => s.page.getByTestId('widget-card').filter({ has: s.page.getByText(title, { exact: true }) })
/** Barre Vega (rendu SVG) dont la description ARIA contient tous les fragments. */
const bar = (title: string, ...parts: string[]) =>
  widget(title).locator(`[aria-roledescription="bar"]${parts.map(p => `[aria-label*="${p}"]`).join('')}`)

test('2.1 — clic sur le segment « Échoué » de la campagne → ses entrées FAIL', async () => {
  await openCampaignsDashboard()
  // GH74 — série = étape d'avancement (`entryStep`), libellée ; résultats sous leur libellé.
  const segment = bar('Avancement par campagne', `campaignTitle: ${TITLE};`, 'stepLabel: Échoué')
  await expect(segment).toHaveCount(1, { timeout: 15_000 })
  await s.shot('gh65-2-1-widget')
  await segment.click()
  await expect(dialog()).toBeVisible()
  const rows = dialog().getByTestId('drilldown-objects').locator('tbody tr')
  await expect(rows).toHaveCount(2)
  for (const r of campaign.runs.slice(1, 3)) await expect(rows.filter({ hasText: `${campaign.id}/${r.entryId}` })).toHaveCount(1)
})

test('2.6 — ligne d\'une entrée exécutée → résultat d\'exécution', async () => {
  // Popup ouverte par le test précédent (fichier en série).
  const failed = campaign.runs[1].entryId
  await dialog().locator('tbody tr').filter({ hasText: failed }).click()
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${campaign.id}/run/${failed}`))
})

test('2.4 / 2.7 — KPI « % exécuté » → entrées exécutées ; entrée en attente → campagne filtrée', async () => {
  await openCampaignsDashboard()
  await widget('% exécuté').locator('[data-drilldown="kpi"]').click()
  await expect(dialog()).toBeVisible()
  await expect(dialog().locator('tbody tr').filter({ hasText: `${campaign.id}/${campaign.runs[0].entryId}` })).toHaveCount(1)
  await s.page.keyboard.press('Escape')

  const pending = campaign.runs[3].entryId
  // Entrée non exécutée : segment de son étape (préparation ou « Prêt à exécuter »).
  await widget('Avancement par campagne')
    .locator(`[aria-roledescription="bar"][aria-label*="campaignTitle: ${TITLE};"]:not([aria-label*="stepLabel: Échoué"]):not([aria-label*="stepLabel: Passé"])`)
    .click()
  const row = dialog().locator('tbody tr').filter({ hasText: `${campaign.id}/${pending}` })
  await expect(row).toHaveCount(1)
  await row.click()
  await expect(s.page).toHaveURL(new RegExp(`/campaign/${campaign.id}\\?.*status=pending`))
})

test('2.9 — pastilles de statut : filtre, re-clic pour retirer', async () => {
  // Page de la campagne ouverte par le test précédent.
  const fail = s.page.getByRole('button', { name: /2 Échoué/ })
  await fail.click()
  await expect(fail).toHaveAttribute('aria-pressed', 'true')
  await expect(s.page.getByText(campaign.runs[3].testCaseId, { exact: true })).toHaveCount(0)
  await expect(s.page.getByText(campaign.runs[1].testCaseId, { exact: true })).toBeVisible()
  await fail.click()
  await expect(fail).toHaveAttribute('aria-pressed', 'false')
})

test('2.8 — cible d\'une exigence ; requête SQL d\'avant GH74 : lecture seule, non exécutable', async () => {
  const { localPath, workspaceDir } = s.project
  const reqs = await s.invoke<Array<{ id: string }>>('requirements:list', localPath)
  const target = await s.invoke<{ kind: string; id: string }>('suivi:resolve-target', localPath, workspaceDir, reqs[0].id)
  expect(target).toMatchObject({ kind: 'requirement', id: reqs[0].id })

  fs.mkdirSync(path.join(localPath, 'queries'), { recursive: true })
  fs.writeFileSync(path.join(localPath, 'queries', 'QUERY-9001.yaml'), [
    'id: QUERY-9001', 'title: Ancienne requête SQL', 'mode: sql', 'sqlText: SELECT * FROM requirements', 'scope: shared',
    'createdBy: e2e', 'createdAt: "2026-01-01T00:00:00Z"', '',
  ].join('\n'))
  const username = await s.invoke<string>('auth:project-username', localPath)
  const queries = await s.invoke<Array<{ id: string; legacySql?: string; state: { readOnly?: string } }>>('queries:list', localPath, username)
  expect(queries.find(q => q.id === 'QUERY-9001')).toMatchObject({ legacySql: 'SELECT * FROM requirements', state: { readOnly: 'legacy-sql' } })
  const run = await s.invoke<{ ok: boolean; error?: { kind: string } }>('suivi:run', localPath, workspaceDir, username, { queryId: 'QUERY-9001' }, { locale: 'fr', timezone: 'UTC' })
  expect(run).toMatchObject({ ok: false, error: { kind: 'legacy-sql' } })
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/query', { queryId: 'QUERY-9001' }))
  await expect(s.page.getByTestId('legacy-sql')).toContainText('SELECT * FROM requirements')
  await s.invoke('queries:delete', localPath, username, 'QUERY-9001')
})
