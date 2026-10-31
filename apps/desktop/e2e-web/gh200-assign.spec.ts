import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH200 — rattachement par élément (specs/GH200-tests.md) : verrou de l'approuvé, assignation à la
 * réouverture / au passage terminal (dialogue, Annuler, choix, assignation automatique), préférence.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }>; preferences?: Record<string, unknown> }
interface ChangeLike { id: string; toModify: Array<{ id: string; state: string; base?: { sha: string | null; version: number } }> }

const TYPE = 'root::gh200_req'
let changeA = ''
let changeB = ''

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}
const getChange = (id: string) => s.invoke<ChangeLike>('changesets:get', s.project.localPath, id)
const getReq = (id: string) => s.invoke<{ status: string; title: string }>('requirements:get', s.project.localPath, id)
const approvedReq = async (title: string) =>
  (await s.invoke<{ id: string }>('requirements:create', s.project.localPath, { objectTypeRef: TYPE, title, status: 'approved' })).id

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []),
    { name: 'gh200_cs', label: 'GH200 CS', prefix: 'GHC', category: 'changeset', fields: [],
      statuses: [{ name: 'ouvert', label: 'Ouvert' }, { name: 'clos', label: 'Clos', isTerminal: true }] },
    { name: 'gh200_req', label: 'GH200 Req', prefix: 'GHQ', category: 'requirement', fields: [],
      statuses: [{ name: 'draft', label: 'Brouillon' }, { name: 'approved', label: 'Approuvé', isApproval: true },
        { name: 'obsolete', label: 'Obsolète', isTerminal: true }] },
  ]
  await s.invoke('schema:save', localPath, schema)
  changeA = (await s.invoke<{ id: string }>('changesets:create', localPath, { objectTypeRef: 'root::gh200_cs', title: 'GH200 A', component: 'root' })).id
  changeB = (await s.invoke<{ id: string }>('changesets:create', localPath, { objectTypeRef: 'root::gh200_cs', title: 'GH200 B', component: 'root' })).id
})

test('GH200-A1 — exigence approuvée : contenu verrouillé (bandeau, titre en lecture seule), refus côté main', async () => {
  const p = s.page
  const id = await approvedReq('GH200 verrou')
  await navigate(p, s.projectUrl(`/req/${id}`, { repoPath: s.project.localPath }))
  await expect(p.getByTestId('approved-lock-banner')).toBeVisible()
  await expect(p.locator('input.input-field').first()).toHaveAttribute('readonly', '')
  await expect(s.invoke('requirements:update', s.project.localPath, id, { title: 'X' })).rejects.toThrow(/approuvé/)
})

test('GH200-A4/A10 — passage terminal avec deux changesets ouverts : dialogue, Annuler puis choix', async () => {
  const p = s.page
  const id = await approvedReq('GH200 obsolète')
  await navigate(p, s.projectUrl(`/req/${id}`, { repoPath: s.project.localPath }))
  const next = p.getByRole('button', { name: /Obsolète/ })
  await next.click()
  const dialog = p.getByTestId('assign-change-dialog')
  await expect(dialog).toBeVisible()
  await p.getByTestId('assign-change-cancel').click()
  await expect(dialog).toHaveCount(0)
  expect((await getReq(id)).status).toBe('approved')

  await next.click()
  await p.getByTestId(`assign-change-${changeB}`).click()
  await expect.poll(async () => (await getReq(id)).status).toBe('obsolete')
  // L'assignation suit l'écriture du statut dans le même appel.
  await expect.poll(async () => (await getChange(changeB)).toModify.find(t => t.id === id)?.base?.version).toBe(1)
})

test('GH200-A3/A6 — un seul changeset ouvert : assignation automatique signalée ; déjà assigné : aucune question', async () => {
  const p = s.page
  const { localPath } = s.project
  // Créée avec deux changesets ouverts : non assignée (sinon la création l'aurait déjà assignée).
  const id = await approvedReq('GH200 auto')
  await s.invoke('changesets:update', localPath, changeA, { status: 'clos' })
  await navigate(p, s.projectUrl(`/req/${id}`, { repoPath: localPath }))
  await p.getByRole('button', { name: /Obsolète/ }).click()
  await expect(p.getByTestId('modification-gate-notice')).toContainText(changeB)
  await expect.poll(async () => (await getChange(changeB)).toModify.map(t => t.id)).toContain(id)

  // A6 : élément déjà dans un changeset ouvert, création d'un autre changeset → pas de question.
  await s.invoke('changesets:create', localPath, { objectTypeRef: 'root::gh200_cs', title: 'GH200 C', component: 'root' })
  const again = await s.invoke<{ tracking: boolean; assignedTo: string | null }>(
    'changesets:modification-check', localPath, { id, objectTypeRef: TYPE }, 'reopen', s.project.workspaceDir)
  expect(again.assignedTo).toBe(changeB)
})

test('GH200-A14 — préférence décochée : plus d\'assignation, verrou maintenu', async () => {
  const p = s.page
  const { localPath } = s.project
  await navigate(p, s.projectUrl('/preferences', { repoPath: localPath }))
  const box = p.getByTestId('change-tracking')
  await expect(box).toBeChecked()
  await box.uncheck()
  await p.getByRole('button', { name: /Enregistrer/ }).click()
  await expect.poll(async () => (await s.invoke<SchemaLike>('schema:get', localPath)).preferences?.changeTracking).toBe('off')
  const check = await s.invoke<{ tracking: boolean }>('changesets:modification-check', localPath, { objectTypeRef: TYPE }, 'create', s.project.workspaceDir)
  expect(check.tracking).toBe(false)
  const id = await approvedReq('GH200 off')
  await expect(s.invoke('requirements:update', localPath, id, { title: 'X' })).rejects.toThrow(/approuvé/)
})
