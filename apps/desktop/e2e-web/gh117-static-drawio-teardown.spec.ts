import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH117 — démontage d'un diagramme draw.io rendu en vue document : aucune erreur page.
 *
 * Le ResizeSensor du viewer vendoré tire ~200 ms après que le conteneur détaché passe à 0×0 et lit
 * `this.graph` sans garde ; le graphe ne doit donc être libéré qu'après. Le contrôle « aucune
 * erreur console » de `setupSession` (afterEach) fait l'assertion : un `pageerror`
 * `getGraphBounds` le fait échouer.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface Req { id: string; objectTypeRef: string; fields?: Record<string, unknown> }
interface SchemaNode { name: string; objectTypes?: Array<{ name: string; label: string }>; children?: SchemaNode[] }

function typeLabel(nodes: SchemaNode[], ref: string): string {
  const [node, type] = ref.split('::')
  const flat = (ns: SchemaNode[]): SchemaNode[] => ns.flatMap((n) => [n, ...flat(n.children ?? [])])
  return flat(nodes).find((n) => n.name === node)?.objectTypes?.find((t) => t.name === type)?.label ?? type
}

test('GH117-1 — vue document puis vue tableau : le diagramme démonté ne lève pas d\'erreur', async () => {
  const P = s.project.localPath
  const reqs = await s.invoke<Req[]>('requirements:list', P)
  const withDrawio = reqs.find((r) => Object.values(r.fields ?? {}).some((v) => typeof v === 'string' && v.includes('```drawio')))
  expect(withDrawio, 'exigence de la démo portant un diagramme draw.io').toBeTruthy()
  const schema = await s.invoke<{ nodes: SchemaNode[] }>('schema:get', P)

  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(typeLabel(schema.nodes, withDrawio!.objectTypeRef))
  await combo.press('Enter')
  await s.page.getByTitle('Vue document').click()
  await s.page.waitForLoadState('networkidle')

  const card = s.page.locator('[data-node-id]').filter({ has: s.page.locator('span.font-mono', { hasText: new RegExp(`^${withDrawio!.id}$`) }) }).first()
  await card.scrollIntoViewIfNeeded()
  await expect(card.locator('.static-drawio .mxgraph svg').first()).toBeVisible()

  // Démontage, puis attente au-delà du debounce du ResizeSensor (200 ms) et du délai de libération.
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForTimeout(1500)
})
