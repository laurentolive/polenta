import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH83 — icône ⚠ « Impact à vérifier » (T172) dans les vues tableau (Excel) et document (Word) de
 * la vue Exigences : affichée pour un élément marqué `needsRevalidation`, retirée sans rechargement
 * après levée du flag depuis l'analyse d'impact (T173). Le filtre texte du panneau ne matche pas
 * le flag.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface Flagged { elementId: string; elementType: string; repo?: unknown }
interface SchemaNode { objectTypes?: Array<{ label: string; prefix: string }>; children?: SchemaNode[] }

let target = ''
let typeLabel = ''

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const reqs = await s.invoke<Array<{ id: string; status: string }>>('requirements:list', localPath)
  for (const r of reqs.filter((r) => r.status === 'approved')) {
    await s.invoke('requirements:open-draft', localPath, r.id, 'draft', workspaceDir)
    const flagged = await s.invoke<Flagged[]>('revalidation:list', localPath, workspaceDir)
    const hit = flagged.find((f) => !f.repo && f.elementType === 'requirement')
    if (hit) { target = hit.elementId; break }
  }
  expect(target).toBeTruthy()
  const schema = await s.invoke<{ nodes: SchemaNode[] }>('schema:get', localPath)
  const types = (nodes: SchemaNode[]): Array<{ label: string; prefix: string }> => nodes.flatMap((n) => [...(n.objectTypes ?? []), ...types(n.children ?? [])])
  typeLabel = types(schema.nodes).find((t) => t.prefix === target.replace(/-\d+$/, ''))!.label
})

const excelRow = () => s.page.locator('tr').filter({ hasText: target })
/** En-tête de carte de la vue document : la ligne qui porte l'id, le statut et l'icône. */
const wordHeader = () => s.page.locator('span.font-mono', { hasText: new RegExp(`^${target}$`) }).locator('xpath=..')

async function openTargetType(mode: 'Vue tableau' | 'Vue document') {
  await s.openView('Exigences')
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(typeLabel)
  await combo.press('Enter')
  await s.page.getByTitle(mode).click()
  await s.page.waitForLoadState('networkidle')
}

test('GH83-1 — ⚠ affiché dans les vues tableau et document pour un élément marqué', async () => {
  await openTargetType('Vue tableau')
  await expect(excelRow().first()).toBeVisible()
  await expect(excelRow().first().getByRole('img', { name: 'Impact à vérifier' })).toBeVisible()
  await s.shot('gh83-excel')

  await openTargetType('Vue document')
  await expect(wordHeader().first()).toBeVisible()
  await expect(wordHeader().first().getByRole('img', { name: 'Impact à vérifier' })).toBeVisible()
  await s.shot('gh83-word')
})

test('GH83-2 — le filtre texte « true » ne retient pas un élément sur la seule base du flag', async () => {
  await openTargetType('Vue tableau')
  const req = await s.invoke<{ fields: Record<string, unknown>; title: string }>('requirements:get', s.project.localPath, target)
  test.skip([req.title, ...Object.values(req.fields ?? {})].some((v) => /true/i.test(String(v))), 'un champ de la cible contient « true »')
  const filter = s.page.getByPlaceholder(/^Filtrer/).first()
  await filter.fill('true')
  await expect(excelRow()).toHaveCount(0)
  await filter.fill('')
})

test('GH83-3 — levée du flag depuis l\'analyse d\'impact : ⚠ retiré des deux vues sans rechargement', async () => {
  await openTargetType('Vue tableau')
  await expect(excelRow().first().getByRole('img', { name: 'Impact à vérifier' })).toBeVisible()

  await s.openView('Changements')
  await s.page.getByRole('button', { name: /Impact à vérifier/ }).click()
  const row = s.page.locator('div.border-b').filter({ has: s.page.getByRole('checkbox', { name: `Sélectionner ${target}` }) })
  await row.getByRole('button', { name: 'Lever le flag', exact: true }).click()
  await expect(row).toHaveCount(0)

  await openTargetType('Vue tableau')
  await expect(excelRow().first()).toBeVisible()
  await expect(excelRow().first().getByRole('img', { name: 'Impact à vérifier' })).toHaveCount(0)
  await openTargetType('Vue document')
  await expect(wordHeader().first()).toBeVisible()
  await expect(wordHeader().first().getByRole('img', { name: 'Impact à vérifier' })).toHaveCount(0)
})
