import { _electron as electron } from 'playwright-core'

const userDataDir = process.argv[2]
const shotPath = process.argv[3]

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({
  executablePath: 'C:/Dev/polenta_ws/polenta/apps/desktop/dist/win-unpacked/Polenta.exe',
  args: [`--user-data-dir=${userDataDir}`, '--no-sandbox'],
  env,
  timeout: 30000,
})

await new Promise((r) => setTimeout(r, 4000))
const page = app.windows().find((w) => !w.url().startsWith('devtools://')) ?? (await app.firstWindow())
console.log('windows:', app.windows().map((w) => w.url()))
await page.screenshot({ path: shotPath })
console.log('screenshot saved:', shotPath)
await app.close().catch(() => {})
