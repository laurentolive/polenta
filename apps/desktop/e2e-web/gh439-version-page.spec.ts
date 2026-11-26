import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { typeOfCategory } from './support/demo-types'

/**
 * GH439 — page d'une version : sections repliables (Informations, Composants, Changements, Analyse, Tests,
 * Exigences), couverture figée à la release (specs/GH439-tests.md E1 à E12, E17). Sans `allowConsoleErrors` :
 * un canal masqué répondrait 404. Le projet de démo porte ses propres exigences : les assertions visent les
 * éléments créés ici, jamais un total.
 */
const s = setupSession()

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: Array<{ name: string; label?: string; isApproval?: boolean; isTerminal?: boolean }> }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface VersionPageLike { version: { id: string; verification?: unknown }; typeDef: { statuses?: Array<{ name: string; isTerminal?: boolean }> } }

const REQUIREMENTS_RPC = /\/rpc\/versions(?:%3A|:)requirements/
let releasedId = ''
let legacyId = ''
let currentId = ''
let abandonedId = ''
let reqA = ''
let reqB = ''
let reqObsolete = ''
let reqC = ''
let extraIds: string[] = []
let testA = ''
let testB = ''

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
const openVersion = (id: string) => navigate(s.page, s.projectUrl(`/version/${id}`, { repoPath: repo() }))
const grid = () => s.page.getByTestId('version-requirements')
const rowOf = (id: string) => grid().locator(`tr[data-node-id="${id}"]`)
const openRequirements = async () => {
  const toggle = s.page.getByTestId('version-requirements-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(grid()).toBeVisible()
}
const readStatusLabels = () => ({ covered: /Couvert|Covered/, notCovered: /Non couvert|Not covered/ })

test.beforeAll(async () => {
  test.setTimeout(300_000)
  await s.invoke('schema:invalidate', repo())
  const schema = await s.invoke<SchemaLike>('schema:get', repo())
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []),
    {
      name: 'gh439_req', label: 'GH439 Exigence', prefix: 'GH439R', category: 'requirement',
      fields: [{ name: 'priority', label: 'Priorité GH439', type: 'text', defaultVisible: true }],
      statuses: [{ name: 'draft', label: 'Brouillon' }, { name: 'obsolete', label: 'Obsolète', isTerminal: true }],
    },
    { name: 'gh439_test', label: 'GH439 Test', prefix: 'GH439T', category: 'test', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }] },
  ]
  typeOfCategory(root, 'version', {
    name: 'gh439_version', label: 'Version', prefix: 'GH439P', category: 'version', fields: [],
    statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }],
  })
  await s.invoke('schema:save', repo(), schema)
  const create = async (title: string, status = 'draft') => {
    // `status` à la création (précédent gh243) : un statut terminal ne s'atteint pas par `requirements:update`.
    return (await s.invoke<{ id: string }>('requirements:create', repo(), { objectTypeRef: 'root::gh439_req', title, status, fields: { priority: 'high' } }, ws())).id
  }
  reqA = await create('GH439 couverte')
  reqB = await create('GH439 non couverte')
  reqObsolete = await create('GH439 obsolète', 'obsolete')
  reqC = await create('GH439 jamais livrée')
  testA = (await s.invoke<{ id: string }>('tests:create', repo(), { objectTypeRef: 'root::gh439_test', title: 'GH439 test A', fields: {}, steps: [] }, ws())).id
  testB = (await s.invoke<{ id: string }>('tests:create', repo(), { objectTypeRef: 'root::gh439_test', title: 'GH439 test B', fields: {}, steps: [] }, ws())).id
  await s.invoke('requirements:link-create', repo(), { type: 'verification', sourceId: testA, targetId: reqA }, ws())
  // 60 exigences de plus, livrées par la version figée : assez de lignes pour faire défiler la grille (E13).
  extraIds = Array.from({ length: 60 }, (_, i) => `GH439R-${String(101 + i).padStart(4, '0')}`)
  for (const id of extraIds) {
    fs.writeFileSync(path.join(repo(), 'requirements', `${id}.yaml`),
      yaml.dump({ id, projectId: '', branchId: '', objectTypeRef: 'root::gh439_req', title: `GH439 lot ${id}`, status: 'draft', version: 1, fields: { priority: 'low' } }))
  }
  await commit('GH439 préparation')

  // Version released : couverture figée (reqA couverte, reqB et le lot non couverts, reqObsolete terminale donc absente).
  // reqC n'est dans aucune version. Par défaut une version se base sur la dernière released du projet (ici la 1.0 de la démo, dont les
  // exigences sont livrées : la lignée est cumulée) : `basedOn: null` pour une lignée à elle, que les cas suivants chaînent.
  releasedId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH439 figée', basedOn: null }, ws())).id
  await s.invoke('versions:include', repo(), releasedId, [reqA, reqB, reqObsolete, ...extraIds], ws())
  await commit('GH439 version')
  await s.invoke('versions:release', repo(), releasedId, 'gh439-fige', ws())

  // Version released avant GH439 : même version, `verification` retirée du fichier.
  legacyId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH439 ancienne', basedOn: releasedId }, ws())).id
  await s.invoke('versions:include', repo(), legacyId, [reqB], ws())
  await commit('GH439 version ancienne')
  await s.invoke('versions:release', repo(), legacyId, 'gh439-ancienne', ws())
  const legacyFile = path.join(repo(), 'versions', `${legacyId}.yaml`)
  const legacy = yaml.load(fs.readFileSync(legacyFile, 'utf8')) as Record<string, unknown>
  delete legacy['verification']
  fs.writeFileSync(legacyFile, yaml.dump(legacy, { lineWidth: 120 }))

  // Version en cours et version abandonnée avant tout passage released.
  currentId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH439 en cours', basedOn: legacyId }, ws())).id
  abandonedId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH439 abandonnée', basedOn: null }, ws())).id
  const page = await s.invoke<VersionPageLike>('versions:get', repo(), abandonedId, ws())
  await s.invoke('versions:update', repo(), abandonedId, { status: page.typeDef.statuses!.find(x => x.isTerminal)!.name }, ws())
})

test('E1, E2 — sections dans l\'ordre, Exigences fermée et sans lecture, ID et état dans la barre de titre', async () => {
  const p = s.page
  const requests: string[] = []
  p.on('request', r => { if (REQUIREMENTS_RPC.test(r.url())) requests.push(r.url()) })
  await openVersion(releasedId)
  await expect(p.getByTestId('version-page')).toBeVisible()
  // Ordre de la page : Informations, (Composants), Changements, Analyse, Tests, Exigences.
  await expect(p.getByTestId('version-requirements-section')).toBeVisible()
  const order = await p.getByTestId('version-page').locator(
    '[data-testid="version-info-section"], [data-testid="version-changes-toggle"], [data-testid="version-analysis"], [data-testid="version-tests"], [data-testid="version-requirements-section"]',
  ).evaluateAll(els => els.map(el => el.getAttribute('data-testid')))
  expect(order).toEqual(['version-info-section', 'version-changes-toggle', 'version-analysis', 'version-tests', 'version-requirements-section'])
  await expect(p.getByTestId('version-info')).toBeVisible()
  await expect(p.getByTestId('version-requirements-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(grid()).toHaveCount(0)
  expect(requests, 'aucune lecture tant que la section est fermée').toEqual([])
  p.removeAllListeners('request')

  // E2 — ID et pastille d'état toujours là, plus de bouton de repli de l'en-tête.
  await expect(p.getByTestId('version-state-short')).toBeVisible()
  await expect(p.getByTestId('version-page')).toContainText(releasedId)
  await expect(p.getByTestId('version-header-toggle')).toHaveCount(0)
})

test('E3 — « Informations » repliée : état retrouvé au rechargement, les autres sections ne bougent pas', async () => {
  const p = s.page
  await openVersion(releasedId)
  await p.getByTestId('version-info-toggle').click()
  await expect(p.getByTestId('version-info')).toHaveCount(0)
  await expect(p.getByTestId('version-changes-toggle')).toHaveAttribute('aria-expanded', 'true')
  await p.reload()
  await p.waitForLoadState('networkidle')
  await expect(p.getByTestId('version-page')).toBeVisible()
  await expect(p.getByTestId('version-info')).toHaveCount(0)
  await expect(p.getByTestId('version-info-toggle')).toHaveAttribute('aria-expanded', 'false')
  await p.getByTestId('version-info-toggle').click()
  await expect(p.getByTestId('version-info')).toBeVisible()
})

test('E4 — composant retiré de la structure : l\'alerte reste visible, section Composants fermée', async () => {
  const p = s.page
  await s.invoke('versions:update', repo(), currentId, { components: { 'composant-fantome': 'GHOST-0001' } }, ws())
  await openVersion(currentId)
  await expect(p.getByTestId('version-orphan-components')).toBeVisible()
  const toggle = p.getByTestId('version-components-toggle')
  if (await toggle.count() > 0 && (await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click()
  await expect(p.getByTestId('version-orphan-components')).toBeVisible()
  await s.invoke('versions:update', repo(), currentId, { components: {} }, ws())
})

test('E5 — Exigences d\'une version released : état et vérification figés, ligne d\'information, compteur', async () => {
  const p = s.page
  await openVersion(releasedId)
  const requested = p.waitForRequest(r => REQUIREMENTS_RPC.test(r.url()))
  await p.getByTestId('version-requirements-toggle').click()
  await requested
  await expect(grid()).toBeVisible()
  await expect(p.getByTestId('version-requirements-info')).toHaveAttribute('data-verification', 'frozen')
  await expect(p.getByTestId('version-requirements-info')).toContainText('gh439-fige')
  await expect(rowOf(reqA)).toBeVisible()
  await expect(rowOf(reqB)).toBeVisible()
  await expect(rowOf(reqObsolete)).toHaveCount(0)   // incluse mais de statut terminal : absente
  // Seulement ce que la version livre : ni l'exigence jamais livrée, ni les exigences du projet de démo.
  await expect(rowOf(reqC)).toHaveCount(0)
  await expect(rowOf('CC-0001')).toHaveCount(0)
  await expect(p.getByTestId('version-requirements-count')).toHaveText(`${2 + extraIds.length} / ${2 + extraIds.length}`)
  await expect(rowOf(reqA).locator('td[data-col="coverageStatus"]')).toHaveText(readStatusLabels().covered)
  await expect(rowOf(reqB).locator('td[data-col="coverageStatus"]')).toHaveText(readStatusLabels().notCovered)
  await expect(rowOf(reqA).locator(`td[data-col="id"] [data-element-link="${reqA}"]`)).toBeVisible()
  await expect(p.getByTestId('version-requirements-toggle')).toContainText(/\(\d+\)/)
  // Pas de bouton Exporter dans la grille : l'export est celui de la page.
  await expect(p.getByTestId('version-requirements-toolbar').getByRole('button', { name: /Exporter|Export/ })).toHaveCount(0)
  await expect(p.getByTestId('version-requirements-columns')).toBeVisible()
  await expect(p.getByTestId('version-requirements-count')).toHaveText(/^\d+ \/ \d+$/)
  await s.shot('gh439-version-requirements')
})

test('E6 — exigence modifiée et test lié après la release : contenu et couverture du gel inchangés', async () => {
  const p = s.page
  await s.invoke('requirements:update', repo(), reqB, { title: 'GH439 non couverte — modifiée' }, ws())
  await s.invoke('requirements:link-create', repo(), { type: 'verification', sourceId: testB, targetId: reqB }, ws())
  await commit('GH439 après la release')
  await openVersion(releasedId)
  await openRequirements()
  await expect(rowOf(reqB).locator('td[data-col="title"]')).toHaveText('GH439 non couverte')
  await expect(rowOf(reqB).locator('td[data-col="coverageStatus"]')).toHaveText(readStatusLabels().notCovered)
  expect(await p.getByTestId('version-requirements').locator('tr[data-node-id]').count()).toBeGreaterThan(0)
})

test('E7 — version en cours : état courant, couverture à l\'instant', async () => {
  const p = s.page
  await openVersion(currentId)
  await openRequirements()
  await expect(p.getByTestId('version-requirements-info')).toHaveAttribute('data-verification', 'live')
  await expect(rowOf(reqB).locator('td[data-col="title"]')).toHaveText('GH439 non couverte — modifiée')
  await expect(rowOf(reqB).locator('td[data-col="coverageStatus"]')).toHaveText(readStatusLabels().covered)
  await expect(rowOf(reqObsolete)).toHaveCount(0)
  // Sans changement propre : ce que la lignée (version précédente) a livré, pas le reste du repo.
  await expect(rowOf(reqA)).toBeVisible()
  await expect(rowOf(reqC)).toHaveCount(0)
  await expect(rowOf('CC-0001')).toHaveCount(0)
  // Une exigence incluse dans la version en cours apparaît (état courant du disque).
  await s.invoke('versions:include', repo(), currentId, [reqC], ws())
  await openVersion(currentId)
  await openRequirements()
  await expect(rowOf(reqC)).toBeVisible()
  await expect(rowOf(reqC).locator('td[data-col="coverageStatus"]')).toHaveText(readStatusLabels().notCovered)
})

test('E8 — version released avant GH439 : « — » et mention dédiée', async () => {
  const p = s.page
  await openVersion(legacyId)
  await openRequirements()
  await expect(p.getByTestId('version-requirements-info')).toHaveAttribute('data-verification', 'missing')
  await expect(rowOf(reqA).locator('td[data-col="coverageStatus"]')).toHaveText('—')
})

test('E9 — 👁 : colonnes choisies et ordre retrouvés après rechargement', async () => {
  const p = s.page
  await openVersion(releasedId)
  await openRequirements()
  await expect(grid().locator('th[data-col="tests"], [data-testid="version-requirements-header-tests"]')).toHaveCount(0)
  await p.getByTestId('version-requirements-columns').click()
  await p.getByTestId('version-requirements-column-status').click()
  await p.getByTestId('version-requirements-column-tests').click()
  await p.getByTestId('column-picker-close').click()
  await expect(p.getByTestId('version-requirements-header-tests')).toBeVisible()
  await expect(p.getByTestId('version-requirements-header-status')).toHaveCount(0)
  await expect(rowOf(reqA).locator('td[data-col="tests"] [data-element-link]')).toHaveCount(1)
  await p.reload()
  await p.waitForLoadState('networkidle')
  await openRequirements()
  await expect(p.getByTestId('version-requirements-header-tests')).toBeVisible()
  await expect(p.getByTestId('version-requirements-header-status')).toHaveCount(0)
  // Remise en l'état : les colonnes par défaut pour les scénarios suivants.
  await p.getByTestId('version-requirements-columns').click()
  await p.getByTestId('version-requirements-column-status').click()
  await p.getByTestId('version-requirements-column-tests').click()
  await p.getByTestId('column-picker-close').click()
  await expect(p.getByTestId('version-requirements-header-status')).toBeVisible()
  await expect(p.getByTestId('version-requirements-header-tests')).toHaveCount(0)
})

test('E10 — filtre « Vérification » : lignes et compteur', async () => {
  const p = s.page
  await openVersion(releasedId)
  await openRequirements()
  const total = await p.getByTestId('version-requirements-count').innerText()
  const label = (await rowOf(reqB).locator('td[data-col="coverageStatus"]').innerText()).trim()
  await p.getByTestId('version-requirements-header-coverageStatus').locator('[data-column-filter-icon]').click()
  await p.getByTestId('column-filter-input').fill(label)
  await p.getByTestId('version-requirements-count').click()
  await expect(rowOf(reqB)).toBeVisible()
  await expect(rowOf(reqA)).toHaveCount(0)
  await expect(p.getByTestId('version-requirements-count')).not.toHaveText(total)
  await expect(p.getByTestId('version-requirements-count')).toHaveText(/^\d+ \/ \d+$/)
  // Le filtre reste dans l'onglet (comme sur les autres grilles) : Échap dans le champ le retire.
  await p.getByTestId('version-requirements-header-coverageStatus').locator('[data-column-filter-icon]').click()
  await p.getByTestId('column-filter-input').press('Escape')
  await expect(p.getByTestId('version-requirements-count')).toHaveText(total)
})

test('E11 — lecture seule : aucune édition ; double-clic sur une ligne ouvre l\'exigence', async () => {
  const p = s.page
  await openVersion(releasedId)
  await openRequirements()
  const cell = rowOf(reqA).locator('td[data-col="title"]')
  // Aucune cellule n'est modifiable : un clic ne fait apparaître aucun éditeur.
  await cell.click()
  await expect(grid().locator('input, select, textarea')).toHaveCount(0)
  // Entrée sur une cellule non modifiable : ouvre l'exigence (la page de la version est quittée).
  await p.keyboard.press('Enter')
  await expect.poll(() => new URL(p.url()).pathname).not.toContain('/version/')
  // Double-clic sur une ligne : même effet.
  await openVersion(releasedId)
  await openRequirements()
  await rowOf(reqA).locator('td[data-col="title"]').dblclick()
  await expect.poll(() => new URL(p.url()).pathname).not.toContain('/version/')
})

test('E12 — version abandonnée avant tout passage released : pas de section Exigences', async () => {
  const p = s.page
  await openVersion(abandonedId)
  await expect(p.getByTestId('version-page')).toBeVisible()
  await expect(p.getByTestId('version-info')).toBeVisible()
  await expect(p.getByTestId('version-requirements-section')).toHaveCount(0)
})

test('E17 — Informations : saisie du libellé d\'une version en cours, section repliée puis dépliée', async () => {
  const p = s.page
  await openVersion(currentId)
  await p.getByTestId('version-info-toggle').click()
  await p.getByTestId('version-info-toggle').click()
  const title = p.getByTestId('version-title')
  await expect(title).toBeEditable()
  await title.fill('GH439 en cours bis')
  await title.blur()
  await expect(p.getByTestId('version-page')).toContainText('GH439 en cours bis')
  await expect.poll(async () => (await s.invoke<VersionPageLike & { version: { title: string } }>('versions:get', repo(), currentId, ws())).version.title).toBe('GH439 en cours bis')
  // `verification` n'est jamais renvoyée par la page d'une version (lecture par versions:requirements).
  expect((await s.invoke<VersionPageLike>('versions:get', repo(), releasedId, ws())).version.verification).toBeUndefined()
})

// ── E13 — mémoire du défilement de la grille « Exigences » (leçon GH300 : chaque frame, plusieurs chemins) ──

interface Visible { node: string; offset: number; scrollTop?: number }
function readVisible(el: HTMLElement): Visible {
  const area = el.getBoundingClientRect()
  for (const row of el.querySelectorAll<HTMLElement>('[data-node-id]')) {
    const r = row.getBoundingClientRect()
    if (r.height === 0 || r.bottom <= area.top) continue
    return { node: row.dataset.nodeId!, offset: Math.round(r.top - area.top), scrollTop: Math.round(el.scrollTop) }
  }
  return { node: '', offset: 0 }
}
const scroller = () => s.page.getByTestId('version-requirements').locator('[data-view-scroll]')
const position = () => scroller().evaluate(readVisible)
const same = (a: Visible, b: Visible) => a.node === b.node && Math.abs(a.offset - b.offset) <= 2

async function scrollGrid(fraction: number): Promise<Visible> {
  // La grille rend d'abord un lot de lignes puis les suivantes : défiler une fois toutes rendues, sinon la fraction
  // porte sur une hauteur provisoire et la position mesurée n'est pas celle qu'on retrouvera.
  const total = Number((await s.page.getByTestId('version-requirements-count').innerText()).split('/')[1])
  await expect.poll(() => grid().locator('tr[data-node-id]').count()).toBe(total)
  await scroller().evaluate((el, f) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * f }, fraction)
  await s.page.waitForTimeout(400)
  return position()
}
/** Échantillonne chaque frame de la grille de la page `versionId` seulement (les frames de la page quittée ne comptent pas). */
async function startSampling(versionId: string) {
  await s.page.evaluate(`(() => {
    const readVisible = ${readVisible.toString()}
    window.__gh439 = []
    const start = performance.now()
    const tick = () => {
      const el = document.querySelector('[data-testid="version-requirements"] [data-view-scroll]')
      if (location.pathname.endsWith('/${versionId}') && el && el.querySelector('[data-node-id]')) window.__gh439.push(readVisible(el))
      if (performance.now() - start < 2500) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })()`)
}
async function expectRestored(expected: Visible) {
  await expect.poll(async () => { const p = await position(); return same(p, expected) ? 'ok' : JSON.stringify({ obtenu: p, attendu: expected }) }).toBe('ok')
  await s.page.waitForTimeout(2600)
  const samples = await s.page.evaluate(() => (window as unknown as { __gh439: Visible[] }).__gh439)
  expect(samples.length).toBeGreaterThan(0)
  const off = samples.filter(p => !same(p, expected))
  expect(off, `frames hors position ${JSON.stringify(expected)} : ${JSON.stringify(off.slice(0, 5))}`).toEqual([])
}
const tabs = () => s.page.getByTestId('tab')

test('E13 — Exigences : position reprise par Précédent, sans peindre le haut', async () => {
  await openVersion(releasedId)
  await openRequirements()
  const p = await scrollGrid(0.7)
  expect(p.node).not.toBe('')
  await openVersion(currentId)
  await expect(s.page.getByTestId('version-page')).toBeVisible()
  await startSampling(releasedId)
  await s.page.goBack()
  await expectRestored(p)
})

test('E13 — Exigences : position reprise au retour sur l\'onglet, sans peindre le haut', async () => {
  await openVersion(releasedId)
  await openRequirements()
  const p = await scrollGrid(0.5)
  const count = await tabs().count()
  const start = (await tabs().evaluateAll(els => els.map(el => el.classList.contains('bg-canvas')))).indexOf(true)
  await s.page.getByTitle('Nouvel onglet (Ctrl+T)').click()
  await expect(tabs()).toHaveCount(count + 1)
  await s.openView('Exigences')
  await startSampling(releasedId)
  await tabs().nth(start).click()
  await expectRestored(p)
})

test('E13 — Exigences : position reprise par la barre d\'activité, sans peindre le haut', async () => {
  await openVersion(releasedId)
  await openRequirements()
  const p = await scrollGrid(0.8)
  await s.openView('Exigences')
  await expect.poll(() => new URL(s.page.url()).pathname).not.toContain('/version/')
  await startSampling(releasedId)
  await s.openView('Version')
  await expect.poll(() => new URL(s.page.url()).pathname).toContain('/version/')
  await expectRestored(p)
})
