import { describe, expect, it } from 'vitest'
import { PRINT_MARGIN_MM } from '@polenta/types'
import { electronPdfLayout, PDF_LAYOUT_BY_KIND, playwrightPdfLayout, PRINT_ROUTE_BY_KIND } from './print-renderer'

// GH439 sprint 3 — PDF de la page d'une version : A4 paysage, échelle 1, numéro de page en pied (specs/GH439-tests.md X10, X11).

describe('mise en page PDF de la page d\'une version', () => {
  it('route imprimable et mise en page déclarées', () => {
    expect(PRINT_ROUTE_BY_KIND.version).toBe('/print/version')
    expect(PDF_LAYOUT_BY_KIND.version).toEqual({ scale: 1, marginMm: PRINT_MARGIN_MM, landscape: true, pageNumbers: true })
  })

  it('Electron : paysage, échelle 1, marges de 10 mm, en-tête vide, pied « page n / N »', () => {
    const layout = electronPdfLayout('version')
    const inch = PRINT_MARGIN_MM / 25.4
    expect(layout).toMatchObject({ scale: 1, landscape: true, displayHeaderFooter: true, headerTemplate: '<span></span>', margins: { top: inch, bottom: inch, left: inch, right: inch } })
    expect(layout.footerTemplate).toContain('class="pageNumber"')
    expect(layout.footerTemplate).toContain('class="totalPages"')
  })

  it('Playwright : mêmes options, marges en millimètres', () => {
    const layout = playwrightPdfLayout('version')
    expect(layout).toMatchObject({ scale: 1, landscape: true, displayHeaderFooter: true, headerTemplate: '<span></span>', margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } })
    expect(layout.footerTemplate).toBe(electronPdfLayout('version').footerTemplate)
  })

  it('le dashboard reste en portrait, sans pied de page', () => {
    for (const layout of [electronPdfLayout('dashboard'), playwrightPdfLayout('dashboard')]) {
      expect(layout.landscape).toBeUndefined()
      expect(layout.displayHeaderFooter).toBeUndefined()
      expect(layout.footerTemplate).toBeUndefined()
    }
  })
})
