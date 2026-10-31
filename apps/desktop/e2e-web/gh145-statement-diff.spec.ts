import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH145 — sous chaque élément dont l'énoncé a changé, l'avant/après de l'énoncé, mot à mot (ancien
 * barré, nouveau surligné). GH199 : les analyses entre baselines sont retirées ; vérifié sur
 * l'analyse des modifications locales (vue Changesets).
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface Req { id: string; status: string; fields: Record<string, unknown> }

test('GH145-1 — énoncé modifié : avant barré, après surligné', async () => {
  const { localPath } = s.project
  const reqs = await s.invoke<Req[]>('requirements:list', localPath)
  const target = reqs.find((r) => typeof r.fields?.['statement'] === 'string' && (r.fields['statement'] as string).trim().length > 20)!
  const before = target.fields['statement'] as string
  const after = before.replace(/SHALL/, 'SHALL immediately')
  expect(after).not.toBe(before)
  // GH200 — contenu d'une exigence approuvée verrouillé : la rouvrir d'abord.
  if (target.status === 'approved') await s.invoke('requirements:transition', localPath, target.id, { toStatus: 'draft' })
  await s.invoke('requirements:update', localPath, target.id, { fields: { ...target.fields, statement: after } })

  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await s.openView('Changesets')
  await s.page.getByTestId('changes-local-entry').click()
  const row = s.page.locator('div.border-b').filter({ has: s.page.getByRole('button', { name: target.id, exact: true }) }).first()
  const diff = row.getByTestId('statement-diff')
  await expect(diff).toBeVisible()
  await row.getByRole('button', { name: 'Énoncé : avant / après' }).click()
  await expect(diff).toHaveCount(0)
  await row.getByRole('button', { name: 'Énoncé : avant / après' }).click()
  await expect(diff).toBeVisible()
  const parts = await diff.evaluate((el) => Array.from(el.childNodes).map((n) => ({ tag: (n as Element).tagName ?? '#text', text: n.textContent ?? '' })))
  const norm = (v: string) => v.replace(/\s+/g, ' ').trim()
  expect(norm(parts.filter((p) => p.tag !== 'INS').map((p) => p.text).join(''))).toBe(norm(before))
  expect(norm(parts.filter((p) => p.tag !== 'DEL').map((p) => p.text).join(''))).toBe(norm(after))
  expect(parts.some((p) => p.tag === 'INS')).toBe(true)
  await s.shot('gh145-statement-diff')
})
