import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH77 sprint 2 — options d'historique de l'éditeur de type (onglet Structure) et renommage de
 * champ avec migration des objets. Scénarios C2, C3, R1 de specs/GH77-tests.md. Un type dédié
 * (préfixe GHH) et deux exigences sont créés par le test (IPC), pour ne dépendre d'aucun type de
 * la démo.
 */
const s = setupSession()

interface FieldLike { name: string; type: string; values?: string[]; trackHistory?: boolean }
interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: FieldLike[]; statuses?: Array<{ name: string }>; trackStatusHistory?: boolean }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface ReqLike { id: string; fields: Record<string, unknown> }
type History = Record<string, Array<{ value?: unknown; by?: string; implicit?: true }>>

const TYPE_NAME = 'gh77_hist'
const TYPE_LABEL = 'GH77 Historique'
const REF = `root::${TYPE_NAME}`
let reqA: string, reqB: string

const schema = () => s.invoke<SchemaLike>('schema:get', s.project.localPath)
const ourType = async () => (await schema()).nodes.find(n => n.name === 'root')!.objectTypes!.find(t => t.name === TYPE_NAME)!

async function openElementModal() {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/schema', { repoPath: s.project.localPath }))
  await s.page.waitForLoadState('networkidle')
  await s.page.getByRole('button', { name: new RegExp(TYPE_LABEL) }).first().click()
  await expect(s.page.getByText('Historiser le statut')).toBeVisible()
}

const fieldRow = (name: string) => s.page.locator('tr').filter({ has: s.page.locator(`input[value="${name}"]`) })

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const current = await schema()
  const root = current.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: TYPE_NAME, label: TYPE_LABEL, prefix: 'GHH', category: 'requirement',
    fields: [{ name: 'niveau', type: 'enum', values: ['bas', 'haut'] }],
    statuses: [{ name: 'draft' }, { name: 'review' }, { name: 'approved' }],
  }]
  await s.invoke('schema:save', localPath, current)
  reqA = (await s.invoke<ReqLike>('requirements:create', localPath, { objectTypeRef: REF, title: 'GH77 A', fields: { niveau: 'bas' } })).id
  reqB = (await s.invoke<ReqLike>('requirements:create', localPath, { objectTypeRef: REF, title: 'GH77 B', fields: { niveau: 'haut' } })).id
})

test('C3 — cocher « Hist. » sur un champ enum : le schéma le porte et une édition ajoute une entrée', async () => {
  await openElementModal()
  await fieldRow('niveau').getByRole('checkbox', { name: 'Historiser les changements de ce champ' }).check()
  await s.page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(s.page.getByText('Historiser le statut')).toBeHidden()
  expect((await ourType()).fields[0].trackHistory).toBe(true)

  await s.invoke('requirements:update', s.project.localPath, reqA, { fields: { niveau: 'haut' } })
  const history = await s.invoke<History>('history:get', s.project.localPath, 'requirement', reqA)
  expect(history.niveau?.at(-1)).toMatchObject({ value: 'haut', by: 'e2e' })
  expect(history.status?.[0]).toMatchObject({ value: 'draft', by: 'e2e' })
})

test('C2 — décocher « Historiser le statut » écrit trackStatusHistory: false', async () => {
  await openElementModal()
  await s.page.getByLabel('Historiser le statut (valeur, date et auteur à chaque changement)').uncheck()
  await s.page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(s.page.getByText('Historiser le statut')).toBeHidden()
  expect((await ourType()).trackStatusHistory).toBe(false)
})

test('R1 — renommer un champ suivi migre valeur et historique, compte rendu affiché', async () => {
  await openElementModal()
  await fieldRow('niveau').locator('input').first().fill('criticite')
  await s.page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(s.page.getByRole('status').filter({ hasText: 'migré' })).toContainText('2 objet(s) migré(s)')

  for (const id of [reqA, reqB]) {
    const req = await s.invoke<ReqLike>('requirements:get', s.project.localPath, id)
    expect(req.fields).toHaveProperty('criticite')
    expect(req.fields).not.toHaveProperty('niveau')
  }
  const history = await s.invoke<History>('history:get', s.project.localPath, 'requirement', reqA)
  expect(history.criticite?.map(e => e.value)).toEqual(['bas', 'haut'])
  expect(history.niveau).toBeUndefined()
})

async function goto(url: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await s.page.waitForLoadState('networkidle')
}

const historySection = () => s.page.getByTestId('history-section')

test('H1/H3 — section « Historique » d\'une exigence : repliée, statut puis champs, auteur', async () => {
  await goto(s.projectUrl(`/req/${reqA}`, { repoPath: s.project.localPath }))
  await expect(historySection()).toBeVisible()
  await expect(historySection().getByText('Statut')).toBeHidden()
  await historySection().getByRole('button', { name: 'Historique' }).click()
  await expect(historySection().getByText('Statut', { exact: true })).toBeVisible()
  await expect(historySection().getByText('niveau', { exact: true })).toBeHidden()
  await expect(historySection().getByText('criticite', { exact: true })).toBeVisible()
  await expect(historySection().getByText('e2e').first()).toBeVisible()
  await expect(historySection().getByText('début du suivi')).toBeVisible()
})

test('H5 — objet sans historique : « Aucun historique »', async () => {
  // Statut non suivi depuis C2, aucun champ suivi renseigné : rien n'est enregistré.
  const id = (await s.invoke<ReqLike>('requirements:create', s.project.localPath, { objectTypeRef: REF, title: 'GH77 C' })).id
  await goto(s.projectUrl(`/req/${id}`, { repoPath: s.project.localPath }))
  await historySection().getByRole('button', { name: 'Historique' }).click()
  await expect(historySection().getByText('Aucun historique')).toBeVisible()
})

test('H4 — section « Historique » d\'une campagne : statut planifié', async () => {
  const c = await s.invoke<{ id: string }>('campaigns:create', s.project.localPath, { title: 'GH77 campagne', testCaseIds: [] })
  await goto(s.projectUrl(`/campaign/${c.id}`, { repoPath: s.project.localPath }))
  await historySection().getByRole('button', { name: 'Historique' }).click()
  await expect(historySection().getByText('Planifiée')).toBeVisible()
})

test('B8 — reprise depuis git dans les préférences : confirmation, compte rendu, historique repris', async () => {
  await goto(s.projectUrl('/preferences', { repoPath: s.project.localPath }))
  const panel = s.page.getByTestId('history-backfill')
  await panel.getByRole('button', { name: 'Reconstruire depuis git' }).first().click()
  await panel.getByRole('button', { name: 'Oui' }).click()
  await expect(panel.getByRole('status').first()).toContainText('objet(s) complété(s)', { timeout: 90_000 })

  // Une exigence de la démo, commitée avant GH77, a maintenant des entrées `source: git`.
  const reqs = await s.invoke<Array<{ id: string; objectTypeRef: string }>>('requirements:list', s.project.localPath)
  const demo = reqs.find(r => r.objectTypeRef !== REF)!
  const history = await s.invoke<History>('history:get', s.project.localPath, 'requirement', demo.id)
  expect(history.status?.some(e => (e as { source?: string }).source === 'git')).toBe(true)
})
