import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH82 — renommer un statut ou une valeur d'enum dans l'onglet Structure : confirmation (nombre
 * d'objets, collision, lignes décochables), migration des objets. Scénarios E1–E4 de
 * specs/GH82-tests.md. Un type dédié (préfixe GHV) et ses exigences sont créés par le test (IPC).
 */
const s = setupSession()

interface FieldLike { name: string; type: string; values?: string[] }
interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: FieldLike[]; statuses?: Array<{ name: string }> }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface ReqLike { id: string; status: string; fields: Record<string, unknown> }

const TYPE_NAME = 'gh82_val'
const TYPE_LABEL = 'GH82 Valeurs'
const REF = `root::${TYPE_NAME}`
let reqA: string, reqB: string, reqC: string

const schema = () => s.invoke<SchemaLike>('schema:get', s.project.localPath)
const ourType = async () => (await schema()).nodes.find(n => n.name === 'root')!.objectTypes!.find(t => t.name === TYPE_NAME)!
const getReq = (id: string) => s.invoke<ReqLike>('requirements:get', s.project.localPath, id)
const confirmDialog = () => s.page.getByRole('dialog', { name: 'Renommer des valeurs ?' })

async function openElementModal() {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/schema', { repoPath: s.project.localPath }))
  await s.page.waitForLoadState('networkidle')
  await s.page.getByRole('button', { name: new RegExp(TYPE_LABEL) }).first().click()
  await expect(s.page.getByText('Historiser le statut')).toBeVisible()
}

const statusInput = (name: string) => s.page.locator(`input[value="${name}"]`).first()
const valuesInput = () => s.page.locator('tr').filter({ has: s.page.locator('input[value="niveau"]') }).locator('input').nth(2)

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const current = await schema()
  const root = current.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: TYPE_NAME, label: TYPE_LABEL, prefix: 'GHV', category: 'requirement',
    fields: [{ name: 'niveau', type: 'enum', values: ['bas', 'moyen', 'haut'] }],
    statuses: [{ name: 'draft' }, { name: 'review' }, { name: 'approved' }],
  }]
  await s.invoke('schema:save', localPath, current)
  reqA = (await s.invoke<ReqLike>('requirements:create', localPath, { objectTypeRef: REF, title: 'GH82 A', fields: { niveau: 'bas' } })).id
  reqB = (await s.invoke<ReqLike>('requirements:create', localPath, { objectTypeRef: REF, title: 'GH82 B', fields: { niveau: 'haut' } })).id
  // Valeur orpheline (retirée de la liste, encore portée) : sert au cas de collision.
  reqC = (await s.invoke<ReqLike>('requirements:create', localPath, { objectTypeRef: REF, title: 'GH82 C', fields: { niveau: 'ancien' } })).id
  await s.invoke('requirements:transition', localPath, reqA, { toStatus: 'review' })
})

test('E3 — Annuler dans la confirmation : rien n\'est enregistré, l\'édition reste ouverte', async () => {
  await openElementModal()
  await statusInput('review').fill('en-revue')
  await s.page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(confirmDialog()).toBeVisible()
  await confirmDialog().getByRole('button', { name: 'Annuler' }).click()
  await expect(confirmDialog()).toBeHidden()
  await expect(s.page.getByText('Historiser le statut')).toBeVisible()
  expect((await ourType()).statuses!.map(st => st.name)).toEqual(['draft', 'review', 'approved'])
  await s.page.keyboard.press('Escape')
  const cancel = s.page.getByRole('button', { name: 'Oui, annuler' })
  if (await cancel.isVisible()) await cancel.click()
})

test('E1 — renommer un statut : confirmation avec le nombre d\'objets, migration, compte rendu', async () => {
  await openElementModal()
  await statusInput('review').fill('en-revue')
  await s.page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(confirmDialog()).toContainText('review → en-revue')
  await expect(confirmDialog()).toContainText('1 objet(s) concerné(s)')
  await expect(confirmDialog()).toContainText('Les requêtes et dashboards du Suivi ne sont pas modifiés.')
  await confirmDialog().getByRole('button', { name: 'Enregistrer et migrer' }).click()
  await expect(s.page.getByRole('status').filter({ hasText: 'migré' })).toContainText('1 objet(s) migré(s)')
  expect((await getReq(reqA)).status).toBe('en-revue')
  expect((await ourType()).statuses!.map(st => st.name)).toEqual(['draft', 'en-revue', 'approved'])
})

test('E2/E4 — deux valeurs renommées, une décochée ; collision signalée', async () => {
  await openElementModal()
  // `moyen` → `ancien` (valeur orpheline portée par C : collision) et `haut` → `eleve`.
  await valuesInput().fill('bas, ancien, eleve')
  await s.page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(confirmDialog()).toContainText('moyen → ancien')
  await expect(confirmDialog()).toContainText('haut → eleve')
  await expect(confirmDialog()).toContainText('portent déjà « ancien »')
  // Décocher `moyen → ancien` : seule `haut → eleve` est migrée.
  await confirmDialog().getByRole('checkbox').first().uncheck()
  await confirmDialog().getByRole('button', { name: 'Enregistrer et migrer' }).click()
  await expect(s.page.getByRole('status').filter({ hasText: 'migré' })).toBeVisible()

  expect((await getReq(reqB)).fields.niveau).toBe('eleve')
  expect((await getReq(reqA)).fields.niveau).toBe('bas')
  expect((await getReq(reqC)).fields.niveau).toBe('ancien')
  expect((await ourType()).fields[0].values).toEqual(['bas', 'ancien', 'eleve'])
})

test('réordonner les valeurs : aucune confirmation, rien n\'est migré', async () => {
  await openElementModal()
  await valuesInput().fill('eleve, ancien, bas')
  await s.page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(s.page.getByText('Historiser le statut')).toBeHidden()
  await expect(confirmDialog()).toBeHidden()
  expect((await getReq(reqB)).fields.niveau).toBe('eleve')
  expect((await getReq(reqA)).fields.niveau).toBe('bas')
})
