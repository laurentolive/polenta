import type { BrowserWindow } from 'electron'
import type { ZoomAction } from '@polenta/types'
import type { AppSettingsService } from '../services/app-settings.service'
import { ZOOM_DEFAULT, normalizeZoomFactor, stepZoom } from '../../shared/zoom'

/**
 * GH237 — zoom global des fenêtres de l'application (pas des fenêtres hors écran d'export PDF ou
 * d'instantané draw.io, qui rendent toujours à 100 %). Le main est seul maître du niveau : il
 * le garde en mémoire, l'écrit dans les préférences, l'applique à toutes les fenêtres et le
 * diffuse ('app:zoom-changed') pour la bulle du renderer.
 *
 * Ctrl+molette / pincement : `zoom-changed`, émis seulement si la page n'a pas consommé
 * l'événement — l'éditeur et la visionneuse draw.io gardent ainsi leur propre zoom. Les
 * raccourcis clavier arrivent du renderer par `app:zoom`.
 *
 * Isolement des fenêtres hors écran : Chromium mémorise le zoom par origine, mais pour `file://`
 * la clé est l'URL complète — les fenêtres d'export chargent `index.html?…`, clé distincte
 * (e2e-desktop/gh237-zoom.spec.ts). Sous `pnpm dev` (origine http://localhost partagée), le zoom
 * peut s'y propager : limite connue, développement seulement.
 */

const ZOOM_ACTIONS: readonly ZoomAction[] = ['in', 'out', 'reset']

let settings: AppSettingsService | null = null
let current = ZOOM_DEFAULT
const appWindows = new Set<BrowserWindow>()

export function initAppZoom(appSettings: AppSettingsService): void {
  settings = appSettings
  current = normalizeZoomFactor(appSettings.get().zoomFactor ?? ZOOM_DEFAULT)
}

/** Niveau courant, donné aux nouvelles fenêtres (`webPreferences.zoomFactor`) : pas de flash à 100 %. */
export function currentZoomFactor(): number {
  return current
}

export function attachAppZoom(win: BrowserWindow): void {
  appWindows.add(win)
  win.on('closed', () => appWindows.delete(win))
  win.webContents.on('zoom-changed', (_event, direction) => applyZoom(direction))
  // Une navigation peut réinitialiser le zoom Chromium : réappliqué à chaque chargement.
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(current))
}

/** Palier suivant / précédent ou 100 % : appliqué à toutes les fenêtres, diffusé, persisté. */
export function applyZoom(action: ZoomAction): number {
  if (!ZOOM_ACTIONS.includes(action)) throw new Error(`Action de zoom inconnue : ${String(action)}`)
  current = stepZoom(current, action)
  for (const win of appWindows) {
    if (win.isDestroyed()) continue
    win.webContents.setZoomFactor(current)
    win.webContents.send('app:zoom-changed', current)
  }
  try {
    settings?.set({ zoomFactor: current })
  } catch (err) {
    // Fichier verrouillé (antivirus, synchronisation) : le zoom reste appliqué, seulement pas mémorisé.
    console.error('[GH237] préférence de zoom non enregistrée :', err)
  }
  return current
}
