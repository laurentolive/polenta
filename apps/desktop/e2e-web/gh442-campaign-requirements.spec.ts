import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH442 — colonne « Exigence » de la grille des entrées d'une campagne : exigence de l'instance (test
 * itérant) ou exigences couvertes par le test (liens de couverture) ; « Reportée depuis » masquée par
 * défaut (specs/GH442-tests.md, E1–E4, E6). Types, exigences, tests et liens sont créés par le test (IPC).
 */
const s = setupSession()

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }>; linkTypes?: Array<{ name: string; sourceRefs?: string[]; targetRefs?: string[] }> }
interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string; requirementId?: string }> }

const REQ_TYPE = 'gh442_exigence'
const TEST_TYPE = 'gh442_essai'
const LINK_TYPE = 'gh442_verifie'

let campaign: Campaign
let R1: string, R2: string, R3: string
/** A : non itérant, lié à R1 et R2 · B : non itérant, sans lien · C : itérant (`{req.title}`), lié à R1 et R3. */
let A: string, B: string, C: string

const repoSearch = () => ({ repoPath: s.project.localPath })
const campaignUrl = () => s.projectUrl(`/campaign/${campaign.id}`, repoSearch())

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

/** Cellule « Exigence » d'une entrée. */
const reqCell = (p: Page, entryId: string) => p.getByTestId(`campaign-entries-row-${entryId}`).locator('td[data-col="requirement"]')

async function createLink(sourceId: string, targetId: string) {
  await s.invoke('requirements:link-create', s.project.localPath, { type: LINK_TYPE, sourceId, targetId })
}

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [
    ...(root.objectTypes ?? []),
    { name: REQ_TYPE, label: 'GH442 Exigence', prefix: 'GHQ', category: 'requirement', fields: [], statuses: [{ name: 'draft' }] },
    { name: TEST_TYPE, label: 'GH442 Essai', prefix: 'GHW', category: 'test', fields: [], statuses: [{ name: 'valide', isApproval: true }] },
  ]
  schema.linkTypes = [...(schema.linkTypes ?? []), { name: LINK_TYPE, sourceRefs: [`root::${TEST_TYPE}`], targetRefs: [`root::${REQ_TYPE}`] }]
  await s.invoke('schema:save', localPath, schema)

  const req = async (title: string) => (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: `root::${REQ_TYPE}`, title, fields: {} }, workspaceDir)).id
  ;[R1, R2, R3] = [await req('Exigence un'), await req('Exigence deux'), await req('Exigence trois')]
  const tc = async (title: string, action: string) => (await s.invoke<{ id: string }>('tests:create', localPath, {
    objectTypeRef: `root::${TEST_TYPE}`, title, fields: {}, steps: [{ order: 1, action, expectedResult: 'ok', notes: '' }],
  }, workspaceDir)).id
  ;[A, B, C] = [await tc('GH442 A', 'Vérifier'), await tc('GH442 B', 'Vérifier'), await tc('GH442 C', 'Vérifier {req.title}')]
  await createLink(A, R1)
  await createLink(A, R2)
  await createLink(C, R1)
  await createLink(C, R3)

  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH442 e2e', testCaseIds: [A, B, C] }, workspaceDir)
})

test('E1 — colonne Exigence : exigences couvertes (test non itérant) ou exigence de l\'instance (test itérant)', async () => {
  const p = s.page
  await navigate(p, campaignUrl())
  const entries = p.getByTestId('campaign-entries')
  await expect(entries.getByTestId('campaign-entries-header-requirement')).toHaveCount(1)

  // A : deux exigences couvertes, en liens d'élément, texte « R1, R2 ».
  const a = reqCell(p, `${A}-1`)
  await expect(a).toHaveText(`${R1}, ${R2}`)
  await expect(a.locator(`[data-element-link="${R1}"]`)).toHaveCount(1)
  await expect(a.locator(`[data-element-link="${R2}"]`)).toHaveCount(1)
  await expect(a.locator('[data-requirement-source]')).toHaveAttribute('data-requirement-source', 'covered')

  // B : aucun lien, cellule vide.
  await expect(reqCell(p, `${B}-1`)).toHaveText('')

  // C : une instance par exigence liée, chacune avec la seule sienne (jamais « R1, R3 »).
  expect(campaign.runs.filter(r => r.testCaseId === C).map(r => r.requirementId).sort()).toEqual([R1, R3].sort())
  await expect(reqCell(p, `${C}-1`)).toHaveText(R1)
  await expect(reqCell(p, `${C}-2`)).toHaveText(R3)
  await expect(reqCell(p, `${C}-1`).locator('[data-requirement-source]')).toHaveAttribute('data-requirement-source', 'instance')
  // Pas d'info-bulle native : elle recouvrirait la popup d'aperçu du lien (GH250).
  await expect(a.locator('[title]')).toHaveCount(0)
  await s.shot('gh442-grid')
})

test('E4 — un lien créé ailleurs apparaît au retour sur la page, sans recharger l\'application', async () => {
  const p = s.page
  await navigate(p, campaignUrl())
  await expect(reqCell(p, `${B}-1`)).toHaveText('')

  await createLink(B, R2)
  await navigate(p, s.projectUrl('/schema', repoSearch()))
  await navigate(p, campaignUrl())
  await expect(reqCell(p, `${B}-1`)).toHaveText(R2)
})

test('E6 — « Reportée depuis » n\'est pas visible par défaut ; 👁 Colonnes la propose', async () => {
  const p = s.page
  await navigate(p, campaignUrl())
  await expect(p.getByTestId('campaign-entries-header-requirement')).toHaveCount(1)
  await expect(p.getByTestId('campaign-entries-header-carried')).toHaveCount(0)

  await p.getByTestId('campaign-entries-columns').click()
  await expect(p.getByTestId('campaign-entries-column-carried')).toBeVisible()
  await p.getByTestId('campaign-entries-column-carried').click()
  await p.keyboard.press('Escape')
  await expect(p.getByTestId('campaign-entries-header-carried')).toHaveCount(1)
})
