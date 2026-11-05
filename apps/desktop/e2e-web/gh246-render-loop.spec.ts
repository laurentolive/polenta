import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH246 — une boucle de rendu dans la barre du haut occupait le thread en continu : les transitions
 * React n'aboutissaient plus, et la vue Tableau restait à ses 50 premières lignes.
 * Le test porte sur les symptômes (toute la vue, tout le thread) et non sur le composant corrigé.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface SchemaLike { nodes: Array<{ name: string; objectTypes?: Array<{ name: string; category: string }> }> }

const EXTRA_ROWS = 60

/**
 * Allers-retours d'un `MessageChannel` en 300 ms. Thread au repos : plusieurs centaines. Thread pris
 * par du rendu en boucle : moins de 70, le planificateur de React n'y rendant la main que toutes les 5 ms.
 */
function eventLoopEchoes(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>(resolve => {
    const channel = new MessageChannel()
    const start = performance.now()
    let echoes = 0
    channel.port1.onmessage = () => {
      echoes += 1
      if (performance.now() - start < 300) channel.port2.postMessage(0)
      else {
        channel.port1.close()
        resolve(echoes)
      }
    }
    channel.port2.postMessage(0)
  }))
}

async function expectThreadAtRest(page: Page): Promise<void> {
  // Le rendu de la vue et les lectures périodiques occupent le thread un instant : seul un thread
  // jamais libre pendant toute l'attente échoue.
  await expect.poll(() => eventLoopEchoes(page), { timeout: 15_000 }).toBeGreaterThan(200)
}

test('GH246-1 — vue Tableau : toutes les lignes sont rendues au-delà des 50 premières', async () => {
  const { localPath } = s.project
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const type = schema.nodes.find(n => n.name === 'root')!.objectTypes!.find(t => t.category === 'requirement')!
  for (let i = 0; i < EXTRA_ROWS; i++) {
    await s.invoke('requirements:create', localPath, { objectTypeRef: `root::${type.name}`, title: `GH246 ${i}`, fields: {} })
  }
  // Créées par IPC : l'application n'en est pas prévenue, ses lectures en cache sont refaites au rechargement.
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await expect.poll(() => s.page.locator('tr[data-node-id]').count(), { timeout: 20_000 }).toBeGreaterThan(EXTRA_ROWS)
})

for (const view of ['Suivi', 'Exigences', 'Tests', 'Campagnes', 'Paramètres', 'Version']) {
  test(`GH246-2 — thread au repos sur la vue ${view}`, async () => {
    await s.openView(view)
    await s.page.waitForLoadState('networkidle')
    await expectThreadAtRest(s.page)
  })
}
