import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { recordResult } from './support/campaign'

/**
 * GH389 — grilles des campagnes (specs/GH389-tests.md E11, E12 ; spec §4) : entrées d'une campagne
 * (barre d'outils commune, pastilles de statut, filtre par colonne, liens d'élément, clavier),
 * report depuis une campagne dans le sélecteur de tests (grille à cases en modale, Échap), liste des
 * campagnes de la vue système, mémoire du défilement des entrées et de la liste échantillonnée à
 * chaque frame sur les chemins de retour (onglet, Précédent, barre d'activité — leçon 2026-11-06).
 * Type de test, tests et campagnes créés par IPC.
 */
const s = setupSession()

interface SchemaLike { nodes: Array<{ name: string; objectTypes?: unknown[] }> }
interface Campaign { id: string; title: string; runs: Array<{ entryId: string; testCaseId: string }> }

const testIds: string[] = []
let target: Campaign
let source: Campaign

const repo = () => s.project.localPath
const ws = () => s.project.workspaceDir
async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}
const openCampaign = (id: string) => navigate(s.page, s.projectUrl(`/campaign/${id}`, { repoPath: repo() }))

/** Barre d'outils commune d'une grille : 👁, ↕▯, Exporter, compteur ; icône de filtre sur une colonne. */
async function expectGridContract(gridId: string, filterCol: string) {
  const toolbar = s.page.getByTestId(`${gridId}-toolbar`)
  await expect(toolbar.getByTestId(`${gridId}-columns`)).toBeVisible()
  await expect(toolbar.getByRole('button', { name: /Exporter|Export/ })).toBeVisible()
  await expect(s.page.getByTestId(`${gridId}-count`)).toHaveText(/^\d+ \/ \d+$/)
  await expect(s.page.getByTestId(`${gridId}-header-${filterCol}`).locator('[data-column-filter-icon]')).toBeVisible()
}

async function filterColumn(gridId: string, col: string, text: string) {
  await s.page.getByTestId(`${gridId}-header-${col}`).locator('[data-column-filter-icon]').click()
  const popover = s.page.locator('[data-column-filter-popover]')
  await popover.getByTestId('column-filter-input').fill(text)
  await s.page.getByTestId(`${gridId}-count`).click()
  await expect(popover).toHaveCount(0)
}
async function clearFilter(gridId: string, col: string) {
  await s.page.getByTestId(`${gridId}-header-${col}`).locator('[data-column-filter-icon]').click()
  await s.page.getByTestId('column-filter-input').press('Escape')
}

test.beforeAll(async () => {
  test.setTimeout(300_000)
  await s.invoke('schema:invalidate', repo())
  const schema = await s.invoke<SchemaLike>('schema:get', repo())
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: 'gh389c_test', label: 'GH389C Test', prefix: 'GH389C', category: 'test', fields: [],
    statuses: [{ name: 'valide', label: 'Validé', isApproval: true }],
  }]
  await s.invoke('schema:save', repo(), schema)
  // Assez d'entrées pour faire défiler la grille (au plus 70 % de la hauteur de la fenêtre).
  for (let i = 1; i <= 42; i++) {
    testIds.push((await s.invoke<{ id: string }>('tests:create', repo(), {
      objectTypeRef: 'root::gh389c_test', title: `GH389C test ${i}`, fields: {}, steps: [],
    }, ws())).id)
  }
  // Source clôturée : un test passé, un test à exécuter (reportable par défaut).
  source = await s.invoke<Campaign>('campaigns:create', repo(), { title: 'GH389C source', testCaseIds: testIds.slice(40) }, ws())
  await recordResult(s, source.id, source.runs[0].entryId, 'PASS')
  source = await s.invoke<Campaign>('campaigns:close', repo(), source.id, 'completed')
  target = await s.invoke<Campaign>('campaigns:create', repo(), { title: 'GH389C cible', testCaseIds: testIds.slice(0, 40) }, ws())
  // Assez de campagnes pour faire défiler la liste.
  for (let i = 1; i <= 35; i++) await s.invoke('campaigns:create', repo(), { title: `GH389C vide ${i}`, testCaseIds: [] }, ws())
})

test('E11 — entrées d’une campagne : contrat de grille, pastilles, liens, clavier', async () => {
  const p = s.page
  await openCampaign(target.id)
  const grid = p.getByTestId('campaign-entries')
  await expect(grid).toBeVisible()
  await expectGridContract('campaign-entries', 'test')
  await expect(p.getByTestId('campaign-entries-count')).toHaveText('40 / 40')
  // Pastilles de statut : filtre de l'écran, en tête de la barre d'outils.
  await expect(p.getByTestId('campaign-entries-toolbar').locator('button[data-status="pending"]')).toBeVisible()

  const first = target.runs[0]
  const rowOf = (entryId: string) => grid.locator(`tr[data-node-id="${entryId}"]`)
  await expect(rowOf(first.entryId).locator(`td[data-col="test"] [data-element-link="${first.testCaseId}"]`)).toBeVisible()

  // Filtre par colonne, combiné à la pastille.
  await filterColumn('campaign-entries', 'test', testIds[5])
  await expect(p.getByTestId('campaign-entries-count')).toHaveText('1 / 40')
  await p.getByTestId('campaign-entries-toolbar').locator('button[data-status="pending"]').click()
  await expect(p).toHaveURL(/status=pending/)
  await expect(p.getByTestId('campaign-entries-count')).toHaveText('1 / 40')
  await p.getByTestId('campaign-status-filter-clear').click()
  await clearFilter('campaign-entries', 'test')
  await expect(p.getByTestId('campaign-entries-count')).toHaveText('40 / 40')

  // Clavier : ↓ ×2 puis → depuis la cellule Titre de la première ligne.
  await rowOf(first.entryId).locator('td[data-col="title"]').click()
  await p.keyboard.press('ArrowDown')
  await p.keyboard.press('ArrowDown')
  await p.keyboard.press('ArrowRight')
  await expect(rowOf(target.runs[2].entryId).locator('td[data-active]')).toHaveAttribute('data-col', 'requirement')
  await expect(rowOf(target.runs[2].entryId)).toHaveAttribute('data-selected', '')

  // Panneau 👁 commun : masquer puis réafficher une colonne.
  await p.getByTestId('campaign-entries-columns').click()
  await p.getByTestId('campaign-entries-column-params').click()
  await expect(p.getByTestId('campaign-entries-header-params')).toHaveCount(0)
  await p.getByTestId('campaign-entries-column-params').click()
  await expect(p.getByTestId('campaign-entries-header-params')).toHaveCount(1)
  await p.keyboard.press('Escape')
  await s.shot('gh389-campaign-entries')
})

test('E11 — report depuis une campagne : grille à cases en modale, liens, Échap', async () => {
  const p = s.page
  await openCampaign(target.id)
  await p.getByText('Ajouter des tests').click()
  await p.getByRole('tab', { name: 'Depuis une campagne' }).click()
  await p.getByTestId('carry-sources').getByRole('checkbox', { name: source.id }).check()
  const carry = p.getByTestId('carry-rows')
  await expect(carry).toBeVisible()
  await expectGridContract('campaign-carry', 'test')
  const pendingEntry = source.runs[1]
  const row = carry.locator(`tr[data-node-id="${source.id}/${pendingEntry.entryId}"]`)
  await expect(row.locator(`td[data-col="test"] [data-element-link="${pendingEntry.testCaseId}"]`)).toBeVisible()
  await expect(row.locator(`td[data-col="source"] [data-element-link="${source.id}"]`)).toBeVisible()
  await expect(row.getByRole('checkbox')).toBeChecked()

  // Filtre texte de l'écran, combiné à la grille.
  await p.getByTestId('carry-filter').fill('zzz-aucun')
  await expect(p.getByTestId('campaign-carry-count')).toHaveText('0 / 1')
  await p.getByTestId('carry-filter').fill('')
  await expect(p.getByTestId('campaign-carry-count')).toHaveText('1 / 1')

  // Grille à cases : un clic sur la ligne la décoche, Espace la recoche ; Échap sur la cellule active
  // ne ferme pas la modale et ne touche pas aux cases.
  await row.locator('td[data-col="status"]').click()
  await expect(row.getByRole('checkbox')).not.toBeChecked()
  await p.keyboard.press('ArrowLeft')
  await p.keyboard.press('ArrowLeft')
  await p.keyboard.press('ArrowLeft')
  await p.keyboard.press('ArrowLeft')
  await p.keyboard.press('ArrowLeft')
  await expect(row.locator('td[data-active]')).toHaveAttribute('data-col', '__check')
  await p.keyboard.press('Space')
  await expect(row.getByRole('checkbox')).toBeChecked()
  await p.keyboard.press('Escape')
  await expect(p.getByRole('tab', { name: 'Depuis une campagne' })).toBeVisible()
  await expect(row.getByRole('checkbox')).toBeChecked()

  // Validation : l'entrée reportée affiche sa campagne d'origine en lien d'élément.
  await p.getByRole('button', { name: 'Ajouter (1)' }).click()
  await expect(p.getByRole('tab', { name: 'Depuis une campagne' })).toHaveCount(0)
  await expect(p.getByTestId('campaign-entries-count')).toHaveText('41 / 41')
  await expect(p.getByTestId('campaign-entries').locator(`td[data-col="carried"] [data-element-link="${source.id}"]`)).toHaveCount(1)
})

/** Liste des campagnes de la vue système (barre d'activité « Campagnes » : `/product?category=campaign`). */
async function openCampaignList() {
  await s.openView('Exigences')
  await s.openView('Campagnes')
  await expect.poll(() => new URL(s.page.url()).pathname).toBe('/product')
  await expect(s.page.getByTestId('campaign-list')).toBeVisible()
}

test('E11 — liste des campagnes : grille, liens, ouverture', async () => {
  const p = s.page
  await openCampaignList()
  const list = p.getByTestId('campaign-list')
  await expectGridContract('campaign-list', 'title')
  const row = list.locator(`tr[data-node-id="${source.id}"]`)
  await expect(row.locator(`td[data-col="id"] [data-element-link="${source.id}"]`)).toBeVisible()
  await expect(row.locator(`td[data-col="tests"] [data-element-link="${testIds[40]}"]`)).toBeVisible()
  await expect(row.locator('td[data-col="status"]')).toHaveText('Clôturée')
  await filterColumn('campaign-list', 'title', 'GH389C source')
  await expect(list.locator('tr[data-node-id]')).toHaveCount(1)
  // Entrée sur une cellule sans lien : ouvre la campagne.
  await row.locator('td[data-col="title"]').click()
  await p.keyboard.press('Enter')
  await expect(p).toHaveURL(new RegExp(`/campaign/${source.id}`))
})

// ── E12 — mémoire du défilement (leçon 2026-11-06 : chaque frame, plusieurs chemins de retour) ──
// Entrées d'une campagne : onglet et Précédent (la barre d'activité « Campagnes » ouvre la liste) ;
// liste des campagnes : barre d'activité et Précédent.

interface Visible { node: string; offset: number }
function readVisible(el: HTMLElement): Visible {
  const area = el.getBoundingClientRect()
  for (const row of el.querySelectorAll<HTMLElement>('[data-node-id]')) {
    const r = row.getBoundingClientRect()
    if (r.height === 0 || r.bottom <= area.top) continue
    return { node: row.dataset.nodeId!, offset: Math.round(r.top - area.top) }
  }
  return { node: '', offset: 0 }
}
const scroller = (grid: string) => s.page.getByTestId(grid).locator('[data-view-scroll]')
const position = (grid: string) => scroller(grid).evaluate(readVisible)
const same = (a: Visible, b: Visible) => a.node === b.node && Math.abs(a.offset - b.offset) <= 2

async function scrollGrid(grid: string, fraction: number): Promise<Visible> {
  await expect.poll(() => scroller(grid).evaluate(el => el.scrollHeight > el.clientHeight + 100)).toBe(true)
  await scroller(grid).evaluate((el, f) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * f }, fraction)
  await s.page.waitForTimeout(400)
  return position(grid)
}
/** Échantillonne la position à chaque frame pendant 2,5 s, quand la page `pathEnd` affiche la grille. */
async function startSampling(grid: string, pathEnd: string) {
  await s.page.evaluate(`(() => {
    const readVisible = ${readVisible.toString()}
    window.__gh389 = []
    const start = performance.now()
    const tick = () => {
      const el = document.querySelector('[data-testid="${grid}"] [data-view-scroll]')
      if (location.pathname.endsWith('${pathEnd}') && el && el.querySelector('[data-node-id]')) window.__gh389.push(readVisible(el))
      if (performance.now() - start < 2500) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })()`)
}
async function expectRestored(grid: string, expected: Visible) {
  await expect.poll(async () => { const p = await position(grid); return same(p, expected) ? 'ok' : JSON.stringify(p) }).toBe('ok')
  await s.page.waitForTimeout(2600)
  const samples = await s.page.evaluate(() => (window as unknown as { __gh389: Visible[] }).__gh389)
  expect(samples.length).toBeGreaterThan(0)
  const off = samples.filter(p => !same(p, expected))
  expect(off, `frames hors position ${JSON.stringify(expected)} : ${JSON.stringify(off.slice(0, 5))}`).toEqual([])
}
const tabs = () => s.page.getByTestId('tab')

test('E12 — entrées : position reprise au retour sur l’onglet, sans peindre le haut', async () => {
  await openCampaign(target.id)
  const p = await scrollGrid('campaign-entries', 0.7)
  expect(p.node).not.toBe(target.runs[0].entryId)
  const count = await tabs().count()
  const start = (await tabs().evaluateAll(els => els.map(el => el.classList.contains('bg-canvas')))).indexOf(true)
  await s.page.getByTitle('Nouvel onglet (Ctrl+T)').click()
  await expect(tabs()).toHaveCount(count + 1)
  await s.openView('Exigences')
  await startSampling('campaign-entries', `/campaign/${target.id}`)
  await tabs().nth(start).click()
  await expectRestored('campaign-entries', p)
})

test('E12 — entrées : position reprise par Précédent, sans peindre le haut', async () => {
  await openCampaign(target.id)
  const p = await scrollGrid('campaign-entries', 0.5)
  await openCampaign(source.id)
  await expect(s.page.getByTestId('campaign-entries')).toBeVisible()
  await startSampling('campaign-entries', `/campaign/${target.id}`)
  await s.page.goBack()
  await expectRestored('campaign-entries', p)
})

test('E12 — liste des campagnes : position reprise par la barre d’activité, sans peindre le haut', async () => {
  await openCampaignList()
  const p = await scrollGrid('campaign-list', 0.8)
  await s.openView('Exigences')
  await expect.poll(() => new URL(s.page.url()).searchParams.get('category')).not.toBe('campaign')
  await startSampling('campaign-list', '/product')
  await s.openView('Campagnes')
  await expectRestored('campaign-list', p)
})

test('E12 — liste des campagnes : position reprise par Précédent, sans peindre le haut', async () => {
  await openCampaignList()
  const p = await scrollGrid('campaign-list', 0.6)
  await openCampaign(source.id)
  await expect(s.page.getByTestId('campaign-entries')).toBeVisible()
  await startSampling('campaign-list', '/product')
  await s.page.goBack()
  await expectRestored('campaign-list', p)
})
