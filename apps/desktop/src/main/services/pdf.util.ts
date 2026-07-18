import { BrowserWindow } from 'electron'
import * as path from 'path'
import * as fsP from 'fs/promises'
import type { ExportKind } from '@polenta/types'

// Une route imprimable par kind implémenté — étendu au fil des sprints (T43-design.md §Sprints).
const PRINT_ROUTE_BY_KIND: Partial<Record<ExportKind, string>> = {
  requirements: '/print/requirements',
  tests: '/print/tests',
  'campaign-plan': '/print/campaign-plan',
  'campaign-report': '/print/campaign-report',
  'query-result': '/print/query-result',
  'impact-analysis': '/print/impact-analysis',
  dashboard: '/print/dashboard',
}

/**
 * Rend une route imprimable (`/print/<kind>`) dans une fenêtre Electron cachée puis produit un
 * PDF via `webContents.printToPDF`. Réutilise le rendu React existant (richtext, mise en page)
 * plutôt que de reconstruire du HTML côté main process — décision structurante de
 * specs/T43-design.md. La route chargée récupère elle-même ses données depuis `params` (repoPath,
 * filtres…) et signale sa fin de chargement via `api.export.notifyPrintReady()`, écouté ici sur un
 * canal IPC scoped à cette seule fenêtre (pas de canal global partagé entre exports concurrents).
 */
export async function renderKindToPdf(
  kind: ExportKind,
  params: Record<string, string>,
  destPath: string,
): Promise<void> {
  const printPath = PRINT_ROUTE_BY_KIND[kind]
  if (!printPath) throw new Error(`Export PDF non implémenté pour "${kind}"`)

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  try {
    const qs = new URLSearchParams({ ...params, __print: printPath }).toString()

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Délai dépassé au chargement de la page à imprimer'))
      }, 20_000)

      win.webContents.ipc.handle('export:print-ready', () => {
        clearTimeout(timeout)
        resolve()
      })
      // `isMainFrame` est déterminant : un sous-cadre/sous-ressource en échec (favicon, etc. —
      // cas connu d'Electron) ne doit pas faire échouer tout l'export, seul un échec du document
      // principal empêche la route imprimable de jamais appeler `notifyPrintReady()`.
      win.webContents.once('did-fail-load', (_e, code, description, _url, isMainFrame) => {
        if (!isMainFrame) return
        clearTimeout(timeout)
        reject(new Error(`Échec de chargement de la page à imprimer (${code}) : ${description}`))
      })

      if (process.env['ELECTRON_RENDERER_URL']) {
        win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${qs}`)
      } else {
        win.loadFile(path.join(__dirname, '../renderer/index.html'), { search: qs })
      }
    })

    const pdfBuffer = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    await fsP.writeFile(destPath, pdfBuffer)
  } finally {
    win.destroy()
  }
}
