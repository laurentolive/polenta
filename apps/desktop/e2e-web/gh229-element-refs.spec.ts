import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH229 — liens d'élément hors colonnes de liens : ID écrits dans un richtext (N9, L4), ID d'une
 * campagne (N8), ID affiché configuré dans le modèle de données (N7). specs/GH229-tests.md.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface Field { name: string; type: string }
interface ObjType { name: string; category: string; fields: Field[]; displayIdField?: string }
interface SNode { name: string; objectTypes?: ObjType[]; children?: SNode[] }
interface Schema { nodes: SNode[] }

const param = (name: string) => new URL(s.page.url()).searchParams.get(name)
const preview = () => s.page.getByTestId('element-preview')

async function goto(url: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await s.page.waitForLoadState('networkidle')
}

function typeOf(schema: Schema, ref: string): ObjType {
  const [node, type] = ref.split('::')
  const walk = (nodes: SNode[]): ObjType | undefined => {
    for (const n of nodes) {
      if (n.name === node) return n.objectTypes?.find(t => t.name === type)
      const hit = n.children && walk(n.children)
      if (hit) return hit
    }
  }
  return walk(schema.nodes)!
}

test('N9 / L4 — ID écrit dans un richtext : lien avec aperçu, ID inexistant en texte', async () => {
  const repo = s.project.localPath
  const schema = await s.invoke<Schema>('schema:get', repo)
  const reqs = await s.invoke<Array<{ id: string; objectTypeRef: string; fields: Record<string, unknown> }>>('requirements:list', repo, {})
  const tests = await s.invoke<Array<{ id: string }>>('tests:list', repo)
  const target = tests[0].id

  // Exigence de la première carte du Document affiché, champ richtext de son type.
  await s.openView('Exigences')
  await s.page.getByTitle('Vue document').click()
  await s.page.waitForLoadState('networkidle')
  await expect(s.page.locator('[data-node-id]').first()).toBeVisible()
  const shownType = `${param('node')}::${param('type')}`
  const req = reqs.find(r => r.objectTypeRef === shownType)!
  const field = typeOf(schema, req.objectTypeRef).fields.find(f => f.type === 'richtext')!.name
  await s.invoke('requirements:update', repo, req.id, { fields: { ...req.fields, [field]: `Voir ${target} et ZZZ-9999.` } })

  const ref = s.page.locator(`[data-node-id] [data-element-ref="${target}"]`).first()
  await ref.scrollIntoViewIfNeeded()
  await expect(ref).toBeVisible()
  await expect(s.page.locator('[data-element-ref="ZZZ-9999"]')).toHaveCount(0)

  await ref.hover()
  await expect(preview()).toBeVisible({ timeout: 2_000 })
  await expect(preview().getByTestId('element-preview-id')).toHaveText(target)
  await s.shot('gh229-n9-text-preview')

  await ref.click()
  await expect.poll(() => param('item')).toBe(target)
  expect(param('view')).toBe('word')
  expect(param('category')).toBe('test')
})

test('N8 — campagne : l\'ID d\'un test ouvre la vue système sur le test', async () => {
  const repo = s.project.localPath
  const campaigns = await s.invoke<Array<{ id: string; testCaseIds: string[]; runs: Array<{ testCaseId: string }> }>>('campaigns:list', repo)
  const campaign = campaigns.find(c => c.runs.length > 0)
  test.skip(!campaign, 'démo sans campagne exécutée')
  const tcId = campaign!.runs[0].testCaseId
  await goto(s.projectUrl(`/campaign/${campaign!.id}`, { repoPath: repo }))
  const link = s.page.locator(`[data-element-link="${tcId}"]`).first()
  await expect(link).toBeVisible()

  await link.click()
  await expect.poll(() => new URL(s.page.url()).pathname).toMatch(/\/product$/)
  expect(param('item')).toBe(tcId)
  expect(param('category')).toBe('test')
})

test('N7 — displayIdField: title : les liens affichent le titre, l\'ID reste en colonne ID', async () => {
  const repo = s.project.localPath
  const schema = await s.invoke<Schema>('schema:get', repo)
  const tests = await s.invoke<Array<{ id: string; title: string; objectTypeRef: string }>>('tests:list', repo)
  const byId = new Map(tests.map(t => [t.id, t]))

  // Premier test lié depuis le Document affiché.
  await s.openView('Exigences')
  await s.page.getByTitle('Vue document').click()
  await s.page.waitForLoadState('networkidle')
  await expect(s.page.locator('[data-element-link]').first()).toBeVisible()
  const linked = await s.page.locator('[data-element-link]').evaluateAll(els => els.map(e => e.getAttribute('data-element-link')))
  const tc = byId.get(linked.find(id => id && byId.has(id))!)!

  typeOf(schema, tc.objectTypeRef).displayIdField = 'title'
  await s.invoke('schema:save', repo, schema)

  // Champ invalide refusé à l'enregistrement (L3, chemin IPC).
  const bad = structuredClone(schema)
  typeOf(bad, tc.objectTypeRef).displayIdField = 'nope'
  await expect(s.invoke('schema:save', repo, bad)).rejects.toThrow(/DISPLAY_ID_FIELD_INVALID|inconnu/)

  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await s.openView('Exigences')
  await s.page.getByTitle('Vue document').click()
  await s.page.waitForLoadState('networkidle')
  const link = s.page.locator(`[data-element-link="${tc.id}"]`).first()
  await link.scrollIntoViewIfNeeded()
  await expect(link).toHaveText(tc.title)
  await expect(link).toHaveAttribute('title', tc.id)
  await s.shot('gh229-n7-display-id')

  typeOf(schema, tc.objectTypeRef).displayIdField = undefined
  await s.invoke('schema:save', repo, JSON.parse(JSON.stringify(schema)))
})
