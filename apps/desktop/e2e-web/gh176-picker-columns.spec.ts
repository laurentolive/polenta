import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH176 — colonnes configurables du sélecteur de tests d'une campagne : panneau ⚙️, préférence
 * propre au sélecteur (`picker` / `showFoldersPicker`), indépendante de la Vue Excel
 * (scénarios E1–E10 et L4 de specs/GH176-tests.md). La campagne est créée par IPC, le reste par
 * l'interface ; les préférences sont relues par IPC.
 */
const s = setupSession()

interface TestCaseLike { id: string; objectTypeRef: string }
interface TypeLike { name: string; label?: string; category: string }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface Pref { excel?: string[]; word?: string[]; edit?: string[]; picker?: string[]; showFoldersExcel?: boolean; showFoldersPicker?: boolean }

let typeA: string
let typeB: string | undefined
let tests: TestCaseLike[]
let campaignId: string
let username: string
let linkKey: string
let typeALabel: string
/** Nombre d'en-têtes du sélecteur avec la colonne de liens ajoutée (E1–E4). */
let withLinkHeaders = 0
const EXCEL = ['section', 'name', 'id', 'version']

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

const getPref = (typeRef: string) => s.invoke<Pref | null>('pref:get-field-visibility', s.project.localPath, username, typeRef)
const setPref = (typeRef: string, views: Record<string, unknown>) =>
  s.invoke('pref:set-field-visibility', s.project.localPath, username, typeRef, views)

async function openPicker(p: Page, typeRef: string) {
  await navigate(p, s.projectUrl(`/campaign/${campaignId}`, { repoPath: s.project.localPath }))
  await p.getByText('Ajouter des tests').click()
  await p.locator(`select:has(option[value="${typeRef}"])`).selectOption(typeRef)
  await expect(p.locator('tr', { hasText: tests.find(tc => tc.objectTypeRef === typeRef)!.id })).toBeVisible()
}

async function closePicker(p: Page) {
  await p.keyboard.press('Escape')
  const abandon = p.locator('button.btn-danger', { hasText: 'Abandonner' })
  if (await abandon.isVisible().catch(() => false)) await abandon.click()
  await expect(p.getByTestId('picker-columns-button')).toHaveCount(0)
}

const headers = (p: Page) => p.getByRole('columnheader')

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  username = await s.invoke<string>('auth:project-username', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  tests = await s.invoke<TestCaseLike[]>('tests:list', localPath)
  const testTypes = schema.nodes.flatMap(n => (n.objectTypes ?? [])
    .filter(t => t.category === 'test')
    .map(t => `${n.name}::${t.name}`))
    .filter(ref => tests.some(tc => tc.objectTypeRef === ref))
  test.skip(testTypes.length === 0, 'la démo doit avoir des tests')
  typeA = testTypes[0]!
  const [nodeA, nameA] = typeA.split('::')
  const defA = schema.nodes.find(n => n.name === nodeA)!.objectTypes!.find(t => t.name === nameA)!
  typeALabel = defA.label ?? defA.name
  typeB = testTypes[1]
  // Point de départ connu : Vue Excel sans Statut ni liens, aucun choix propre au sélecteur.
  for (const ref of testTypes) await setPref(ref, { excel: EXCEL, showFoldersExcel: true, picker: null, showFoldersPicker: null })
  const campaign = await s.invoke<{ id: string }>('campaigns:create', localPath, { title: 'GH176 colonnes', testCaseIds: [] }, workspaceDir)
  campaignId = campaign.id
})

test('E1–E4 — panneau ⚙️, colonne ajoutée sans perdre la sélection, retrouvée à la réouverture', async () => {
  const p = s.page
  await openPicker(p, typeA)

  // E1 — colonnes de la Vue Excel + Statut.
  await expect(headers(p).filter({ hasText: /Statut/ })).toHaveCount(1)
  const before = await headers(p).count()

  // E2 — panneau sans onglets, Statut verrouillé.
  await p.getByTestId('picker-columns-button').click()
  const panel = p.getByTestId('field-config-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Tableau' })).toHaveCount(0)
  await expect(panel.getByTestId('field-config-field-status')).toBeChecked()
  await expect(panel.getByTestId('field-config-field-status')).toBeDisabled()
  // Premier type de lien proposé pour ce type de test.
  const linkBox = panel.locator('[data-testid^="field-config-field-link::"]').first()
  linkKey = (await linkBox.getAttribute('data-testid'))!.replace('field-config-field-', '')

  // E3 — sélection conservée quand une colonne est ajoutée.
  await panel.click({ position: { x: 5, y: 5 } }) // clic hors du panneau : fermé
  await expect(panel).toHaveCount(0)
  const first = tests.find(tc => tc.objectTypeRef === typeA)!
  await p.locator('tr', { hasText: first.id }).getByRole('checkbox').click()
  await expect(p.getByText(/1 test sélectionné/)).toBeVisible()
  await p.getByTestId('picker-columns-button').click()
  await p.getByTestId(`field-config-field-${linkKey}`).click()
  await expect.poll(() => headers(p).count()).toBe(before + 1)
  await expect(p.getByText(/1 test sélectionné/)).toBeVisible()
  await s.shot('gh176-e3-colonne-ajoutee')

  // E9 — Échap ferme le panneau seul.
  await p.keyboard.press('Escape')
  await expect(p.getByTestId('field-config-panel')).toHaveCount(0)
  await expect(p.getByTestId('picker-columns-button')).toBeVisible()

  // E4 / CA4 — enregistré dans `picker`, sans Statut (absent de la Vue Excel).
  await expect.poll(async () => (await getPref(typeA))?.picker).toEqual([...EXCEL, linkKey])
  await p.keyboard.press('Escape')
  await expect(p.getByText('Abandonner la sélection ?')).toBeVisible()
  await p.locator('button.btn-danger', { hasText: 'Abandonner' }).click()

  await openPicker(p, typeA)
  await expect(headers(p)).toHaveCount(before + 1)
  withLinkHeaders = before + 1

  // E5 — la Vue Excel n'a pas bougé.
  expect((await getPref(typeA))?.excel).toEqual(EXCEL)
  await closePicker(p)
})

test('E6 — une modification de la Vue Excel conserve les colonnes du sélecteur', async () => {
  const p = s.page
  // Vue Système : ⚙️, onglet Tableau, une colonne de plus.
  await s.openView('Tests')
  const combo = p.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(typeALabel)
  await combo.press('Enter')
  await p.getByTitle('Vue tableau').click()
  await p.waitForLoadState('networkidle')
  await p.getByTitle('Configurer les colonnes').click()
  await p.getByTestId('field-config-field-createdAt').click()
  await p.getByTestId('field-config-panel').click({ position: { x: 5, y: 5 } })
  await expect.poll(async () => (await getPref(typeA))?.excel).toEqual([...EXCEL, 'createdAt'])
  expect((await getPref(typeA))?.picker).toEqual([...EXCEL, linkKey])

  // Le sélecteur garde ses colonnes (cache partagé compris), sans la nouvelle colonne de la Vue Excel.
  await openPicker(p, typeA)
  await expect(headers(p)).toHaveCount(withLinkHeaders)
  await closePicker(p)
  await setPref(typeA, { excel: EXCEL })
})

test('E8 — titres de dossiers propres au sélecteur', async () => {
  const p = s.page
  await openPicker(p, typeA)
  await p.getByTestId('picker-columns-button').click()
  await p.getByTestId('field-config-show-folders').click()
  await expect.poll(async () => (await getPref(typeA))?.showFoldersPicker).toBe(false)
  expect((await getPref(typeA))?.showFoldersExcel).toBe(true)
  await p.keyboard.press('Escape')
  await closePicker(p)
})

test('E7 — Réinitialiser revient aux colonnes de la Vue Excel', async () => {
  const p = s.page
  await openPicker(p, typeA)
  await p.getByTestId('picker-columns-button').click()
  await p.getByTestId('field-config-reset').click()
  await expect.poll(async () => {
    const pref = await getPref(typeA)
    return [pref?.picker, pref?.showFoldersPicker]
  }).toEqual([undefined, undefined])
  expect((await getPref(typeA))?.excel).toEqual(EXCEL)
  await p.keyboard.press('Escape')
  // Vue Excel (4 colonnes) + Statut, sans la colonne de liens.
  await expect(headers(p).filter({ hasText: /Statut/ })).toHaveCount(1)
  await closePicker(p)
})

test('L4 — Statut reste affiché quand tout le reste est décoché', async () => {
  const p = s.page
  await openPicker(p, typeA)
  await p.getByTestId('picker-columns-button').click()
  for (const f of EXCEL) await p.getByTestId(`field-config-field-${f}`).click()
  await expect.poll(async () => (await getPref(typeA))?.picker).toEqual([])
  await expect(headers(p).filter({ hasText: /Statut/ })).toHaveCount(1)
  await p.getByTestId('field-config-reset').click()
  await p.keyboard.press('Escape')
  await closePicker(p)
})

test('E10 — un choix sur un type n\'affecte pas un autre type ; le panneau se ferme au changement de type', async () => {
  test.skip(!typeB, 'la démo doit avoir deux types de test')
  const p = s.page
  await openPicker(p, typeA)
  await p.getByTestId('picker-columns-button').click()
  await p.getByTestId(`field-config-field-${linkKey}`).click()
  await expect.poll(async () => (await getPref(typeA))?.picker).toEqual([...EXCEL, linkKey])
  await p.keyboard.press('Escape')
  await p.getByTestId('picker-columns-button').click()
  await p.locator(`select:has(option[value="${typeB}"])`).selectOption(typeB!)
  await expect(p.getByTestId('field-config-panel')).toHaveCount(0)
  expect((await getPref(typeB!))?.picker).toBeUndefined()
  await closePicker(p)
  await setPref(typeA, { picker: null })
})
