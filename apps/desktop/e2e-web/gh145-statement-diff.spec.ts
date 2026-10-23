import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH145 — analyse d'impact entre deux baselines : sous chaque élément dont l'énoncé a changé,
 * l'avant/après de l'énoncé, mot à mot (ancien barré, nouveau surligné), et un rappel de lecture
 * en tête de liste.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface ChangedField { field: string; from?: unknown; to?: unknown }
interface Changed { reqId: string; changedFields: ChangedField[] }
interface Analysis { id: string; label: string; changedRequirements: Changed[] }

test('GH145-1 — énoncé modifié : avant barré, après surligné', async () => {
  const analysis = await s.invoke<Analysis>('impact-analysis:create', s.project.localPath, { fromBaselineTag: 'RE1', toBaselineTag: 'RE2', label: 'GH145 diff' })
  const changed = analysis.changedRequirements.find((cr) => cr.changedFields.some((f) => f.field === 'fields.statement'))
  expect(changed, 'un énoncé modifié entre RE1 et RE2').toBeTruthy()

  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await s.openView('Analyse d\'impact')
  await s.page.getByRole('button', { name: /GH145 diff/ }).click()
  await expect(s.page.getByText('RE1 → RE2')).toBeVisible()
  await expect(s.page.getByText(/Chaque élément modifié est la cause de l'analyse/)).toBeVisible()

  // Un seul énoncé modifié entre RE1 et RE2 dans la démo : le seul bloc de diff de la page.
  expect(analysis.changedRequirements.filter((cr) => cr.changedFields.some((f) => f.field === 'fields.statement'))).toHaveLength(1)
  const diff = s.page.getByTestId('statement-diff')
  await expect(diff).toBeVisible()
  // Repli / dépli.
  await s.page.getByRole('button', { name: 'Énoncé : avant / après' }).click()
  await expect(diff).toHaveCount(0)
  await s.page.getByRole('button', { name: 'Énoncé : avant / après' }).click()
  await expect(diff).toBeVisible()
  // L'ancien texte (sans les ajouts) et le nouveau (sans les retraits) se relisent à l'identique.
  const parts = await diff.evaluate((el) => Array.from(el.childNodes).map((n) => ({ tag: (n as Element).tagName ?? '#text', text: n.textContent ?? '' })))
  const field = changed!.changedFields.find((f) => f.field === 'fields.statement')!
  const norm = (v: unknown) => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim()
  expect(norm(parts.filter((p) => p.tag !== 'INS').map((p) => p.text).join(''))).toBe(norm(field.from))
  expect(norm(parts.filter((p) => p.tag !== 'DEL').map((p) => p.text).join(''))).toBe(norm(field.to))
  expect(parts.some((p) => p.tag === 'DEL' || p.tag === 'INS')).toBe(true)
  await s.shot('gh145-statement-diff')
})
