import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { rpc } from './support/helpers'

/**
 * GH351 — vue Tableau des exigences : seules les 50 premières lignes sont affichées sur un projet
 * de plus de 50 exigences. Le test porte sur le symptôme (toutes les lignes créées sont rendues
 * dans la vue Tableau), et non sur le composant suspect.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface SchemaLike { nodes: Array<{ name: string; objectTypes?: Array<{ name: string; category: string }> }> }

const COUNT = 142
const TITLE = (i: number) => `GH351 ${i}`

test('GH351-1 — vue Tableau : les 142 exigences sont rendues au-delà des 50 premières', async () => {
  const { localPath } = s.project
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const type = schema.nodes.find(n => n.name === 'root')!.objectTypes!.find(t => t.category === 'requirement')!
  // Créées page fermée (GH387 : sinon l'application relit le projet à chaque fichier écrit), puis
  // l'application est rechargée, comme si les exigences avaient été créées hors de l'application.
  const url = s.page.url()
  await s.page.goto('about:blank')
  for (let i = 1; i <= COUNT; i++) {
    await rpc(s.context, 'requirements:create', localPath, { objectTypeRef: `root::${type.name}`, title: TITLE(i), fields: {} })
  }
  await s.page.goto(url)
  await s.page.waitForLoadState('networkidle')

  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')

  const rows = s.page.locator('tr[data-node-id]')
  // Rendu complet : la dernière exigence créée est dans le DOM, et le total est atteint.
  await expect(s.page.locator('tr[data-node-id]').filter({ hasText: TITLE(COUNT) })).toHaveCount(1, { timeout: 30_000 })
  await expect.poll(() => rows.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(COUNT)
})

test('GH351-2 — vue Tableau filtrée : toutes les lignes du filtre sont rendues, pas seulement 50', async () => {
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
  // Filtre de la barre latérale (texte libre), comme le saisit l'utilisateur.
  const filter = s.page.getByPlaceholder('Filtrer…').first()
  await filter.fill('GH351')
  await expect.poll(() => s.page.locator('tr[data-node-id]').filter({ hasText: 'GH351' }).count(), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(COUNT)
  await filter.fill(TITLE(COUNT))
  await expect(s.page.locator('tr[data-node-id]').filter({ hasText: TITLE(COUNT) })).toHaveCount(1)
})
