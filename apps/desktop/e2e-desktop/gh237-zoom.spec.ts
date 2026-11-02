import * as fs from 'fs'
import * as path from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, newProfile } from './support/app'

/**
 * GH237 — zoom de l'interface (specs/GH237-tests.md E1–E4), plus l'isolement d'une fenêtre hors
 * écran (export PDF / instantané draw.io) vis-à-vis du zoom de l'application.
 *
 *   pnpm test:e2e:desktop -g GH237
 */

let profile: string
let app: ElectronApplication
let page: Page

const bubble = () => page.getByTestId('zoom-indicator')
const settingsFile = () => path.join(profile, 'app-settings.json')

/** Facteur de la fenêtre de l'application (la première ouverte, éventuellement pas encore affichée). */
function zoomFactor(): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
}

async function press(keys: string): Promise<void> {
  await page.keyboard.press(keys)
}

test.beforeAll(async () => {
  profile = newProfile()
  ;({ app, page } = await launch(profile))
  await page.locator('body').click()
})

test.afterAll(async () => {
  await app?.close()
})

test('GH237 E1/E4 — Ctrl+= zoome d’un palier, bulle puis masquage', async () => {
  expect(await zoomFactor()).toBe(1)
  await press('Control+=')
  await press('Control+=')
  await expect.poll(zoomFactor).toBe(1.25)
  await expect(bubble()).toContainText('125 %')
  await expect(bubble().getByRole('button')).toBeVisible()
  await expect(bubble()).toBeHidden({ timeout: 4000 })
})

test('GH237 E2 — Ctrl+-, Ctrl+0 et bouton Réinitialiser', async () => {
  await press('Control+-')
  await expect.poll(zoomFactor).toBe(1.1)
  await press('Control+0')
  await expect.poll(zoomFactor).toBe(1)
  await expect(bubble()).toContainText('100 %')
  await expect(bubble().getByRole('button')).toHaveCount(0)
  await press('Control+-')
  await expect.poll(zoomFactor).toBe(0.9)
  await bubble().getByRole('button').click()
  await expect.poll(zoomFactor).toBe(1)
})

test('GH237 — une fenêtre hors écran de la même page reste à 100 %', async () => {
  await press('Control+=')
  await expect.poll(zoomFactor).toBe(1.1)
  // Chargement identique à celui d'electron-pdf.ts (même fichier, paramètres en query).
  const offscreen = await app.evaluate(async ({ app: electronApp, BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows()[0]
    const win = new BrowserWindow({ show: false })
    const index = `${electronApp.getAppPath()}/../renderer/index.html`   // appPath = out/main
    await win.loadFile(index, { search: '__print=/print/requirements' })
    const factor = win.webContents.getZoomFactor()
    win.destroy()
    return { factor, main: main.webContents.getZoomFactor() }
  })
  expect(offscreen).toEqual({ factor: 1, main: 1.1 })
  await press('Control+0')
  await expect.poll(zoomFactor).toBe(1)
})

test('GH237 E3 — niveau restauré au redémarrage, clé retirée à 100 %', async () => {
  for (let i = 0; i < 3; i++) await press('Control+=')
  await expect.poll(zoomFactor).toBe(1.5)
  expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')).zoomFactor).toBe(1.5)

  await app.close()
  ;({ app, page } = await launch(profile))
  await page.waitForLoadState('load')
  expect(await zoomFactor()).toBe(1.5)

  await page.locator('body').click()
  await press('Control+0')
  await expect.poll(zoomFactor).toBe(1)
  expect('zoomFactor' in JSON.parse(fs.readFileSync(settingsFile(), 'utf-8'))).toBe(false)
})
