import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH144 — onglet de catégorie sans type de cette catégorie : quand le schéma n'a aucun type
 * « campagne », l'onglet Campagnes affiche « Aucun type « Campagnes » configuré… » et un lien vers
 * le Modèle de données, au lieu des exigences du premier type du composant.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface SchemaType { name: string; label?: string; prefix: string; category: string }
interface SchemaNode { name: string; objectTypes?: SchemaType[]; children?: SchemaNode[] }

let reqPrefixes: string[] = []

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<{ nodes: SchemaNode[] }>('schema:get', localPath)
  const strip = (nodes: SchemaNode[]): SchemaNode[] => nodes.map(n => ({
    ...n,
    ...(n.objectTypes ? { objectTypes: n.objectTypes.filter(t => t.category !== 'campaign') } : {}),
    ...(n.children ? { children: strip(n.children) } : {}),
  }))
  const all = (nodes: SchemaNode[]): SchemaType[] => nodes.flatMap(n => [...(n.objectTypes ?? []), ...all(n.children ?? [])])
  reqPrefixes = all(schema.nodes).filter(t => t.category === 'requirement').map(t => t.prefix)
  expect(reqPrefixes.length).toBeGreaterThan(0)
  await s.invoke('schema:save', localPath, { ...schema, nodes: strip(schema.nodes) })
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
})

test('GH144-1 — Campagnes sans type campagne : message et lien, pas d\'exigences', async () => {
  await s.openView('Campagnes')
  const message = s.page.getByText('Aucun type « Campagnes » configuré pour ce composant.')
  await expect(message.first()).toBeVisible()
  await expect(s.page.getByRole('button', { name: 'Ouvrir le Modèle de données' }).first()).toBeVisible()
  // Aucune ligne d'exigence (ID d'un type exigence) affichée dans le panneau ni dans la vue.
  for (const prefix of reqPrefixes) {
    await expect(s.page.getByText(new RegExp(`^${prefix}-\\d+$`))).toHaveCount(0)
  }
  await s.shot('gh144-campagnes')

  await s.page.getByRole('button', { name: 'Ouvrir le Modèle de données' }).first().click()
  await expect(s.page).toHaveURL(/\/schema/)
})

test('GH144-2 — Exigences : inchangé, le type exigence reste affiché', async () => {
  await s.openView('Exigences')
  await expect(s.page.getByText('Aucun type « Exigences » configuré pour ce composant.')).toHaveCount(0)
  await expect(s.page.getByText(new RegExp(`^(${reqPrefixes.join('|')})-\\d+$`)).first()).toBeVisible()
})
