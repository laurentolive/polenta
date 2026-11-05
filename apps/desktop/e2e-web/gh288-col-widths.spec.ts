import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH288 — la largeur d'une colonne redimensionnée à la souris dans la vue Tableau survit au
 * démontage de la vue (passage en vue Document puis retour) et au rechargement, via la pref du type.
 */
const s = setupSession()

const idHeader = () => s.page.locator('thead th').filter({ hasText: /^ID/ }).first()
const width = async () => Math.round((await idHeader().boundingBox())!.width)

test('GH288 — largeur de colonne mémorisée après changement de vue et rechargement', async () => {
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await expect(idHeader()).toBeVisible()

  const before = await width()
  const handle = idHeader().locator('div[style*="col-resize"]')
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await s.page.mouse.move(x, y)
  await s.page.mouse.down()
  await s.page.mouse.move(x + 60, y, { steps: 5 })
  await s.page.mouse.up()
  const resized = await width()
  expect(resized).toBeGreaterThan(before + 40)

  await s.page.getByTitle('Vue document').click()
  await expect(idHeader()).toHaveCount(0)
  await s.page.getByTitle('Vue tableau').click()
  await expect(idHeader()).toBeVisible()
  await expect.poll(width).toBe(resized)

  await s.page.reload()
  await s.page.waitForLoadState('networkidle')
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await expect(idHeader()).toBeVisible()
  await expect.poll(width).toBe(resized)
  await s.shot('gh288-largeur-memorisee')
})
