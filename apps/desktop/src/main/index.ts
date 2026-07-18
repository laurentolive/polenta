import { app, BrowserWindow, Menu } from 'electron'
import * as path from 'path'
import { createContainer } from './container'

// Aligne le dossier userData (auth.json, keytar, workspace.json…) entre `pnpm dev` et le build
// packagé — sans ça, Electron retombe sur le "name" du package.json en dev (`@polenta/desktop`)
// au lieu du `productName` d'electron-builder.yml (`Polenta`), donnant deux profils isolés.
app.setName('Polenta')

export function createAppWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, `../../build/icon.${process.platform === 'win32' ? 'ico' : 'png'}`),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

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
  await createContainer()
  createAppWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
