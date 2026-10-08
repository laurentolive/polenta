import type { PrintRenderer } from './print-renderer'
// Import statique (pas `import()`) : `electron-pdf` résout le preload depuis `__dirname`, qui doit
// rester `out/main/` — un chunk dynamique vivrait dans `out/main/chunks/`. Module léger.
import { renderKindToPdf } from './electron-pdf'

/** Implémentation desktop de `PrintRenderer` (fenêtres Electron cachées). */
export const electronPrintRenderer: PrintRenderer = {
  renderPdf: renderKindToPdf,
  // Chargé au premier diagramme à rendre (T141 : rien de plus au démarrage) ; ce module résout
  // ses chemins depuis `app.getAppPath()`, il supporte d'être un chunk.
  snapshotDrawios: async (repoPath, refs) =>
    (await import('./electron-drawio-snapshot')).snapshotDrawios(repoPath, refs),
}
