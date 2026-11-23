import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { typeOfCategory } from './support/demo-types'

/**
 * GH425 — la vue Validation retrouve la même validation, chargée à la même position, au retour :
 * barre d'activité, onglet, Précédent, arbre du panneau. Le défilement de la grille reprend la mémoire
 * de GH300 (`DataGrid`, clé onglet + page) ; la barre d'activité doit rouvrir la validation quittée.
 */
const s = setupSession()

interface TypeLike { name: string; label: string; prefix: string; category: string; fields: unknown[]; statuses?: unknown[]; decisions?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }

const REQ_COUNT = 40
const TITLE = 'GH425 validation'
const repo = () => s.project.localPath
const ws = () => s.project.workspaceDir
let versionId = ''

test.beforeAll(async () => {
  await s.invoke('schema:invalidate', repo())
  const schema = await s.invoke<SchemaLike>('schema:get', repo())
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []),
    { name: 'gh425_req', label: 'GH425 Exigence', prefix: 'GHR', category: 'requirement', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }] },
  ]
  typeOfCategory(root, 'version', {
    name: 'gh425_version', label: 'Version', prefix: 'GHX', category: 'version', fields: [],
    statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }],
  })
  typeOfCategory(root, 'validation', {
    name: 'gh425_validation', label: 'Validation', prefix: 'GHY', category: 'validation', fields: [],
    statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'signee', label: 'Signée', isApproval: true }, { name: 'annulee', label: 'Annulée', isTerminal: true }],
    decisions: [{ name: 'en_attente', label: 'En attente', isPending: true }, { name: 'conforme', label: 'Conforme' }, { name: 'non_conforme', label: 'Non conforme', proposesIssue: true }],
  })
  await s.invoke('schema:save', repo(), schema)
  const ids: string[] = []
  for (let i = 1; i <= REQ_COUNT; i++) {
    ids.push((await s.invoke<{ id: string }>('requirements:create', repo(), { objectTypeRef: 'root::gh425_req', title: `GH425 exigence ${i}`, fields: {} }, ws())).id)
  }
  versionId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: 'GH425' }, ws())).id
  await s.invoke('versions:include', repo(), versionId, ids, ws())
  await s.invoke('validations:create', repo(), { versionId, title: TITLE, fields: {} }, ws())
})

test.beforeEach(async () => {
  // Fenêtre basse : la grille de la validation défile dans les deux sens (cf. GH300).
  await s.page.setViewportSize({ width: 1000, height: 420 })
})

const scroller = () => s.page.locator('[data-view-scroll]')
const tabs = () => s.page.getByTestId('tab')
const validationPage = () => s.page.getByTestId('validation-page')
const currentId = () => /\/validation\/([^/?]+)/.exec(s.page.url())?.[1] ?? ''

/** Position visible : premier nœud qui coupe le haut de la zone, son décalage, défilement horizontal. */
interface Visible { node: string; offset: number; left: number }

function readVisible(el: HTMLElement): Visible {
  const area = el.getBoundingClientRect()
  for (const row of el.querySelectorAll<HTMLElement>('[data-node-id]')) {
    const r = row.getBoundingClientRect()
    if (r.height === 0 || r.bottom <= area.top) continue
    return { node: row.dataset.nodeId!, offset: Math.round(r.top - area.top), left: Math.round(el.scrollLeft) }
  }
  return { node: '', offset: 0, left: Math.round(el.scrollLeft) }
}

const position = () => scroller().evaluate(readVisible)
const same = (a: Visible, b: Visible) => a.node === b.node && Math.abs(a.offset - b.offset) <= 2 && Math.abs(a.left - b.left) <= 2

async function scrollTo(top: number, left = 0): Promise<Visible> {
  await scroller().evaluate((el, [t, l]) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) * t
    el.scrollLeft = (el.scrollWidth - el.clientWidth) * l
  }, [top, left])
  await s.page.waitForTimeout(400)
  return position()
}

/** Même validation (URL, page, titre) et même position de grille. */
async function expectSameValidation(id: string, expected: Visible) {
  await expect(s.page).toHaveURL(new RegExp(`/validation/${id}`))
  await expect(validationPage()).toBeVisible()
  await expect(validationPage()).toContainText(TITLE)
  await expect(scroller()).toBeVisible()
  await expect.poll(async () => { const p = await position(); return same(p, expected) ? 'ok' : JSON.stringify(p) }, { message: `position attendue ${JSON.stringify(expected)}` }).toBe('ok')
  // Pas de recalage tardif (rendu complet des lignes, ancrage…).
  await s.page.waitForTimeout(500)
  expect(same(await position(), expected)).toBe(true)
}

/** Échantillonne la position visible à chaque frame (installé avant le retour). */
async function startSampling() {
  await s.page.evaluate(`(() => {
    const readVisible = ${readVisible.toString()}
    window.__gh425 = []
    const start = performance.now()
    const tick = () => {
      const el = document.querySelector('[data-view-scroll]')
      // Seulement une page de validation avec des lignes rendues.
      if (location.pathname.startsWith('/validation/') && el && el.querySelector('[data-node-id]')) window.__gh425.push(readVisible(el))
      if (performance.now() - start < 2500) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })()`)
}

/** Aucune frame peinte à une autre position que `expected` (pas d'à-coup). */
async function expectNoGlitch(expected: Visible) {
  await s.page.waitForTimeout(2600)
  const samples = await s.page.evaluate(() => (window as unknown as { __gh425: Visible[] }).__gh425)
  expect(samples.length).toBeGreaterThan(0)
  const off = samples.filter(p => !same(p, expected))
  expect(off, `frames hors position ${JSON.stringify(expected)} : ${JSON.stringify(off.slice(0, 5))}`).toEqual([])
}

/** Ouvre la validation depuis le panneau Validation (ligne de la version). */
async function openValidation(): Promise<string> {
  await s.openView('Validation')
  await s.page.getByTestId(`validation-version-${versionId}`).click({ position: { x: 20, y: 5 } })
  await expect(validationPage()).toBeVisible()
  await expect(scroller()).toBeVisible()
  const id = currentId()
  expect(id).toBeTruthy()
  return id
}

test('G1 — barre d\'activité : même validation, même position au retour, sans à-coup', async () => {
  const id = await openValidation()
  const p = await scrollTo(0.6, 0.3)
  expect(p.node).toBeTruthy()
  await s.openView('Exigences')
  await expect(validationPage()).toHaveCount(0)
  await startSampling()
  await s.openView('Validation')
  await expectSameValidation(id, p)
  await expectNoGlitch(p)
})

test('G2 — onglet : même validation, même position au retour sur l\'onglet', async () => {
  const id = await openValidation()
  const p = await scrollTo(0.6, 0.3)
  const count = await tabs().count()
  // Onglet de départ = onglet actif (fond `bg-canvas`).
  const start = (await tabs().evaluateAll(els => els.map(el => el.classList.contains('bg-canvas')))).indexOf(true)
  expect(start).toBeGreaterThanOrEqual(0)
  await s.page.getByTitle('Nouvel onglet (Ctrl+T)').click()
  await expect(tabs()).toHaveCount(count + 1)
  await s.openView('Tests')
  await tabs().nth(start).click()
  await expectSameValidation(id, p)
})

test('G3 — Précédent : même validation, même position', async () => {
  const id = await openValidation()
  const p = await scrollTo(0.6, 0.3)
  await s.openView('Exigences')
  await expect(validationPage()).toHaveCount(0)
  await s.page.getByTestId('history-back').click()
  await expectSameValidation(id, p)
})

test('G4 — arbre du panneau : même validation, même position après une autre vue', async () => {
  const id = await openValidation()
  const p = await scrollTo(0.6, 0.3)
  await s.openView('Exigences')
  await expect(validationPage()).toHaveCount(0)
  await openValidation()
  await expectSameValidation(id, p)
})
