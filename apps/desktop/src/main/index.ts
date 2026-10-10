import { app, BrowserWindow, Menu } from 'electron'
import * as path from 'path'
import { createContainer } from './container'
import { BRAND } from '../shared/brand'

// Aligne le dossier userData (auth.json, workspace.json…) entre `pnpm dev` et le build
// packagé — sans ça, Electron retombe sur le "name" du package.json en dev (`@polenta/desktop`)
// au lieu du `productName` de la marque (`Polenta`), donnant deux profils isolés. GH49 : un
// dossier userData par marque — Polenta garde « Polenta », donc ses données existantes.
app.setName(BRAND.productName)

export function createAppWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // affichée seulement au premier paint (ready-to-show) — pas de flash de fenêtre blanche vide
    // GH49 — icône de la marque (dossier brands/<id>/ en dev ; en build packagé l'exécutable porte
    // déjà l'icône de la marque, ce chemin n'existe pas et Electron s'en passe).
    icon: path.join(__dirname, `../../brands/${BRAND.id}/icon.${process.platform === 'win32' ? 'ico' : 'png'}`),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  Menu.setApplicationMenu(null)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools()
    }
  })

  return win
}

app.whenReady().then(async () => {
  const { update } = await createContainer()
  createAppWindow()
  update.scheduleStartupCheck()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
