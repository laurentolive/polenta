import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH67 — partage d'un dashboard privé avec ses requêtes privées, et portée d'une requête seule
 * depuis `/query` et le panneau latéral (specs/GH67-tests.md N4–N8, L1, L5, L6, L8–L10).
 */
const s = setupSession()

interface Query { id: string; title: string; scope: 'private' | 'shared' }
interface Dash { id: string; title: string; scope: 'private' | 'shared'; widgets: Array<{ queryId: string }> }

let username: string
const SCRIPT = 'export default (data) => data.requirements.map((r) => ({ id: r.id, title: r.title }))\n'

test.beforeAll(async () => {
  username = await s.invoke<string>('auth:project-username', s.project.localPath)
})

const repo = () => s.project.localPath
const listQueries = () => s.invoke<Query[]>('queries:list', repo(), username)
const listDashboards = () => s.invoke<Dash[]>('dashboards:list', repo(), username)
const createQuery = (title: string, scope: 'private' | 'shared', extra: Record<string, unknown> = {}) =>
  s.invoke<Query>('queries:create', repo(), username, { title, scope, createdBy: username, script: SCRIPT, ...extra })
async function createDashboard(title: string, scope: 'private' | 'shared', queryIds: string[]) {
  const d = await s.invoke<Dash>('dashboards:create', repo(), username, { title, scope, createdBy: username })
  for (const [i, queryId] of queryIds.entries()) {
    await s.invoke('dashboards:add-widget', repo(), username, d.id, { title: `${title} W${i + 1}`, queryId, size: 'md', template: { id: 'table', params: {} } })
  }
  return d
}

async function openSidebarItem(title: string) {
  await s.openView('Suivi')
  await s.page.getByText(title, { exact: true }).last().click()
  await s.page.waitForLoadState('networkidle')
}
const sidebarRow = (title: string) => s.page.locator('div.group').filter({ has: s.page.getByText(title, { exact: true }) })
const shareModal = () => s.page.getByTestId('dashboard-share-modal')
const queryModal = () => s.page.getByTestId('query-scope-modal')
const headerScope = (label: 'Privé' | 'Partagé') => s.page.getByRole('button', { name: label, exact: true })
const queryScope = (label: 'Privée' | 'Partagée') => s.page.getByTestId('query-scope-toggle').getByRole('button', { name: label, exact: true })

test('L1 / N5 — seed « Campagnes » privé : confirmation listant ses requêtes ; Annuler, puis Partager', async () => {
  await openSidebarItem('Campagnes')
  const before = (await listDashboards()).find((d) => d.title === 'Campagnes')!
  expect(before.scope).toBe('private')
  const privateIds = [...new Set(before.widgets.map((w) => w.queryId))]

  await headerScope('Partagé').click()
  await expect(shareModal()).toBeVisible()
  await expect(shareModal().getByTestId('share-query')).toHaveCount(privateIds.length)
  await s.shot('gh67-share-modal')
  await shareModal().getByRole('button', { name: 'Annuler' }).click()
  await expect(shareModal()).toHaveCount(0)
  expect((await listDashboards()).find((d) => d.id === before.id)?.scope).toBe('private')

  await headerScope('Partagé').click()
  await shareModal().getByTestId('scope-confirm').click()
  await expect(shareModal()).toHaveCount(0)
  await expect(s.page).toHaveURL(/dashboardId=DASHBOARD-\d{4}/)
  const after = (await listDashboards()).find((d) => d.title === 'Campagnes' && d.scope === 'shared')!
  expect(after.widgets.every((w) => /^QUERY-\d{4}$/.test(w.queryId))).toBe(true)
  for (const id of new Set(after.widgets.map((w) => w.queryId))) {
    expect(fs.existsSync(path.join(repo(), 'queries', id, 'query.yaml'))).toBe(true)
  }
  await expect(s.page.getByTestId('widget-card')).toHaveCount(after.widgets.length)
  await expect(s.page.getByTestId('script-error')).toHaveCount(0)
})

test('N4 — dashboard privé sans requête privée : partagé directement', async () => {
  const q = await createQuery('GH67 partagée N4', 'shared')
  await createDashboard('GH67 N4', 'private', [q.id])
  await openSidebarItem('GH67 N4')
  await headerScope('Partagé').click()
  await expect(s.page).toHaveURL(/dashboardId=DASHBOARD-\d{4}/)
  await expect(shareModal()).toHaveCount(0)
})

test('L5 — requête privée aux paramètres invalides : partage bloqué, pas de bouton de confirmation', async () => {
  const q = await createQuery('GH67 invalide', 'private')
  await createDashboard('GH67 L5', 'private', [q.id])
  const prefFile = path.join(repo(), `.${username}.pref`)
  const pref = JSON.parse(fs.readFileSync(prefFile, 'utf8')) as { savedQueries: Array<Record<string, unknown>> }
  pref.savedQueries = pref.savedQueries.map((x) => (x.id === q.id ? { ...x, parameters: [{ name: 'x', kind: 'inconnu' }] } : x))
  fs.writeFileSync(prefFile, JSON.stringify(pref, null, 2))

  await openSidebarItem('GH67 L5')
  await headerScope('Partagé').click()
  await expect(shareModal().getByTestId('scope-blocker')).toBeVisible()
  await expect(shareModal().getByTestId('scope-confirm')).toHaveCount(0)
  await s.page.keyboard.press('Escape')
  expect((await listDashboards()).find((d) => d.title === 'GH67 L5')?.scope).toBe('private')
})

test('L10 / N6 — /query : Annuler ne change rien ; Partagée → nouvel id, éditeur conservé', async () => {
  const q = await createQuery('GH67 requête N6', 'private')
  await openSidebarItem('GH67 requête N6')
  await expect(queryScope('Privée')).toHaveAttribute('aria-pressed', 'true')

  await queryScope('Partagée').click()
  await expect(queryModal()).toBeVisible()
  await queryModal().getByRole('button', { name: 'Annuler' }).click()
  expect((await listQueries()).find((x) => x.id === q.id)?.scope).toBe('private')

  // Modification non enregistrée de l'éditeur.
  const content = s.page.locator('.cm-content').first()
  await content.click()
  await s.page.keyboard.press('Control+End')
  await s.page.keyboard.type('// GH67 non enregistré')

  await queryScope('Partagée').click()
  await queryModal().getByTestId('scope-confirm').click()
  await expect(s.page).toHaveURL(/queryId=QUERY-\d{4}/)
  await expect(queryScope('Partagée')).toHaveAttribute('aria-pressed', 'true')
  await expect(content).toContainText('// GH67 non enregistré')
  const shared = (await listQueries()).find((x) => x.title === 'GH67 requête N6')!
  expect(shared.scope).toBe('shared')
  expect(fs.existsSync(path.join(repo(), 'queries', shared.id, 'script.js'))).toBe(true)
})

test('L6 / N7 — panneau latéral : bouton de portée, titre déjà pris signalé, même position', async () => {
  await createQuery('GH67 homonyme', 'shared')
  await createQuery('GH67 homonyme', 'private')
  await s.openView('Suivi')
  const titles = async () => s.page.locator('div.group span.truncate').allTextContents()
  const row = sidebarRow('GH67 homonyme').filter({ has: s.page.locator('[title="Privé"]') })
  await expect(row).toHaveCount(1)
  const position = (await titles()).lastIndexOf('GH67 homonyme')

  await row.hover()
  await row.getByTestId('scope-toggle').click()
  await expect(queryModal().getByTestId('scope-title-taken')).toBeVisible()
  await queryModal().getByTestId('scope-confirm').click()
  await expect(queryModal()).toHaveCount(0)
  await expect(sidebarRow('GH67 homonyme').filter({ has: s.page.locator('[title="Privé"]') })).toHaveCount(0)
  expect((await titles()).lastIndexOf('GH67 homonyme')).toBe(position)
  expect((await listQueries()).filter((x) => x.title === 'GH67 homonyme' && x.scope === 'shared')).toHaveLength(2)
})

test('L8 — requête partagée utilisée par un widget : rétrogradation bloquée, widget listé', async () => {
  const q = await createQuery('GH67 utilisée', 'shared')
  await createDashboard('GH67 L8', 'shared', [q.id])
  await openSidebarItem('GH67 utilisée')
  await queryScope('Privée').click()
  await expect(queryModal().getByTestId('scope-blocker')).toContainText('GH67 L8 W1')
  await expect(queryModal().getByTestId('scope-confirm')).toHaveCount(0)
  await s.page.keyboard.press('Escape')
})

test('N8 — requête partagée avec colonne : retrait annoncé, puis requête privée sans colonne', async () => {
  const q = await createQuery('GH67 colonne', 'shared', {
    column: { label: 'GH67 score', appliesTo: { categories: ['requirement'], objectTypes: [] }, type: 'number' },
  })
  await openSidebarItem('GH67 colonne')
  await queryScope('Privée').click()
  await expect(queryModal().getByTestId('scope-column-removed')).toContainText('GH67 score')
  await queryModal().getByTestId('scope-confirm').click()
  await expect(s.page).toHaveURL(/queryId=local-/)
  expect(fs.existsSync(path.join(repo(), 'queries', q.id))).toBe(false)
  const moved = (await listQueries()).find((x) => x.title === 'GH67 colonne') as Query & { column: unknown }
  expect(moved.scope).toBe('private')
  expect(moved.column).toBeNull()
})

test('L9 — requête non enregistrée : pas de sélecteur de portée', async () => {
  await s.openView('Suivi')
  await s.page.getByTitle('Ajouter une requête', { exact: true }).click()
  await expect(s.page).toHaveURL(/\/query/)
  await expect(s.page.getByRole('button', { name: 'Exécuter' })).toBeVisible()
  await expect(s.page.getByTestId('query-scope-toggle')).toHaveCount(0)
})

test('N7b — requête ouverte dans /query, portée changée depuis le panneau : URL suivie, éditeur conservé', async () => {
  await createQuery('GH67 panneau ouverte', 'private')
  await openSidebarItem('GH67 panneau ouverte')
  const content = s.page.locator('.cm-content').first()
  await content.click()
  await s.page.keyboard.press('Control+End')
  await s.page.keyboard.type('// GH67 panneau')
  const row = sidebarRow('GH67 panneau ouverte')
  await row.hover()
  await row.getByTestId('scope-toggle').click()
  // Aperçu chargé, puis Entrée = confirmer (le bouton du panneau n'a pas gardé le focus).
  await expect(queryModal().getByTestId('scope-confirm')).toBeVisible()
  await s.page.keyboard.press('Enter')
  await expect(s.page).toHaveURL(/queryId=QUERY-\d{4}/)
  await expect(queryScope('Partagée')).toHaveAttribute('aria-pressed', 'true')
  await expect(content).toContainText('// GH67 panneau')
})
