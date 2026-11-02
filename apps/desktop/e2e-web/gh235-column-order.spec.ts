import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH235 — Vue tableau : cocher / décocher une colonne dans ⚙️ ne remet pas les autres colonnes
 * dans l'ordre canonique (ordre choisi par glisser-déposer conservé). Le point de départ — un ordre
 * non canonique — est posé par IPC dans la préférence du type, comme après un glisser-déposer.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TestCaseLike { id: string; objectTypeRef: string }
interface SchemaNode { objectTypes?: Array<{ label: string; prefix: string }>; children?: SchemaNode[] }
interface Pref { excel?: string[] }

let username = ''
let typeRef = ''
let typeLabel = ''

const getPref = () => s.invoke<Pref | null>('pref:get-field-visibility', s.project.localPath, username, typeRef)

test.beforeAll(async () => {
  const { localPath } = s.project
  username = await s.invoke<string>('auth:project-username', localPath)
  const tests = await s.invoke<TestCaseLike[]>('tests:list', localPath)
  typeRef = tests[0].objectTypeRef
  const schema = await s.invoke<{ nodes: SchemaNode[] }>('schema:get', localPath)
  const types = (nodes: SchemaNode[]): Array<{ label: string; prefix: string }> => nodes.flatMap(n => [...(n.objectTypes ?? []), ...types(n.children ?? [])])
  typeLabel = types(schema.nodes).find(t => t.prefix === tests[0].id.replace(/-\d+$/, ''))!.label
  await s.invoke('pref:set-field-visibility', localPath, username, typeRef, { excel: ['id', 'status', 'name'] })
})

async function openTable() {
  await s.openView('Tests')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(typeLabel)
  await combo.press('Enter')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
}

async function toggle(field: string) {
  await s.page.getByTitle('Configurer les colonnes').click()
  const modal = s.page.locator('.fixed.inset-0.z-50')
  await modal.getByTestId(`field-config-field-${field}`).click()
  await modal.click({ position: { x: 5, y: 5 } })
}

/** Libellés des en-têtes de la Vue tableau, dans l'ordre affiché. */
async function headerOrder(labels: string[]) {
  const texts = (await s.page.locator('th').allTextContents()).map(t => t.trim())
  return labels.map(l => texts.findIndex(t => t.startsWith(l)))
}

test('cocher une colonne garde l\'ordre réorganisé et la place après son prédécesseur canonique', async () => {
  await openTable()
  await expect(s.page.locator('th').filter({ hasText: 'Statut' })).toBeVisible()
  await toggle('version')
  await expect(s.page.locator('th').filter({ hasText: 'Version' })).toBeVisible()
  const [id, status, version, label] = await headerOrder(['ID', 'Statut', 'Version', 'Label'])
  expect(id).toBeGreaterThanOrEqual(0)
  expect(id).toBeLessThan(status)
  expect(status).toBeLessThan(version)
  expect(version).toBeLessThan(label)
  await expect.poll(async () => (await getPref())?.excel).toEqual(['id', 'status', 'version', 'name'])
})

test('décocher une colonne garde l\'ordre réorganisé des autres', async () => {
  await openTable()
  await toggle('status')
  await expect(s.page.locator('th').filter({ hasText: 'Statut' })).toHaveCount(0)
  await expect.poll(async () => (await getPref())?.excel).toEqual(['id', 'version', 'name'])
  const [id, version, label] = await headerOrder(['ID', 'Version', 'Label'])
  expect(id).toBeGreaterThanOrEqual(0)
  expect(id).toBeLessThan(version)
  expect(version).toBeLessThan(label)
})
