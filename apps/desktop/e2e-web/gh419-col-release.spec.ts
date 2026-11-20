import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH419 — au relâchement de la poignée d'une colonne (vue Tableau), la largeur ne doit jamais
 * revenir un instant à l'ancienne valeur : chaque changement de style de l'en-tête, du dernier
 * mouvement jusqu'au relâchement compris, est enregistré (MutationObserver) et doit valoir la
 * largeur finale.
 */
const s = setupSession()

const idHeader = () => s.page.locator('thead th').filter({ hasText: /^ID/ }).first()
const width = async () => Math.round((await idHeader().boundingBox())!.width)

test('GH419 — pas de retour à l\'ancienne largeur au relâchement de la poignée', async () => {
  await s.openView('Exigences')
  await s.page.getByTitle('Vue tableau').click()
  await expect(idHeader()).toBeVisible()

  const before = await width()
  const handle = idHeader().locator('div[style*="col-resize"]')
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  // Journal des largeurs de l'en-tête, à chaque mutation du DOM du thead.
  await s.page.evaluate(() => {
    const th = () => Array.from(document.querySelectorAll('thead th')).find(t => /^ID/.test(t.textContent ?? '')) as HTMLElement | undefined
    const log: number[] = []
    const w = window as unknown as { __colLog: number[]; __colObs: MutationObserver }
    w.__colLog = log
    w.__colObs = new MutationObserver(() => {
      const el = th()
      if (el) log.push(Math.round(el.getBoundingClientRect().width))
    })
    w.__colObs.observe(document.querySelector('thead')!, { attributes: true, childList: true, characterData: true, subtree: true })
  })

  await s.page.mouse.move(x, y)
  await s.page.mouse.down()
  await s.page.mouse.move(x + 60, y, { steps: 5 })
  const afterMove = await s.page.evaluate(() => (window as unknown as { __colLog: number[] }).__colLog.length)
  await s.page.mouse.up()
  await s.page.waitForTimeout(400)

  const resized = await width()
  expect(resized).toBeGreaterThan(before + 40)

  const released = await s.page.evaluate(n => {
    const w = window as unknown as { __colLog: number[]; __colObs: MutationObserver }
    w.__colObs.disconnect()
    return w.__colLog.slice(n)
  }, afterMove)
  expect(released.filter(v => v !== resized)).toEqual([])
})
