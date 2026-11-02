import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH243 — retrait du changeset (specs/GH243-tests.md) : réouverture par le statut dans la vue
 * document (version + 1, plus de bouton « Rouvrir »), plus d'entrée Changesets, écrans déplacés
 * (panneau Version, Constellation dans le panneau Exigences), plus de baseline à la création d'une
 * campagne.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }

const TYPE_LABEL = 'GH243 Req'
let reqId = ''

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}
const getReq = (id: string) => s.invoke<{ status: string; version?: number }>('requirements:get', s.project.localPath, id)

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []),
    { name: 'gh243_req', label: TYPE_LABEL, prefix: 'GHR', category: 'requirement', fields: [],
      statuses: [{ name: 'draft', label: 'Brouillon' }, { name: 'approved', label: 'Approuvé', isApproval: true }] },
  ]
  await s.invoke('schema:save', localPath, schema)
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: 'root::gh243_req', title: 'GH243 verrou', status: 'approved' })).id
})

test('GH243-E1 — vue document, exigence approuvée : pas de « Rouvrir », statut → brouillon : version + 1', async () => {
  const p = s.page
  await s.openView('Exigences')
  const combo = p.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(TYPE_LABEL)
  await combo.press('Enter')
  await p.getByTitle('Vue document').click()
  await p.waitForLoadState('networkidle')
  const header = p.locator('span.font-mono', { hasText: new RegExp(`^${reqId}$`) }).locator('xpath=..')
  await expect(header).toBeVisible()
  await expect(p.getByTitle('Rouvrir en brouillon')).toHaveCount(0)
  const v0 = (await getReq(reqId)).version ?? 1
  await header.getByTitle('Changer le statut').selectOption('draft')
  await expect.poll(async () => (await getReq(reqId)).status).toBe('draft')
  expect((await getReq(reqId)).version).toBe(v0 + 1)
})

test('GH243-E4 — plus d’entrée Changesets ; modifications locales dans le panneau Version ; Constellation dans Exigences', async () => {
  const p = s.page
  await expect(p.getByRole('button', { name: 'Changesets', exact: true })).toHaveCount(0)
  // E1 laisse des modifications non publiées : l'entrée « Modifications locales » est affichée.
  await s.openView('Version')
  const local = p.getByTestId('version-local-entry')
  await expect(local).toBeVisible()
  await local.click()
  await expect(p).toHaveURL(/\/local-impact/)
  await expect(p.locator('main, body').getByText('GH243 verrou').first()).toBeVisible()

  await s.openView('Exigences')
  await p.getByRole('button', { name: 'Constellation des exigences' }).click()
  await expect(p.getByRole('img', { name: /Exigences en anneaux/ })).toBeVisible()
})

test('GH243-E5 — nouvelle campagne : plus de champ baseline', async () => {
  const p = s.page
  await navigate(p, s.projectUrl('/campaign/new', { repoPath: s.project.localPath }))
  await expect(p.getByPlaceholder(/Campagne validation/)).toBeVisible()
  await expect(p.locator('input[list="baseline-tags"]')).toHaveCount(0)
  await expect(p.getByText(/Baseline/)).toHaveCount(0)
})
