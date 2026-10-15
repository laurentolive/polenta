import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { recordResult } from './support/campaign'

/**
 * GH93 — paramètres choisis à l'affichage : sélecteur « Campagne » du seed Campagnes (mémorisé par
 * utilisateur, valeur introuvable, réinitialisation), types texte / énumération / obligatoire sur une
 * requête écrite à la main (specs/GH93-tests.md 1–4, 6, 10, 12, 17–19, 23).
 */
const s = setupSession()

interface Campaign { id: string; title: string; runs: Array<{ entryId: string; testCaseId: string }> }

const OPEN_TITLE = 'GH93 en cours'
const CLOSED_TITLE = 'GH93 terminée'
let open: Campaign
let closed: Campaign
let username: string

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  username = await s.invoke<string>('auth:project-username', localPath)
  const tests = await s.invoke<Array<{ id: string }>>('tests:list', localPath)
  open = await s.invoke<Campaign>('campaigns:create', localPath, { title: OPEN_TITLE, testCaseIds: tests.slice(0, 1).map(t => t.id) }, workspaceDir)
  await s.invoke('campaigns:update', localPath, open.id, { status: 'in_progress' }, workspaceDir)
  await recordResult(s, open.id, open.runs[0].entryId, 'PASS')
  closed = await s.invoke<Campaign>('campaigns:create', localPath, { title: CLOSED_TITLE, testCaseIds: tests.slice(1, 2).map(t => t.id) }, workspaceDir)
  await s.invoke('campaigns:update', localPath, closed.id, { status: 'in_progress' }, workspaceDir)
  await recordResult(s, closed.id, closed.runs[0].entryId, 'FAIL')
  await s.invoke('campaigns:close', localPath, closed.id, 'completed')
})

async function openDashboard(title: string) {
  await s.openView('Suivi')
  await s.page.getByText(title, { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
}

const widget = (title: string) => s.page.getByTestId('widget-card').filter({ has: s.page.getByText(title, { exact: true }) })
const dialog = () => s.page.getByRole('dialog')
const campaignSelect = () => s.page.getByTestId('param-bar').getByTestId('param-campaign')

test('1 / 2 / 3 / 12 — seed Campagnes : « Toutes » puis une campagne terminée, drill-down limité à elle', async () => {
  await openDashboard('Campagnes')
  await expect(campaignSelect()).toHaveValue('')
  // « Toutes » : filtres du seed (campagnes en cours) — la campagne terminée n'apparaît pas.
  const progress = widget('Avancement par campagne')
  await expect(progress.locator('[aria-roledescription="bar"]').first()).toBeAttached({ timeout: 15_000 })
  await expect(progress.locator(`[aria-label*="${CLOSED_TITLE}"]`)).toHaveCount(0)
  await expect(progress.locator(`[aria-label*="${OPEN_TITLE}"]`).first()).toBeAttached()

  await campaignSelect().selectOption(closed.id)
  await expect(progress.locator(`[aria-label*="${CLOSED_TITLE}"]`).first()).toBeAttached({ timeout: 15_000 })
  await expect(progress.locator(`[aria-label*="${OPEN_TITLE}"]`)).toHaveCount(0)
  await expect(widget('Entrées en échec')).toContainText(closed.runs[0].testCaseId)
  await s.shot('gh93-campaign-chosen')

  // Avancement dans le temps : le point FAIL du dernier jour ne contient que l'entrée de cette campagne.
  const timeline = widget('Avancement dans le temps')
  await timeline.scrollIntoViewIfNeeded()
  const point = timeline.locator('[aria-roledescription="bar"][aria-label*="status: FAIL"]').last()
  await point.click({ force: true })
  await expect(dialog()).toBeVisible()
  const rows = dialog().getByTestId('drilldown-objects').locator('tbody tr')
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText(`${closed.id}/${closed.runs[0].entryId}`)
  await s.page.keyboard.press('Escape')
})

test('4 / 6 — choix mémorisé (rechargement), propre à l\'utilisateur ; Réinitialiser', async () => {
  const { localPath } = s.project
  await s.page.reload()
  await openDashboard('Campagnes')
  await expect(campaignSelect()).toHaveValue(closed.id)
  const pref = JSON.parse(fs.readFileSync(path.join(localPath, `.${username}.pref`), 'utf8')) as { suiviParamValues?: Record<string, Record<string, unknown>> }
  expect(Object.values(pref.suiviParamValues ?? {})).toContainEqual({ 'campaign:campaign': closed.id })

  await s.page.getByTestId('param-reset').click()
  await expect(campaignSelect()).toHaveValue('')
  await expect(widget('Avancement par campagne').locator(`[aria-label*="${OPEN_TITLE}"]`).first()).toBeAttached({ timeout: 15_000 })
})

test('18 — valeur introuvable : signalée, widgets sur « Toutes »', async () => {
  const { localPath } = s.project
  const dashboards = await s.invoke<Array<{ id: string; title: string }>>('dashboards:list', localPath, username)
  const id = dashboards.find(d => d.title === 'Campagnes')!.id
  await s.invoke('dashboards:param-values-set', localPath, username, id, { 'campaign:campaign': 'CAMP-9999' })
  await s.page.reload()
  await openDashboard('Campagnes')
  await expect(s.page.getByTestId('param-not-found')).toContainText('CAMP-9999')
  await expect(widget('Avancement par campagne').locator(`[aria-label*="${OPEN_TITLE}"]`).first()).toBeAttached({ timeout: 15_000 })
  await s.page.getByTestId('param-reset').click()
  await expect(s.page.getByTestId('param-not-found')).toHaveCount(0)
})

test('17 — dashboard sans paramètre : pas de barre', async () => {
  await openDashboard('Pilotage LL800')
  await expect(s.page.getByTestId('widget-card').first()).toBeVisible()
  await expect(s.page.getByTestId('param-bar')).toHaveCount(0)
})

test('10 / 19 / 23 — requête écrite à la main : texte, énumération, obligatoire', async () => {
  const { localPath } = s.project
  const query = await s.invoke<{ id: string }>('queries:create', localPath, username, {
    title: 'GH93 valeurs', scope: 'shared', createdBy: username,
    script: "export default (data, polenta) => [{ lot: polenta.params.lot || 'aucun', statut: polenta.params.statut || 'toutes', campagne: polenta.params.campaign }]\n",
    parameters: [
      { name: 'lot', kind: 'text', label: 'Lot' },
      { name: 'statut', kind: 'enum', label: 'Statut', values: [{ value: 'A', label: 'Alpha' }, { value: 'B' }] },
      { name: 'campaign', kind: 'campaign', label: 'Campagne', required: true },
    ],
  })
  const dashboard = await s.invoke<{ id: string }>('dashboards:create', localPath, username, { title: 'GH93 paramètres', scope: 'shared', createdBy: username })
  await s.invoke('dashboards:add-widget', localPath, username, dashboard.id, { title: 'Valeurs', queryId: query.id, size: 'lg', template: { id: 'table', params: {} } })

  await s.page.reload()
  await openDashboard('GH93 paramètres')
  const bar = s.page.getByTestId('param-bar')
  // Obligatoire sans valeur : le widget attend un choix ; pas d'option « Toutes ».
  await expect(widget('Valeurs').getByTestId('widget-param-missing')).toContainText('Choisir Campagne')
  await expect(bar.getByTestId('param-campaign').locator('option', { hasText: 'Toutes' })).toHaveCount(0)
  await bar.getByTestId('param-campaign').selectOption(open.id)
  await expect(widget('Valeurs')).toContainText(open.id, { timeout: 15_000 })
  await expect(widget('Valeurs')).toContainText('aucun')

  // Texte appliqué à la validation seulement, espaces retirés.
  const lot = bar.getByTestId('param-lot')
  await lot.fill('  L42 ')
  await expect(widget('Valeurs')).toContainText('aucun')
  await lot.press('Enter')
  await expect(widget('Valeurs')).toContainText('L42', { timeout: 15_000 })

  await bar.getByTestId('param-statut').selectOption('A')
  await expect(widget('Valeurs')).not.toContainText('toutes', { timeout: 15_000 })
  await expect(bar.getByTestId('param-statut').locator('option', { hasText: 'Alpha' })).toHaveCount(1)
  await s.shot('gh93-custom-params')
})

test('10 / 15 — vue Requêtes : déclaration éditable, barre locale (défauts, non mémorisée)', async () => {
  await s.openView('Suivi')
  await s.page.getByText('GH93 valeurs', { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
  const editor = s.page.getByTestId('param-decl-editor')
  await expect(editor.getByTestId('param-decl-row')).toHaveCount(3)
  // Campagne obligatoire, sans valeur à l'ouverture : erreur explicite, pas de résultat.
  await expect(s.page.getByTestId('script-error')).toContainText('obligatoire')
  const bar = s.page.getByTestId('param-bar')
  await bar.getByTestId('param-campaign').selectOption(open.id)
  await expect(s.page.getByTestId('script-error')).toHaveCount(0, { timeout: 15_000 })
  await expect(s.page.locator('table').filter({ hasText: open.id }).first()).toBeVisible()

  // Déclaration invalide : erreurs affichées, enregistrement impossible.
  await editor.getByTestId('param-decl-add').click()
  await editor.getByTestId('param-decl-row').last().getByLabel('Nom (polenta.params)').fill('1x')
  await expect(editor.getByTestId('param-decl-errors')).toContainText('nom invalide')
  await expect(bar.getByTestId('param-1x')).toHaveCount(0)
  await expect(bar.getByTestId('param-campaign')).toHaveValue(open.id)
  await expect(s.page.getByRole('button', { name: 'Sauvegarder', exact: true })).toBeDisabled()
  await s.shot('gh93-query-view')
})
