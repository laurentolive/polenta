import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH352 — Modèle de données : sélectionner le nom d'un type à la souris et relâcher le bouton
 * en dehors de la popup ne la ferme plus. Un clic franc sur le fond la ferme toujours.
 * Un type dédié (préfixe GHZ) est créé par le test.
 */
const s = setupSession()

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: Array<{ name: string }> }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }

const TYPE_NAME = 'gh352_drag_select'
const TYPE_LABEL = 'GH352 Glisser'
const modalMarker = () => s.page.getByText('Historiser le statut')

async function openElementModal() {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/schema', { repoPath: s.project.localPath }))
  await s.page.waitForLoadState('networkidle')
  await s.page.getByRole('button', { name: new RegExp(TYPE_LABEL) }).first().click()
  await expect(modalMarker()).toBeVisible()
}

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const current = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = current.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: TYPE_NAME, label: TYPE_LABEL, prefix: 'GHZ', category: 'requirement',
    fields: [], statuses: [{ name: 'draft' }],
  }]
  await s.invoke('schema:save', localPath, current)
})

test('sélection commencée dans le champ nom, relâchée sur le fond : la popup reste ouverte', async () => {
  await openElementModal()
  const nameInput = s.page.locator(`input[value="${TYPE_NAME}"]`).first()
  const box = (await nameInput.boundingBox())!
  // Appui à droite du texte, glissé vers la gauche jusqu'au coin de la fenêtre (le fond), relâché.
  await s.page.mouse.move(box.x + box.width - 4, box.y + box.height / 2)
  await s.page.mouse.down()
  await s.page.mouse.move(box.x + 2, box.y + box.height / 2, { steps: 5 })
  await s.page.mouse.move(4, 4, { steps: 5 })
  await s.page.mouse.up()

  await expect(modalMarker()).toBeVisible()
  await expect(nameInput).toHaveValue(TYPE_NAME)
  // la sélection a bien eu lieu : le geste testé est celui du rapport
  expect(await nameInput.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0))).toBeGreaterThan(0)
  await s.shot('gh352-drag-select')

  // Clic franc sur le fond : la popup se ferme toujours.
  await s.page.mouse.click(4, 4)
  await expect(modalMarker()).toBeHidden()
})

test('appui sur le fond, relâché dans la popup : la popup reste ouverte', async () => {
  await openElementModal()
  const box = (await s.page.locator(`input[value="${TYPE_NAME}"]`).first().boundingBox())!
  await s.page.mouse.move(4, 4)
  await s.page.mouse.down()
  await s.page.mouse.move(box.x + 4, box.y + box.height / 2, { steps: 5 })
  await s.page.mouse.up()
  await expect(modalMarker()).toBeVisible()

  await s.page.mouse.click(4, 4)
  await expect(modalMarker()).toBeHidden()
})
