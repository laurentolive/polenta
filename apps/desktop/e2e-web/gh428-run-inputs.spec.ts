import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { chooseTestedVersion } from './support/campaign'

/**
 * GH428 — champs d'exécution renseignés en campagne (specs/GH428-tests.md, E1–E6). Un type de test dédié
 * (préfixe GHI, statut approuvé d'emblée), une campagne et une entrée. Saisie dans la grille de la
 * campagne, exécution avec la valeur figée dans le run, retest avec une nouvelle valeur.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/, /status of 500/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[]; runFields?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string; runInputs?: Record<string, string> }> }
interface RunLike { id: string; result: string; fields?: Record<string, unknown> }

let campaign: Campaign
let entryId: string
let testCaseId: string

const criticiteCell = (id: string) => `campaign-entries-run:gh428Criticite-${id}`
const quantiteCell = (id: string) => `campaign-entries-run:gh428Quantite-${id}`

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

/** Saisit « criticité » dans la grille de la campagne (liste) et « quantité » (texte). */
async function setInGrid(p: Page, id: string, criticite: string, quantite: string) {
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}`, { repoPath: s.project.localPath }))
  const enumCell = p.getByTestId(criticiteCell(id))
  await enumCell.dblclick()
  await p.getByTestId(`${criticiteCell(id)}-editor`).selectOption(criticite)
  const textCell = p.getByTestId(quantiteCell(id))
  await textCell.dblclick()
  await textCell.locator('input').fill(quantite)
  await textCell.locator('input').press('Enter')
  await expect(p.getByTestId(`campaign-entries-row-${id}`)).toContainText(quantite.replace(',', '.'))
}

/** Ouvre « Exécuter » de la ligne, saisit le verdict de l'étape 1 et soumet le résultat. */
async function executeEntry(p: Page, id: string) {
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}`, { repoPath: s.project.localPath }))
  await p.getByTestId(`campaign-entries-row-${id}`).getByRole('button', { name: 'Exécuter' }).click()
  await p.waitForURL(url => url.pathname.includes('/execute/'))
  await chooseTestedVersion(s)
  await p.locator('select:not([data-testid^="tested-"]):visible').first().selectOption({ label: 'Réussi' })
  await p.getByRole('button', { name: 'Soumettre le résultat' }).click()
  await p.waitForURL(url => !url.pathname.includes('/execute/'))
}

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: 'gh428_essai', label: 'GH428 Essai', prefix: 'GHI', category: 'test', fields: [],
    statuses: [{ name: 'valide', isApproval: true }],
    runFields: [
      { name: 'gh428Criticite', label: 'Criticité GH428', type: 'enum', values: ['critique', 'regression'], campaignInput: true },
      { name: 'gh428Quantite', label: 'Quantité GH428', type: 'number', campaignInput: true },
      { name: 'gh428Rapport', label: 'Rapport GH428', type: 'text' },
    ],
  } as TypeLike]
  await s.invoke('schema:save', localPath, schema)
  const tc = await s.invoke<{ id: string }>('tests:create', localPath, {
    title: 'GH428 T', objectTypeRef: 'root::gh428_essai', fields: {},
    steps: [{ order: 1, action: 'Mesurer', expectedResult: '12 V', notes: '' }],
  }, workspaceDir)
  testCaseId = tc.id
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH428 e2e', testCaseIds: [tc.id] }, workspaceDir)
  entryId = campaign.runs[0]!.entryId
})

test('GH428-1 — grille de campagne : colonnes des champs d\'exécution, saisie en campagne', async () => {
  const p = s.page
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}`, { repoPath: s.project.localPath }))
  await expect(p.getByTestId('campaign-entries')).toContainText('Criticité GH428')
  await expect(p.getByTestId('campaign-entries')).toContainText('Quantité GH428')
  await setInGrid(p, entryId, 'critique', '12,5')
  const saved = await s.invoke<Campaign>('campaigns:get', s.project.localPath, campaign.id)
  expect(saved.runs[0]!.runInputs).toEqual({ gh428Criticite: 'critique', gh428Quantite: '12.5' })
  await s.shot('gh428-grid')
})

test('GH428-2 — page d\'exécution : valeurs de campagne prérenseignées en lecture seule, figées dans le run', async () => {
  const p = s.page
  await executeEntry(p, entryId)
  const runs = await s.invoke<RunLike[]>('tests:runs', s.project.localPath, testCaseId)
  expect(runs).toHaveLength(1)
  expect(runs[0]!.fields).toEqual({ gh428Criticite: 'critique', gh428Quantite: 12.5 })
})

test('GH428-3 — retest après changement : le nouveau run porte la nouvelle valeur, l\'ancien reste figé', async () => {
  const p = s.page
  const [first] = await s.invoke<RunLike[]>('tests:runs', s.project.localPath, testCaseId)
  await setInGrid(p, entryId, 'regression', '3')
  await executeEntry(p, entryId)
  const runs = await s.invoke<RunLike[]>('tests:runs', s.project.localPath, testCaseId)
  expect(runs).toHaveLength(2)
  const again = runs.find(r => r.id !== first!.id)!
  expect(again.fields).toEqual({ gh428Criticite: 'regression', gh428Quantite: 3 })
  const unchanged = await s.invoke<RunLike[]>('tests:runs', s.project.localPath, testCaseId)
  expect(unchanged.find(r => r.id === first!.id)!.fields).toEqual({ gh428Criticite: 'critique', gh428Quantite: 12.5 })
  // E6 — la grille montre la valeur saisie et, à côté, la valeur du dernier run.
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}`, { repoPath: s.project.localPath }))
  await expect(p.getByTestId(`campaign-entries-row-${entryId}`)).toContainText(/dernier run : critique/)
})
