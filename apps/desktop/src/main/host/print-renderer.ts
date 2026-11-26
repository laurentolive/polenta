import type { ExportKind } from '@polenta/types'
import { PRINT_MARGIN_MM, PRINT_SCALE } from '@polenta/types'
import type { DrawioSnapshotter } from '../services/export/template/drawio-ref'

/** GH435 — échelle et marges (mm) d'un export PDF ; absent : options par défaut du moteur. */
export interface PdfLayout {
  scale: number
  marginMm: number
  /** GH439 — page en paysage (tableaux larges). */
  landscape?: boolean
  /** GH439 — pied de page « page n / N » ; l'en-tête du moteur (date, titre) est supprimé. */
  pageNumbers?: boolean
}

/** Pied de page « page n / N » : les classes `pageNumber` / `totalPages` sont remplies par Chromium. */
const FOOTER_TEMPLATE = '<div style="font-size:8px;width:100%;text-align:center;color:#666;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
/** En-tête vide : sans lui, Chromium imprime la date et le titre de la page. */
const EMPTY_HEADER_TEMPLATE = '<span></span>'

/** Options communes à Electron (`printToPDF`) et Playwright (`page.pdf`) : même mise en page sur les deux moteurs. */
interface PdfEngineOptions {
  scale?: number
  landscape?: boolean
  displayHeaderFooter?: boolean
  headerTemplate?: string
  footerTemplate?: string
}

function commonPdfOptions(layout: PdfLayout): PdfEngineOptions {
  return {
    scale: layout.scale,
    ...(layout.landscape && { landscape: true }),
    ...(layout.pageNumbers && { displayHeaderFooter: true, headerTemplate: EMPTY_HEADER_TEMPLATE, footerTemplate: FOOTER_TEMPLATE }),
  }
}

/**
 * GH435 (specs/GH435.md § 3.7) — le dashboard est mis en page à sa largeur de référence puis réduit par le
 * MOTEUR d'impression (option `scale`) à la largeur utile de la page A4 ; marges identiques sur le desktop
 * (Electron) et le web (Chromium headless), dont les défauts diffèrent (1 cm / aucune). Les autres exports
 * gardent les options par défaut de leur moteur.
 */
export const PDF_LAYOUT_BY_KIND: Partial<Record<ExportKind, PdfLayout>> = {
  dashboard: { scale: PRINT_SCALE, marginMm: PRINT_MARGIN_MM },
  // GH439 — page d'une version : tableaux larges, A4 paysage à l'échelle 1, numéro de page en pied.
  version: { scale: 1, marginMm: PRINT_MARGIN_MM, landscape: true, pageNumbers: true },
}

const MM_PER_INCH = 25.4

/** Options Electron `printToPDF` (marges en pouces). */
export function electronPdfLayout(kind: ExportKind): PdfEngineOptions & { margins?: { top: number; bottom: number; left: number; right: number } } {
  const layout = PDF_LAYOUT_BY_KIND[kind]
  if (!layout) return {}
  const inch = layout.marginMm / MM_PER_INCH
  return { ...commonPdfOptions(layout), margins: { top: inch, bottom: inch, left: inch, right: inch } }
}

/** Options Playwright `page.pdf` (marges en millimètres). */
export function playwrightPdfLayout(kind: ExportKind): PdfEngineOptions & { margin?: { top: string; right: string; bottom: string; left: string } } {
  const layout = PDF_LAYOUT_BY_KIND[kind]
  if (!layout) return {}
  const mm = `${layout.marginMm}mm`
  return { ...commonPdfOptions(layout), margin: { top: mm, right: mm, bottom: mm, left: mm } }
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
  version: '/print/version',
}

/**
 * GH44 — rendu des routes `/print/*` du renderer : PDF (T43) et instantanés draw.io (GH34). Le
 * desktop rend dans une fenêtre Electron cachée ; le serveur web dans un Chromium headless.
 */
export interface PrintRenderer {
  renderPdf(kind: ExportKind, params: Record<string, string>, destPath: string): Promise<void>
  snapshotDrawios: DrawioSnapshotter
}
