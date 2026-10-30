import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH183 — vue « Constellation » : ouverte depuis le panneau Changesets (GH199), elle dessine les
 * exigences de la démo LL800 et leurs liens exigence ↔ exigence ; un clic sur un nœud affiche sa
 * fiche, « Ouvrir » ouvre l'exigence.
 */
const s = setupSession()

async function openConstellation() {
  await s.openView('Changesets')
  await s.page.getByRole('button', { name: 'Constellation des exigences' }).click()
  await expect(s.page.getByRole('img', { name: /Exigences en anneaux/ })).toBeVisible()
}

test('GH183-1 — la vue dessine les exigences et leurs liens', async () => {
  await openConstellation()
  const reqs = await s.invoke<unknown[]>('requirements:list', s.project.localPath, {})
  const nodes = s.page.locator('svg[role="img"] g[role="button"]')
  expect(await nodes.count()).toBeGreaterThanOrEqual(reqs.length)
  await expect(s.page.getByText('liens entre exigences')).toBeVisible()
  await s.shot('gh183-overview')
})

test('GH183-2 — clic sur un nœud : fiche, lignée, ouverture', async () => {
  await openConstellation()
  const node = s.page.locator('svg[role="img"] g[role="button"][aria-label^="PRD-0002 "]')
  await node.click()
  const card = s.page.locator('aside')
  await expect(card.getByText('Couverture par les tests')).toBeVisible()
  await expect(card.getByRole('button', { name: 'SYS-0002', exact: false })).toBeVisible()
  await s.shot('gh183-card')
  await card.getByRole('button', { name: 'Ouvrir PRD-0002' }).click()
  await expect(s.page).toHaveURL(/\/req\/PRD-0002/)
})
