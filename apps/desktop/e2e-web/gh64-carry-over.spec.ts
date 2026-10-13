import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { recordResult } from './support/campaign'

/**
 * GH64 — report d'entrées d'une campagne à l'autre depuis le sélecteur de tests (onglet « Depuis
 * une campagne »). Scénarios U1–U5 de specs/GH64-tests.md, sur le projet de démonstration : les
 * campagnes source et cible sont créées par le test (IPC), le report se fait par l'interface.
 */
const s = setupSession()

interface Run { entryId: string; testCaseId: string; status: string; carriedFrom?: { campaignId: string; entryId: string } }
interface Campaign { id: string; title: string; runs: Run[]; createdAt: string }
interface Preview { testCaseId: string; manual: string[]; requirements?: unknown[] }
interface SchemaLike { nodes: Array<{ objectTypes?: Array<{ category: string; statuses?: Array<{ name: string; isApproval?: boolean }> }> }> }

let source: Campaign
let target: Campaign
/** Tests de la source : A (PASS), B (BLOCKED), C (pending) — approuvés, sans paramètre. */
let A: string, B: string, C: string

const repoSearch = () => ({ repoPath: s.project.localPath })
const row = (p: Page, entry: string) => p.locator(`tr[data-entry="${entry}"]`)
const rowBox = (p: Page, entry: string) => row(p, entry).getByRole('checkbox')

/** Navigation interne (routeur), sans recharger l'application — un chargement direct de l'URL
 *  rouvre la page d'accueil du projet. */
async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

async function openCarryTab(p: Page, sourceId: string) {
  await p.getByRole('tab', { name: 'Depuis une campagne' }).click()
  await p.getByTestId('carry-sources').getByRole('checkbox', { name: sourceId }).check()
}

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const approval = new Set(schema.nodes.flatMap(n => (n.objectTypes ?? [])
    .filter(t => t.category === 'test')
    .flatMap(t => (t.statuses ?? []).filter(st => st.isApproval).map(st => st.name))))
  if (approval.size === 0) approval.add('approved')
  const tests = await s.invoke<Array<{ id: string; status: string }>>('tests:list', localPath)
  const approved = tests.filter(t => approval.has(t.status)).map(t => t.id)
  const previews = await s.invoke<Preview[]>('campaigns:preview-params', localPath, {}, approved, workspaceDir)
  const simple = previews.filter(p => p.manual.length === 0 && !p.requirements?.length).map(p => p.testCaseId)
  test.skip(simple.length < 3, 'la démo doit avoir 3 tests approuvés sans paramètre')
  ;[A, B, C] = simple

  source = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH64 source', testCaseIds: [A, B, C] }, workspaceDir)
  await recordResult(s, source.id, `${A}-1`, 'PASS')
  await recordResult(s, source.id, `${B}-1`, 'BLOCKED')
  source = await s.invoke<Campaign>('campaigns:close', localPath, source.id, 'completed')
  target = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH64 cible', testCaseIds: [] }, workspaceDir)
})

test('U1–U4 — ajout depuis une campagne clôturée : filtre, coches conservées, instances reportées', async () => {
  const p = s.page
  await navigate(p, s.projectUrl(`/campaign/${target.id}`, repoSearch()))
  await p.getByText('Ajouter des tests').click()

  // U1 — deux onglets, l'onglet Tests par défaut.
  await expect(p.getByRole('tab', { name: 'Tests', exact: true })).toHaveAttribute('aria-selected', 'true')
  await p.getByRole('tab', { name: 'Depuis une campagne' }).click()

  // U2 — la cible n'est pas proposée, la source clôturée l'est.
  const sources = p.getByTestId('carry-sources')
  await expect(sources.getByRole('checkbox', { name: target.id })).toHaveCount(0)
  await sources.getByRole('checkbox', { name: source.id }).check()

  // U3 — filtre par défaut : BLOCKED et pending cochés, PASS absent.
  await expect(rowBox(p, `${source.id}/${B}-1`)).toBeChecked()
  await expect(rowBox(p, `${source.id}/${C}-1`)).toBeChecked()
  await expect(row(p, `${source.id}/${A}-1`)).toHaveCount(0)
  await rowBox(p, `${source.id}/${C}-1`).uncheck()
  await p.getByRole('checkbox', { name: 'Passé' }).check()
  await expect(rowBox(p, `${source.id}/${A}-1`)).toBeChecked()
  await expect(rowBox(p, `${source.id}/${C}-1`)).not.toBeChecked()
  await s.shot('gh64-u3-onglet-campagne')

  // U4 — validation : deux instances reportées, sans étape 2 (tests sans paramètre).
  await p.getByRole('button', { name: 'Ajouter (2)' }).click()
  await expect(p.getByRole('tab', { name: 'Depuis une campagne' })).toHaveCount(0)
  const after = await s.invoke<Campaign>('campaigns:get', s.project.localPath, target.id)
  expect(after.runs.map(r => [r.testCaseId, r.status, r.carriedFrom]).sort()).toEqual([
    [A, 'pending', { campaignId: source.id, entryId: `${A}-1` }],
    [B, 'pending', { campaignId: source.id, entryId: `${B}-1` }],
  ].sort())
  await expect(p.getByRole('button', { name: `↩ ${source.id}` })).toHaveCount(2)

  // Source inchangée.
  const src = await s.invoke<Campaign>('campaigns:get', s.project.localPath, source.id)
  expect(src.runs.map(r => r.status)).toEqual(source.runs.map(r => r.status))

  // Rouverte : les entrées reportées sont « Déjà présent », la restante est proposée.
  await p.getByText('Ajouter des tests').click()
  await openCarryTab(p, source.id)
  await expect(rowBox(p, `${source.id}/${B}-1`)).toBeDisabled()
  await expect(row(p, `${source.id}/${B}-1`)).toContainText('Déjà présent')
  await expect(rowBox(p, `${source.id}/${C}-1`)).toBeChecked()
  await p.getByRole('button', { name: 'Annuler' }).click()
  // Confirmation d'abandon de la sélection (la page a aussi un bouton « Abandonner » la campagne).
  await p.locator('button.btn-danger', { hasText: 'Abandonner' }).click()

  // Le lien ↩ ouvre la campagne source.
  await p.getByRole('button', { name: `↩ ${source.id}` }).first().click()
  await expect(p).toHaveURL(new RegExp(`/campaign/${source.id}`))
})

test('U5 — création à partir des restes d\'une campagne', async () => {
  const p = s.page
  await navigate(p, s.projectUrl('/campaign/new', repoSearch()))
  await p.getByPlaceholder('Ex : Campagne validation sprint 11').fill('GH64 suite')
  await p.getByRole('button', { name: 'Sélectionner des tests…' }).click()
  await openCarryTab(p, source.id)
  await expect(rowBox(p, `${source.id}/${B}-1`)).toBeChecked()
  await expect(rowBox(p, `${source.id}/${C}-1`)).toBeChecked()
  await p.getByRole('button', { name: 'Valider la sélection (2)' }).click()

  // Récapitulatif du formulaire : deux entrées reportées.
  await expect(p.getByText(`↩ ${source.id}`)).toHaveCount(2)
  await p.getByRole('button', { name: 'Créer la campagne' }).click()
  await p.waitForURL(/\/campaign\/CAMP-/)
  const id = /\/campaign\/(CAMP-[^/?]+)/.exec(p.url())![1]
  const created = await s.invoke<Campaign>('campaigns:get', s.project.localPath, id)
  expect(created.runs.map(r => [r.testCaseId, r.carriedFrom?.campaignId]).sort()).toEqual([[B, source.id], [C, source.id]].sort())
  await s.shot('gh64-u5-creation')
})
