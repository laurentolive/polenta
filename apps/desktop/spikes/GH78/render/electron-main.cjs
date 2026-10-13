// GH78 — Electron comme navigateur : charge la page de rendu, attend window.__gh78.done,
// écrit la capture et le rapport. Paramètres par variables d'environnement GH78_URL, GH78_PNG,
// GH78_JSON : sous Windows, Electron 31 sort en 127 sans exécuter le script quand une URL http est
// suivie d'un autre argument sur la ligne de commande.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

const { GH78_URL: url, GH78_PNG: png, GH78_JSON: json } = process.env
const consoleLines = []
const write = (data) => fs.writeFileSync(json, JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, ...data, console: consoleLines.slice(0, 50) }, null, 2))

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 1400, height: 1700, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })
    win.webContents.on('console-message', (_e, level, message) => consoleLines.push(`[${level}] ${message}`))
    await win.loadURL(url)
    const deadline = Date.now() + 30000
    let report = null
    while (Date.now() < deadline) {
      report = await win.webContents.executeJavaScript('window.__gh78 && window.__gh78.done ? JSON.stringify(window.__gh78) : null')
      if (report) break
      await new Promise(r => setTimeout(r, 200))
    }
    const image = await win.webContents.capturePage()
    fs.writeFileSync(png, image.toPNG())
    write({ report: report ? JSON.parse(report) : 'TIMEOUT' })
  } catch (e) {
    write({ error: String(e && e.stack || e) })
  }
  app.quit()
})
