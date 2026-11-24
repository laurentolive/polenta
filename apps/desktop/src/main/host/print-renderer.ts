import type { ExportKind } from '@polenta/types'
import { PRINT_MARGIN_MM, PRINT_SCALE } from '@polenta/types'
import type { DrawioSnapshotter } from '../services/export/template/drawio-ref'

/** GH435 — échelle et marges (mm) d'un export PDF ; absent : options par défaut du moteur. */
export interface PdfLayout {
  scale: number
  marginMm: number
}

/**
 * GH435 (specs/GH435.md § 3.7) — le dashboard est mis en page à sa largeur de référence puis réduit par le
 * MOTEUR d'impression (option `scale`) à la largeur utile de la page A4 ; marges identiques sur le desktop
 * (Electron) et le web (Chromium headless), dont les défauts diffèrent (1 cm / aucune). Les autres exports
 * gardent les options par défaut de leur moteur.
 */
export const PDF_LAYOUT_BY_KIND: Partial<Record<ExportKind, PdfLayout>> = {
  dashboard: { scale: PRINT_SCALE, marginMm: PRINT_MARGIN_MM },
}

const MM_PER_INCH = 25.4

/** Options Electron `printToPDF` (marges en pouces). */
export function electronPdfLayout(kind: ExportKind): { scale?: number; margins?: { top: number; bottom: number; left: number; right: number } } {
  const layout = PDF_LAYOUT_BY_KIND[kind]
  if (!layout) return {}
  const inch = layout.marginMm / MM_PER_INCH
  return { scale: layout.scale, margins: { top: inch, bottom: inch, left: inch, right: inch } }
}

/** Options Playwright `page.pdf` (marges en millimètres). */
export function playwrightPdfLayout(kind: ExportKind): { scale?: number; margin?: { top: string; right: string; bottom: string; left: string } } {
  const layout = PDF_LAYOUT_BY_KIND[kind]
  if (!layout) return {}
  const mm = `${layout.marginMm}mm`
  return { scale: layout.scale, margin: { top: mm, right: mm, bottom: mm, left: mm } }
}

// Une route imprimable par kind implémenté — étendu au fil des sprints (T43-design.md §Sprints).
// Partagée par les implémentations Electron (fenêtre cachée) et web (Chromium headless, GH44 S4).
export const PRINT_ROUTE_BY_KIND: Partial<Record<ExportKind, string>> = {
  requirements: '/print/requirements',
  tests: '/print/tests',
  'campaign-plan': '/print/campaign-plan',
  'campaign-report': '/print/campaign-report',
  'query-result': '/print/query-result',
  dashboard: '/print/dashboard',
  executions: '/print/executions',
}

/**
 * GH44 — rendu des routes `/print/*` du renderer : PDF (T43) et instantanés draw.io (GH34). Le
 * desktop rend dans une fenêtre Electron cachée ; le serveur web dans un Chromium headless.
 */
export interface PrintRenderer {
  renderPdf(kind: ExportKind, params: Record<string, string>, destPath: string): Promise<void>
  snapshotDrawios: DrawioSnapshotter
}
