import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH397 — écritures en rafale, application ouverte sur la vue Suivi (dashboard).
 *
 * Avant : chaque fichier écrit relançait toutes les lectures de la page (6 widgets de Suivi, liens du
 * workspace…), et chaque reconstruction du graphe relisait l'historique git des objets : 60 créations
 * prenaient 54 s (0,9 s chacune, contre 25 ms page fermée), les écritures attendant derrière les
 * relectures. Le test porte sur le symptôme (durée de la rafale, nombre de relectures) et sur la
 * fraîcheur (les widgets sont relus après la dernière écriture).
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface SchemaLike { nodes: Array<{ name: string; objectTypes?: Array<{ name: string; category: string }> }> }

const WRITES = 40

test('GH397-1 — rafale de créations page ouverte : rapide, relectures regroupées, widgets relus à la fin', async () => {
  test.setTimeout(180_000)
  const { localPath } = s.project
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const type = schema.nodes.find(n => n.name === 'root')!.objectTypes!.find(t => t.category === 'requirement')!
  await expect(s.page).toHaveURL(/\/dashboard/)
  await s.page.waitForLoadState('networkidle')

  const widgetRuns: number[] = []
  s.page.on('request', r => {
    if (r.url().includes('/rpc/suivi%3Arun') || r.url().includes('/rpc/suivi:run')) widgetRuns.push(Date.now())
  })

  // Par le bridge de la page, comme un import ou une saisie : les écritures partagent les connexions
  // HTTP de la page avec ses relectures.
  const start = Date.now()
  for (let i = 0; i < WRITES; i++) {
    await s.invoke('requirements:create', localPath, { objectTypeRef: `root::${type.name}`, title: `GH397 ${i}`, fields: {} })
  }
  const lastWrite = Date.now()
  const elapsed = lastWrite - start
  test.info().annotations.push({ type: 'GH397', description: `${WRITES} créations en ${elapsed} ms, ${widgetRuns.length} exécutions de widget pendant la rafale` })

  // Avant : ≈ 36 s pour 40 créations (machine au repos), bien plus sous charge. Après : quelques
  // secondes. Seuil large pour rester stable sur une machine chargée.
  expect(elapsed).toBeLessThan(20_000)
  const runsDuringBurst = widgetRuns.length
  // Avant : 6 exécutions (une par widget) par fichier écrit, soit ≈ 240.
  expect(runsDuringBurst).toBeLessThan(WRITES * 2)

  // Fraîcheur : les widgets sont relus après la dernière écriture.
  await expect.poll(() => widgetRuns.some(t => t > lastWrite), { timeout: 20_000 }).toBe(true)
})
