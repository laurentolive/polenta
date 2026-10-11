import type { ExportKind } from '@polenta/types'
import type { DrawioSnapshotter } from '../services/export/template/drawio-ref'

// Une route imprimable par kind implémenté — étendu au fil des sprints (T43-design.md §Sprints).
// Partagée par les implémentations Electron (fenêtre cachée) et web (Chromium headless, GH44 S4).
export const PRINT_ROUTE_BY_KIND: Partial<Record<ExportKind, string>> = {
  requirements: '/print/requirements',
  tests: '/print/tests',
  'campaign-plan': '/print/campaign-plan',
  'campaign-report': '/print/campaign-report',
  'query-result': '/print/query-result',
  'impact-analysis': '/print/impact-analysis',
  dashboard: '/print/dashboard',
}

/**
 * GH44 — rendu des routes `/print/*` du renderer : PDF (T43) et instantanés draw.io (GH34). Le
 * desktop rend dans une fenêtre Electron cachée ; le serveur web dans un Chromium headless.
 */
export interface PrintRenderer {
  renderPdf(kind: ExportKind, params: Record<string, string>, destPath: string): Promise<void>
  snapshotDrawios: DrawioSnapshotter
}
