import { Menu, BrowserWindow, app } from 'electron'
import { createAppWindow } from './index'

export function buildMenu(win: BrowserWindow): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Ouvrir un projet…',
          accelerator: 'CmdOrCtrl+O',
          click: () => win.webContents.send('menu:open-workspace'),
        },
        {
          label: 'Ouvrir dans une nouvelle fenêtre',
          click: () => createAppWindow(),
        },
        { type: 'separator' },
        {
          // T101 : CmdOrCtrl+W est désormais le raccourci de fermeture d'onglet (côté
          // renderer, useTabShortcuts.ts) — plus d'accélérateur ici pour éviter le conflit.
          label: 'Fermer le projet',
          click: () => win.webContents.send('menu:close-project'),
        },
        { type: 'separator' },
        {
          label: 'Quitter',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
