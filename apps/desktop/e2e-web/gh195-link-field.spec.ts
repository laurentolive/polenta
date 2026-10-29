import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH195 — champ de type `link` {libellé | URL} et obligation conditionnelle `requiredWhen`
 * (specs/GH195-tests.md, scénarios 11 à 13 et 24). Un type dédié (préfixe GHL) est créé par le test.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/, /status of 500/, /URL refusée|obligatoire quand/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: Array<{ name: string; label?: string; isApproval?: boolean }> }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface ReqLike { id: string; status: string; fields: Record<string, unknown> }

const TYPE_NAME = 'gh195_liens'
const TYPE_LABEL = 'GH195 Liens'
const REF = `root::${TYPE_NAME}`
let reqId = ''

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: TYPE_NAME, label: TYPE_LABEL, prefix: 'GHL', category: 'requirement',
    fields: [
      { name: 'reports', label: 'Rapports', type: 'link', multiple: true },
      { name: 'datasheet', label: 'Fiche', type: 'link' },
      { name: 'rationale', label: 'Justification', type: 'text', requiredWhen: { status: ['valide'] } },
    ],
    statuses: [{ name: 'brouillon', label: 'Brouillon' }, { name: 'valide', label: 'Validé', isApproval: true }],
  }]
  await s.invoke('schema:save', localPath, schema)
  reqId = (await s.invoke<ReqLike>('requirements:create', localPath, {
    objectTypeRef: REF, title: 'GH195 A', fields: { reports: 'RE-118 | https://ged.example.com/RE-118' },
  })).id
})

const row = () => s.page.locator('tr').filter({ hasText: reqId }).first()

async function openTable() {
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(TYPE_LABEL)
  await combo.press('Enter')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
}

test('GH195-1 — écriture : forme texte convertie en objets, URL invalide refusée', async () => {
  const { localPath } = s.project
  const req = await s.invoke<ReqLike>('requirements:get', localPath, reqId)
  expect(req.fields.reports).toEqual([{ label: 'RE-118', url: 'https://ged.example.com/RE-118' }])
  await expect(s.invoke('requirements:update', localPath, reqId, { fields: { datasheet: 'C:\\docs\\a.pdf' } }))
    .rejects.toThrow(/URL refusée/)
})

test('GH195-2 — vue tableau : lien cliquable, édition par le popover', async () => {
  await openTable()
  const anchor = row().locator('a', { hasText: 'RE-118' })
  await expect(anchor).toHaveAttribute('href', 'https://ged.example.com/RE-118')
  await expect(anchor).toHaveAttribute('target', '_blank')

  // Double-clic hors du lien : ouvre le popover d'édition.
  const cell = row().locator('td').filter({ has: s.page.locator('a', { hasText: 'RE-118' }) })
  await cell.dblclick({ position: { x: 4, y: 4 } })
  const popover = s.page.locator('[data-link-field-popover]')
  await expect(popover).toBeVisible()
  const urls = popover.getByLabel('URL')
  await expect(urls.first()).toHaveValue('https://ged.example.com/RE-118')

  await popover.getByText('+ Ajouter un lien').click()
  await urls.nth(1).fill('C:\\docs\\a.pdf')
  await expect(popover.getByText(/URL non prise en charge/)).toBeVisible()
  await urls.nth(1).fill('https://ged.example.com/RE-119')
  await popover.getByLabel('Libellé').nth(1).fill('RE-119')
  await s.shot('gh195-popover')
  await popover.getByRole('button', { name: 'OK' }).click()

  await expect(row().locator('a', { hasText: 'RE-119' })).toBeVisible()
  // La vue tableau enregistre en différé : attendre l'écriture.
  await expect.poll(async () => (await s.invoke<ReqLike>('requirements:get', s.project.localPath, reqId)).fields.reports).toEqual([
    { label: 'RE-118', url: 'https://ged.example.com/RE-118' },
    { label: 'RE-119', url: 'https://ged.example.com/RE-119' },
  ])
})

test('GH195-3 — client web : un chemin réseau propose « Copier »', async () => {
  await s.invoke('requirements:update', s.project.localPath, reqId, { fields: { datasheet: 'Photos | \\\\srv-labo\\essais\\photos' } })
  await openTable()
  await expect(row().getByRole('button', { name: 'Copier' })).toBeVisible()
  await expect(row().locator('a', { hasText: 'Photos' })).toHaveCount(0)
})

test('GH195-4 — requiredWhen : passage au statut refusé sans le champ, accepté avec', async () => {
  const { localPath, workspaceDir } = s.project
  await expect(s.invoke('requirements:transition', localPath, reqId, { toStatus: 'valide' }, workspaceDir))
    .rejects.toThrow(/« Justification » est obligatoire quand Statut = Validé/)
  await s.invoke('requirements:update', localPath, reqId, { fields: { rationale: 'Retour terrain' } })
  const r = await s.invoke<ReqLike>('requirements:transition', localPath, reqId, { toStatus: 'valide' }, workspaceDir)
  expect(r.status).toBe('valide')
})
