import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * T173 (#5) — liste de repli « Impact à vérifier » de la vue Changesets (GH199) : entrée du panneau,
 * éléments marqués et leurs éléments liés, levée unitaire et multiple. Scénarios N14, N15, N3
 * (diff limité à la clé) et L11 de specs/T173-tests.md. Le marquage est obtenu comme dans l'app :
 * réouverture en brouillon d'une exigence approuvée liée (T172).
 */
const s = setupSession()

interface Flagged {
  elementId: string
  elementType: 'requirement' | 'test_case'
  repo?: { path: string }
  linked: Array<{ elementId: string; approved: boolean }>
}

let trigger: string
let flagged: Flagged[]

const listFlagged = () => s.invoke<Flagged[]>('revalidation:list', s.project.localPath, s.project.workspaceDir)

function yamlOf(e: Flagged): string {
  const dir = e.elementType === 'requirement' ? 'requirements' : 'tests'
  return fs.readFileSync(path.join(e.repo?.path ?? s.project.localPath, dir, `${e.elementId}.yaml`), 'utf8')
}

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  // La démo contient déjà des éléments marqués ; on en ajoute en rouvrant la première exigence
  // approuvée dont la réouverture marque au moins un pair (déclencheur visible dans ses liés).
  const reqs = await s.invoke<Array<{ id: string; status: string }>>('requirements:list', localPath)
  for (const r of reqs.filter((r) => r.status === 'approved')) {
    await s.invoke('requirements:open-draft', localPath, r.id, 'draft', workspaceDir)
    flagged = await listFlagged()
    trigger = r.id
    if (flagged.some((f) => f.linked.some((l) => l.elementId === trigger))) break
  }
  expect(flagged.length).toBeGreaterThanOrEqual(2)
  expect(flagged.some((f) => f.linked.some((l) => l.elementId === trigger))).toBe(true)
})

const entry = () => s.page.getByTestId('changes-revalidation-entry')
const rows = () => s.page.getByRole('checkbox', { name: /^Sélectionner / })

test('N14 — entrée « Impact à vérifier (N) », non sélectionnée d\'office, liste et éléments liés', async () => {
  await s.openView('Changesets')
  await expect(entry()).toBeVisible()
  await expect(entry()).toContainText(`${flagged.length}`)
  // Pas d'auto-sélection : la page n'affiche pas la liste tant qu'on n'a pas cliqué.
  await expect(s.page.getByText('Tout sélectionner')).toHaveCount(0)

  await entry().click()
  await expect(s.page.getByText('Tout sélectionner')).toBeVisible()
  await expect(rows()).toHaveCount(flagged.length)

  // Dépliage d'un élément marqué par la réouverture : le déclencheur figure parmi ses liés,
  // signalé « non approuvé ».
  const withTrigger = flagged.find((f) => f.linked.some((l) => l.elementId === trigger))!
  const row = s.page.locator('div.border-b').filter({ has: s.page.getByRole('checkbox', { name: `Sélectionner ${withTrigger.elementId}` }) })
  await row.getByTitle(/élément(s)? lié(s)?/).click()
  const linkedLine = row.locator('div', { hasText: trigger }).filter({ hasText: 'non approuvé' })
  await expect(linkedLine.first()).toBeVisible()
})

test('N3 — « Lever le flag » sur une ligne : seule la clé needsRevalidation disparaît du YAML', async () => {
  const target = flagged[0]
  const before = yamlOf(target)
  expect(before).toMatch(/^needsRevalidation: true$/m)

  const row = s.page.locator('div.border-b').filter({ has: s.page.getByRole('checkbox', { name: `Sélectionner ${target.elementId}` }) })
  await row.getByRole('button', { name: 'Lever le flag' }).click()
  await expect(rows()).toHaveCount(flagged.length - 1)
  await expect(entry()).toContainText(`${flagged.length - 1}`)

  const after = yamlOf(target)
  expect(after).not.toMatch(/needsRevalidation/)
  expect(after).toBe(before.replace(/^needsRevalidation: true\r?\n/m, ''))
})

test('N15 — tout sélectionner puis lever : l\'entrée disparaît, liste vide', async () => {
  const remaining = flagged.length - 1
  await s.page.getByText('Tout sélectionner').click()
  await s.page.getByRole('button', { name: `Lever le flag de la sélection (${remaining})` }).click()
  // Modale de confirmation (seul `div.fixed` de la page).
  await s.page.locator('div.fixed').getByRole('button', { name: 'Lever le flag', exact: true }).click()

  await expect(entry()).toHaveCount(0)
  await expect(s.page.getByText('Aucun élément à revérifier.')).toBeVisible()
  expect(await listFlagged()).toEqual([])
})
