import * as fs from 'fs'
import * as path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { setupSession, projectIdOf } from './support/session'

/**
 * GH342 — même élément édité dans deux onglets (= deux fenêtres) : seuls les champs modifiés sont
 * envoyés, et un champ en cours de saisie changé ailleurs affiche un bandeau « Recharger » /
 * « Garder ma saisie » (specs/GH342-tests.md C2–C7).
 */
const s = setupSession()

interface Obj { id: string; status: string; title: string; objectTypeRef: string }

let a: Page
let b: Page
let reqId: string
let reqTypeRef: string
let testId: string

const titleInput = (p: Page) => p.locator('main input.input-field[type="text"]:not([readonly])').first()
const banner = (p: Page) => p.getByTestId('external-change-banner')
const dirtyDot = (p: Page) => p.getByTestId('tab').first().locator('span.rounded-full')
const save = (p: Page) => p.getByRole('button', { name: 'Sauvegarder' }).click()
const fileOf = (dir: string, id: string) => fs.readFileSync(path.join(s.project.localPath, dir, `${id}.yaml`), 'utf8')

function route(kind: 'req' | 'test', id: string): string {
  return `/${kind}/${id}?${new URLSearchParams({ repoPath: s.project.localPath, projectId: projectIdOf(s.project.workspaceDir) })}`
}

async function openBoth(url: string): Promise<void> {
  for (const p of [a, b]) {
    await p.goto(url)
    await p.waitForLoadState('networkidle')
    await expect(titleInput(p)).toBeVisible()
  }
}

test.beforeAll(async () => {
  const reqs = await s.invoke<Obj[]>('requirements:list', s.project.localPath)
  const req = reqs.find(r => r.status === 'draft') ?? reqs[0]
  reqId = req.id
  reqTypeRef = req.objectTypeRef
  const tests = await s.invoke<Obj[]>('tests:list', s.project.localPath)
  testId = (tests.find(t => t.status === 'draft') ?? tests[0]).id
  a = await s.context.newPage()
  b = await s.context.newPage()
})

test.afterAll(async () => {
  await a?.close()
  await b?.close()
})

test('C5 — titre changé ailleurs, non saisi ici : mis à jour sans bandeau', async () => {
  await openBoth(route('req', reqId))
  await titleInput(a).fill('C5 — titre depuis A')
  await save(a)
  await expect(titleInput(b)).toHaveValue('C5 — titre depuis A')
  await expect(banner(b)).toBeHidden()
  await expect(dirtyDot(b)).toBeHidden()
})

test('C3 — même champ en cours de saisie ici : bandeau, « Recharger » affiche la valeur d’ailleurs', async () => {
  await titleInput(b).fill('C3 — saisie de B')
  await titleInput(a).fill('C3 — valeur de A')
  await save(a)
  await expect(banner(b)).toBeVisible()
  await expect(banner(b)).toContainText('Titre')
  await expect(titleInput(b)).toHaveValue('C3 — saisie de B')   // pas écrasée en silence
  await banner(b).getByRole('button', { name: 'Recharger' }).click()
  await expect(titleInput(b)).toHaveValue('C3 — valeur de A')
  await expect(banner(b)).toBeHidden()
  await expect(dirtyDot(b)).toBeHidden()
})

test('C4 — « Garder ma saisie » puis Sauvegarder : la saisie l’emporte', async () => {
  await titleInput(b).fill('C4 — saisie de B')
  await titleInput(a).fill('C4 — valeur de A')
  await save(a)
  await expect(banner(b)).toBeVisible()
  await banner(b).getByRole('button', { name: 'Garder ma saisie' }).click()
  await expect(banner(b)).toBeHidden()
  await save(b)
  await expect.poll(() => fileOf('requirements', reqId)).toContain('C4 — saisie de B')
  await expect(titleInput(a)).toHaveValue('C4 — saisie de B')
  await expect(banner(a)).toBeHidden()
})

test('C2/C6 — page test : champs différents modifiés dans chaque onglet, les deux conservés', async () => {
  await openBoth(route('test', testId))
  const pre = (p: Page) => p.locator('main textarea').first()
  await pre(b).fill('C2 — préconditions de B')
  await titleInput(a).fill('C2 — titre de A')
  await save(a)
  await expect.poll(() => fileOf('tests', testId)).toContain('C2 — titre de A')
  await expect(titleInput(b)).toHaveValue('C2 — titre de A')   // adopté : pas en saisie ici
  await expect(banner(b)).toBeHidden()
  await save(b)
  await expect.poll(() => fileOf('tests', testId)).toContain('C2 — préconditions de B')
  expect(fileOf('tests', testId)).toContain('C2 — titre de A')
})

test('C7 — vue Édition : champ en cours de saisie modifié ailleurs → bandeau, « Recharger »', async () => {
  const [node, type] = reqTypeRef.split('::')
  const docUrl = `/product?${new URLSearchParams({ projectId: projectIdOf(s.project.workspaceDir), node, type, view: 'word' })}`
  await b.goto(docUrl)
  await b.waitForLoadState('networkidle')
  // Vue Document → « Éditer » sur le premier bloc donne l'URL de la vue Édition ; même URL pour
  // l'exigence en brouillon (la vue Document ne rend ses blocs qu'au défilement).
  await b.locator('[data-node-id]').getByTitle('Éditer').first().click()
  await expect.poll(() => new URL(b.url()).searchParams.get('view')).toBe('edit')
  const editUrl = new URL(b.url())
  editUrl.searchParams.set('node', node)
  editUrl.searchParams.set('type', type)
  editUrl.searchParams.set('item', reqId)
  await b.goto(editUrl.pathname + editUrl.search)
  await b.waitForLoadState('networkidle')
  // Champ texte simple du type (« Débit (L/min) » dans la démo) : saisie en cours, pas encore quittée.
  interface SchemaNode { name: string; children?: SchemaNode[]; objectTypes?: { name: string; fields: { name: string; label?: string }[] }[] }
  const schema = await s.invoke<{ nodes: SchemaNode[] }>('schema:get', s.project.localPath)
  const flat = (nodes: SchemaNode[]): SchemaNode[] => nodes.flatMap(n => [n, ...flat(n.children ?? [])])
  const typeDef = flat(schema.nodes).find(n => n.name === node)?.objectTypes?.find(t => t.name === type)
  const field = typeDef?.fields.find(f => f.label?.startsWith('Débit'))
  expect(field).toBeDefined()
  const input = b.locator('div.flex.flex-col.gap-1', { has: b.locator('label', { hasText: field!.label! }) }).locator('input').first()
  await expect(input).toBeVisible()
  await input.click()
  await b.keyboard.type('42')

  // Modification faite ailleurs (autre fenêtre, MCP…) du même champ.
  await s.invoke('requirements:update', s.project.localPath, reqId, { fields: { [field!.name]: '17' } })

  await expect(banner(b)).toBeVisible()
  await expect(banner(b)).toContainText(field!.label!)
  await expect(input).toHaveValue('42')   // pas écrasée en silence
  await banner(b).getByRole('button', { name: 'Recharger' }).click()
  await expect(input).toHaveValue('17')
  await expect(banner(b)).toBeHidden()
})
