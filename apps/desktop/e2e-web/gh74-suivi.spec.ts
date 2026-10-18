import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { recordResult } from './support/campaign'

/**
 * GH74 sprint 3 — vue Suivi : widget « Avancement dans le temps » du seed Campagnes (drill-down par
 * relance `polenta.drill`), bibliothèque de départ copiée au premier accès et bandeau des mises à jour.
 */
const s = setupSession()

interface Campaign { id: string; title: string; runs: Array<{ entryId: string; testCaseId: string }> }

const TITLE = 'GH74 dans le temps'
let campaign: Campaign

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const tests = await s.invoke<Array<{ id: string }>>('tests:list', localPath)
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: TITLE, testCaseIds: tests.slice(0, 2).map(t => t.id) }, workspaceDir)
  await s.invoke('campaigns:update', localPath, campaign.id, { status: 'in_progress' }, workspaceDir)
  await recordResult(s, campaign.id, campaign.runs[0].entryId, 'PASS')
})

async function openCampaignsDashboard() {
  await s.openView('Suivi')
  await s.page.getByText('Campagnes', { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
}

const dialog = () => s.page.getByRole('dialog')
const widget = (title: string) => s.page.getByTestId('widget-card').filter({ has: s.page.getByText(title, { exact: true }) })

test('T1 — « Avancement dans le temps » : aire par étape d\'avancement (GH112), clic sur un point → entrées de ce jour et cette étape', async () => {
  await openCampaignsDashboard()
  const timeline = widget('Avancement dans le temps')
  await timeline.scrollIntoViewIfNeeded()
  const legend = timeline.locator('[aria-roledescription="legend"]')
  await expect(legend).toHaveAttribute('aria-label', /Passé/, { timeout: 15_000 })
  await s.shot('gh74-t1-timeline')
  // Dernier jour, étape « Passé » : au moins l'entrée exécutée par le test (relance du script, `_ids`).
  const point = timeline.locator('[aria-roledescription="bar"][aria-label*="stepLabel: Passé"]').last()
  await point.click({ force: true })
  await expect(dialog()).toBeVisible()
  await expect(dialog().getByTestId('drilldown-objects').locator('tbody tr').filter({ hasText: `${campaign.id}/${campaign.runs[0].entryId}` })).toHaveCount(1)
  await s.page.keyboard.press('Escape')
})

test('B1 / U1 — bibliothèque copiée au premier accès ; fichier livré manquant proposé puis appliqué', async () => {
  const { localPath } = s.project
  // Copiée au premier accès à Suivi (test précédent), notée dans le marqueur.
  expect(fs.existsSync(path.join(localPath, 'dashboards/lib/campaign.js'))).toBe(true)
  const markerPath = path.join(localPath, 'dashboards/.seeded.yaml')
  const marker = yaml.load(fs.readFileSync(markerPath, 'utf8')) as { library: string[] }
  expect(marker.library).toContain('dashboards/lib/time.js')

  // Fichier livré « jamais copié » (comme un fichier ajouté par une version plus récente de Polenta).
  fs.rmSync(path.join(localPath, 'dashboards/lib/time.js'))
  fs.writeFileSync(markerPath, yaml.dump({ ...marker, library: marker.library.filter(f => f !== 'dashboards/lib/time.js') }))

  await s.page.reload()
  await s.openView('Suivi')
  const banner = s.page.getByTestId('suivi-updates')
  await expect(banner).toContainText('Mise à jour disponible (1)', { timeout: 15_000 })
  await banner.getByRole('button', { name: /Mise à jour disponible/ }).click()
  await expect(banner.getByTestId('suivi-update')).toContainText('dashboards/lib/time.js (nouveau)')
  await s.shot('gh74-u1-bandeau')
  await banner.getByRole('button', { name: 'Appliquer' }).click()
  await expect(banner).toHaveCount(0)
  expect(fs.existsSync(path.join(localPath, 'dashboards/lib/time.js'))).toBe(true)
})
