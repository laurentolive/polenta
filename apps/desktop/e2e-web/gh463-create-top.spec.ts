import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH463 — « + Nouvel élément » en tête d'arbre : l'élément créé entre en tête de liste, son titre est
 * en édition dans l'arbre, et il est sélectionné et montré dans la vue de droite (Tableau, Document)
 * tout de suite. Les filtres (global et de colonne) sont effacés pour qu'il soit visible. Les autres
 * points d'entrée de création (clic droit dans le vide) ne changent pas. Type et exigences créés par IPC.
 */
const s = setupSession()

const TYPE = 'gh463_req'
const LABEL = 'GH463 Exigence'
const REF = `root::${TYPE}`
const COUNT = 60
const titleOf = (n: number) => `GH463 ligne ${String(n).padStart(2, '0')}`
const NEW_TITLE = 'GH463 créé'

const sidebar = () => s.page.getByTestId('sidebar')
const newButton = () => sidebar().getByRole('button', { name: 'Nouvel élément', exact: true })
const createItemEntry = () => s.page.getByRole('button', { name: 'Créer un élément', exact: true })
const filterInput = () => sidebar().getByPlaceholder('Filtrer…')
// Tableau et Document défilent dans le même conteneur (`data-view-scroll`).
const scroller = () => s.page.locator('[data-view-scroll]')
const tableView = () => s.page.getByTitle('Vue tableau')
const documentView = () => s.page.getByTitle('Vue document')

async function selectType() {
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(LABEL)
  await combo.press('Enter')
  await expect(sidebar().getByText(titleOf(1), { exact: true })).toBeVisible()
}

/** Fait défiler tous les conteneurs défilants de la barre latérale jusqu'en bas (arbre long). */
async function scrollTreeToEnd() {
  await s.page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="sidebar"] *'))) {
      if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight
    }
  })
}

async function scrollViewToEnd() {
  await scroller().evaluate(el => { el.scrollTop = el.scrollHeight })
}

/** « + Nouvel élément » (tête d'arbre) puis « Créer un élément » : deux clics souris. */
async function createFromTop() {
  await newButton().click()
  await createItemEntry().click()
}

/**
 * Suit, à chaque frame pendant `ms`, si la ligne sélectionnée de la vue est visible. `flipped` = elle a
 * été visible puis est sortie de la zone : un recalage tardif ou un défilement qui revient en arrière.
 */
function watchSelectedRow(ms: number) {
  return s.page.evaluate((duration: number) => new Promise<{ seen: boolean; flipped: boolean }>(resolve => {
    const out = { seen: false, flipped: false }
    const start = performance.now()
    const frame = () => {
      const area = document.querySelector<HTMLElement>('[data-view-scroll]')
      const row = area?.querySelector<HTMLElement>('[data-node-id][data-selected]')
      let inView = false
      if (area && row) {
        const a = area.getBoundingClientRect()
        const r = row.getBoundingClientRect()
        inView = r.bottom > a.top + 1 && r.top < a.bottom - 1
      }
      if (inView) out.seen = true
      else if (out.seen) out.flipped = true
      if (performance.now() - start < duration) requestAnimationFrame(frame)
      else resolve(out)
    }
    frame()
  }), ms)
}

test.beforeAll(async () => {
  const { localPath } = s.project
  const schema = await s.invoke<{ nodes: Array<{ name: string; objectTypes?: unknown[] }> }>('schema:get', localPath)
  schema.nodes.find(n => n.name === 'root')!.objectTypes!.push({
    name: TYPE, label: LABEL, prefix: 'GH463', category: 'requirement', fields: [],
    statuses: [
      { name: 'draft', label: 'Brouillon' },
      { name: 'obsolete', label: 'Obsolète', isTerminal: true },
    ],
  })
  await s.invoke('schema:save', localPath, schema)
  for (let n = 1; n <= COUNT; n++) {
    await s.invoke('requirements:create', localPath, { objectTypeRef: REF, title: titleOf(n), fields: {} })
  }
})

test('GH463 — tête d’arbre : bouton visible en bas de liste, titre en édition, ligne sélectionnée dans le Tableau', async () => {
  await selectType()
  await scrollTreeToEnd()
  await scrollViewToEnd()
  // Le bouton reste accessible alors que l'arbre est défilé jusqu'en bas (collé en tête).
  await expect(newButton()).toBeInViewport()

  const watching = watchSelectedRow(2000)
  await createFromTop()
  const result = await watching
  // Pendant la révélation, la ligne apparaît puis reste visible : pas de recalage en arrière.
  expect(result.seen).toBe(true)
  expect(result.flipped).toBe(false)

  const selected = scroller().locator('[data-node-id][data-selected]')
  await expect(selected).toHaveCount(1)
  await expect(selected).toBeInViewport()

  // Le titre du nouvel élément est en édition dans l'arbre, et le garde après la révélation.
  const rename = sidebar().locator('input:focus')
  await expect(rename).toHaveCount(1)
  await s.page.waitForTimeout(500)
  await expect(rename).toHaveCount(1)

  // En tête de liste : remonté en haut de la vue, la ligne est la première.
  await scroller().evaluate(el => { el.scrollTop = 0 })
  const id = await selected.getAttribute('data-node-id')
  await expect(scroller().locator('[data-node-id]').first()).toHaveAttribute('data-node-id', id!)

  // Saisie du titre dans le champ en édition : la ligne du Tableau le reprend.
  await s.page.keyboard.type(NEW_TITLE)
  await s.page.keyboard.press('Enter')
  await expect(scroller().locator(`[data-node-id="${id}"]`)).toContainText(NEW_TITLE)
})

test('GH463 — vue Document : l’élément créé est sélectionné et visible', async () => {
  await documentView().click()
  await scrollTreeToEnd()
  await createFromTop()
  // Le Document marque la cible du « goto » par un contour (classe ring-2) sur la carte.
  const target = scroller().locator('[data-node-id].ring-2')
  await expect(target).toHaveCount(1)
  await expect(target).toBeInViewport()

  // Retour au Tableau : la ligne sélectionnée est toujours visible.
  await tableView().click()
  await expect(scroller().locator('[data-node-id][data-selected]')).toBeInViewport()
})

test('GH463 — filtre global actif : effacé à la création, le nouvel élément est visible', async () => {
  await tableView().click()
  await filterInput().fill(titleOf(1))
  await expect(sidebar().getByText(titleOf(2), { exact: true })).toHaveCount(0)

  await createFromTop()
  await expect(filterInput()).toHaveValue('')
  await expect(scroller().locator('[data-node-id][data-selected]')).toBeInViewport()
})

test('GH463 — filtre de colonne actif : effacé à la création, le nouvel élément est visible', async () => {
  await tableView().click()
  // Filtre de colonne qui n'exclut que la nouvelle ligne et les autres : aucune ligne visible.
  await scroller().locator('[data-node-id]').first().waitFor()
  // Icône du filtre de la colonne « Label » (la première du DOM, dans la colonne figée, est recouverte).
  await s.page.locator('th[data-col]').filter({ hasText: 'Label' }).locator('[data-column-filter-icon]').click()
  await s.page.locator('[data-column-filter-popover] input').fill('zzz-aucune-correspondance')
  await expect(scroller().locator('[data-node-id]')).toHaveCount(0)

  // Le popover se ferme au clic dans l'arbre (mousedown hors popover) : le filtre reste actif.
  await createFromTop()
  await expect(s.page.locator('[data-column-filter-icon][data-active]')).toHaveCount(0)
  await expect(scroller().locator('[data-node-id][data-selected]')).toBeInViewport()
})

test('GH463 — clic droit dans le vide (hors bouton de tête) : le filtre global reste en place', async () => {
  await tableView().click()
  await filterInput().fill(titleOf(2))
  await expect(sidebar().getByText(titleOf(3), { exact: true })).toHaveCount(0)

  // Zone vide sous les éléments de l'arbre : menu « Créer un élément » sans révélation.
  await scrollTreeToEnd()
  await sidebar().locator('.min-h-12').last().click({ button: 'right' })
  await createItemEntry().click()
  await expect(filterInput()).toHaveValue(titleOf(2))
})

test('GH463 — vue Édition : l’objet créé s’ouvre (inchangé)', async () => {
  await tableView().click()
  // Le test précédent a laissé son filtre global : on le retire pour retrouver la ligne.
  await filterInput().fill('')
  await sidebar().getByText(titleOf(3), { exact: true }).dblclick()
  await expect.poll(() => new URL(s.page.url()).searchParams.get('view')).toBe('edit')

  await scrollTreeToEnd()
  await createFromTop()
  await expect.poll(() => new URL(s.page.url()).searchParams.get('item')).not.toBeNull()
  await expect.poll(() => new URL(s.page.url()).searchParams.get('view')).toBe('edit')
})
