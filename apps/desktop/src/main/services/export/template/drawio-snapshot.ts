import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import { drawioKey, type DrawioSnapshot, type DrawioSnapshotter } from './drawio-ref'

// Chemins résolus depuis la racine de l'application (et non `__dirname`) : ce module est chargé à
// la demande depuis un chunk (`out/main/chunks/`), pas depuis `out/main/` comme `pdf.util.ts`.
// `app.getAppPath()` = `apps/desktop` en dev, `resources/app.asar` une fois packagé (`out/**` inclus).

const ZOOM = 2 // netteté à l'impression
// Délai global : marge de chargement + délai par diagramme de la route (10 s) avec capture.
const BASE_TIMEOUT_MS = 30_000
const PER_ITEM_TIMEOUT_MS = 12_000
const VIEWPORT = { width: 1600, height: 1200 } // px CSS

/**
 * GH34 sprint 3 — rend des diagrammes draw.io en PNG pour l'export Word à partir d'un gabarit. Le
 * viewer draw.io n'existe que dans un navigateur : une fenêtre cachée (rendu offscreen) charge la
 * route `/print/drawio-snapshot`, qui rend chaque diagramme avec le même code que la Vue Word et
 * signale son rectangle ; on capture la zone (`capturePage`) avant de passer au suivant. Même
 * mécanisme de chargement que l'export PDF (`pdf.util.ts`). Un diagramme en échec (fichier
 * absent, XML invalide, délai) est simplement absent du résultat : l'appelant insère un repli.
 */
export const snapshotDrawios: DrawioSnapshotter = async (repoPath, refs) => {
  const result = new Map<string, DrawioSnapshot>()
  const unique = [...new Map(refs.map(r => [drawioKey(r), r])).values()]
  if (unique.length === 0) return result

  const win = new BrowserWindow({
    show: false,
    width: VIEWPORT.width * ZOOM,
    height: VIEWPORT.height * ZOOM,
    useContentSize: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'out/preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      offscreen: true,
      zoomFactor: ZOOM,
    },
  })
  // Rendu offscreen : peinture continue nécessaire pour que `capturePage` voie l'état courant.
  win.webContents.setFrameRate(30)

  try {
    await new Promise<void>((resolve, reject) => {
      // À l'expiration, les diagrammes déjà capturés sont conservés : seuls les suivants passent
      // en repli texte (pas d'échec global qui jetterait le travail fait).
      const timeout = setTimeout(() => {
        console.error(`[GH34] rendu draw.io : délai dépassé, ${result.size}/${unique.length} diagramme(s) capturé(s)`)
        resolve()
      }, BASE_TIMEOUT_MS + PER_ITEM_TIMEOUT_MS * unique.length)
      win.webContents.ipc.handle('export:drawio-snapshot-ready', async (_e, index: number, rect: CssRect | null) => {
        if (index < 0) {
          clearTimeout(timeout)
          resolve()
          return
        }
        const ref = unique[index]
        if (!ref || !rect) return
        const snapshot = await capture(win, rect).catch(() => null)
        if (snapshot) result.set(drawioKey(ref), snapshot)
      })
      win.webContents.once('did-fail-load', (_e, code, description, _url, isMainFrame) => {
        if (!isMainFrame) return
        clearTimeout(timeout)
        reject(new Error(`Échec de chargement du rendu des diagrammes (${code}) : ${description}`))
      })

      const qs = new URLSearchParams({
        repoPath,
        itemsJson: JSON.stringify(unique),
        __print: '/print/drawio-snapshot',
      }).toString()
      if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${qs}`)
      else void win.loadFile(path.join(app.getAppPath(), 'out/renderer/index.html'), { search: qs })
    })
  } finally {
    win.destroy()
  }
  return result
}

interface CssRect { x: number; y: number; width: number; height: number }

async function capture(win: BrowserWindow, rect: CssRect): Promise<DrawioSnapshot | null> {
  // Diagramme plus grand que la fenêtre : agrandie le temps de la capture (zone hors fenêtre
  // non peinte sinon).
  const needW = Math.ceil((rect.x + rect.width) * ZOOM)
  const needH = Math.ceil((rect.y + rect.height) * ZOOM)
  const [curW, curH] = win.getContentSize()
  if (needW > curW || needH > curH) {
    win.setContentSize(Math.max(curW, needW), Math.max(curH, needH))
    await new Promise(r => setTimeout(r, 300))
  } else {
    await new Promise(r => setTimeout(r, 50))
  }
  const image = await win.webContents.capturePage({
    x: Math.floor(rect.x * ZOOM),
    y: Math.floor(rect.y * ZOOM),
    width: Math.ceil(rect.width * ZOOM),
    height: Math.ceil(rect.height * ZOOM),
  })
  if (image.isEmpty()) return null
  return { png: image.toPNG(), width: rect.width, height: rect.height }
}
