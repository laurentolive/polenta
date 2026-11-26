import { test, expect, type Locator, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { typeOfCategory } from './support/demo-types'

/**
 * GH433 — popovers du bouton « Exporter » rognés par la page hôte. Le popover de résultat (« Téléchargé : … »,
 * 384 px) et celui d'erreur (288 px) sont alignés à droite du bouton ; la barre d'outils d'une grille étant
 * près du bord gauche de la zone de contenu d'une version, ils débordent à gauche et le défilement de la page
 * (overflow-y auto, donc rognage horizontal aussi) les coupe : leur bouton « Fermer » ne reçoit plus le pointeur.
 * Testé sur la page d'une version, pour les trois popovers de `ExportButton` : formats, erreur, résultat.
 */
const s = setupSession()

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }

let versionId = ''
let reqA = ''
let testId = ''

const repo = () => s.project.localPath
const ws = () => s.project.workspaceDir
const commit = async (message: string) => {
  await s.invoke('sync:stage-all', repo())
  await s.invoke('sync:commit', repo(), message)
}
async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

/** Le centre du bouton est bien le bouton : ni rogné par un conteneur à défilement, ni couvert par un autre élément. */
async function expectReachable(button: Locator) {
  const reachable = await button.evaluate(el => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit !== null && el.contains(hit)
  })
  expect(reachable, 'le pointeur atteint-il le bouton ?').toBe(true)
}

/**
 * Bouton « Exporter » de la barre de titre de la page d'une version. GH439 : il remplace celui de chaque grille de la
 * page ; la fenêtre porte en plus les cases de choix des sections (les popovers restent rendus hors de la page).
 */
const exportButton = (p: Page) => p.getByTestId('export-button')

test.beforeAll(async () => {
  test.setTimeout(300_000)
  await s.invoke('schema:invalidate', repo())
  const schema = await s.invoke<SchemaLike>('schema:get', repo())
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []),
    { name: 'gh433_req', label: 'GH433 Exigence', prefix: 'GH433V', category: 'requirement', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }] },
    { name: 'gh433_test', label: 'GH433 Test', prefix: 'GH433W', category: 'test', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }] },
  ]
  typeOfCategory(root, 'version', { name: 'gh433_version', label: 'Version', prefix: 'GH433P', category: 'version', fields: [], statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }] })
  await s.invoke('schema:save', repo(), schema)
  reqA = (await s.invoke<{ id: string }>('requirements:create', repo(), { objectTypeRef: 'root::gh433_req', title: 'GH433 exigence', fields: {} }, ws())).id
  testId = (await s.invoke<{ id: string }>('tests:create', repo(), { objectTypeRef: 'root::gh433_test', title: 'GH433 test', fields: {}, steps: [] }, ws())).id
  await s.invoke('requirements:link-create', repo(), { type: 'verification', sourceId: testId, targetId: reqA }, ws())
  versionId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH433 export' }, ws())).id
  await s.invoke('versions:include', repo(), versionId, [reqA], ws())
  await commit('GH433 export — version et test')
})

test('GH433-1 — Exporter (page d’une version) : popover des formats puis popover « Téléchargé » atteignables', async () => {
  const p = s.page
  await navigate(p, s.projectUrl(`/version/${versionId}`, { repoPath: repo() }))
  await expect(p.getByTestId(`version-tests-check-${testId}`)).toBeVisible()

  await exportButton(p).click()
  const excel = p.getByRole('button', { name: 'Excel' })
  await expect(excel).toBeVisible()
  await expectReachable(excel)
  await excel.click()

  const close = p.getByRole('button', { name: 'Fermer' })
  await expect(close).toBeVisible()
  await expectReachable(close)
  await close.click()
  await expect(close).toHaveCount(0)
})

test('GH433-2 — Exporter (page d’une version) : popover d’erreur atteignable', async () => {
  const p = s.page
  // Export refusé côté serveur : le popover d'erreur s'affiche (onError de ExportButton).
  s.allowConsoleErrors(/status of 500/)
  await p.route('**/rpc/web%3Aexport', route => route.fulfill({ status: 500, contentType: 'text/plain', body: 'GH433 échec simulé' }))
  try {
    await navigate(p, s.projectUrl(`/version/${versionId}`, { repoPath: repo() }))
    await expect(p.getByTestId(`version-tests-check-${testId}`)).toBeVisible()
    await exportButton(p).click()
    await p.getByRole('button', { name: 'Excel' }).click()
    const close = p.getByRole('button', { name: 'Fermer' })
    await expect(close).toBeVisible()
    await expectReachable(close)
    await close.click()
    await expect(close).toHaveCount(0)
  } finally {
    await p.unroute('**/rpc/web%3Aexport')
  }
})
