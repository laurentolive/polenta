import { describe, expect, it } from 'vitest'
import { DASHBOARD_REF_WIDTH, PRINT_MARGIN_MM, PRINT_SCALE, printContentWidth } from '@polenta/types'
import { electronPdfLayout, PDF_LAYOUT_BY_KIND, playwrightPdfLayout, PRINT_ROUTE_BY_KIND } from './print-renderer'

// GH435 — échelle et marges de l'export PDF d'un dashboard (specs/GH435-tests.md U15).

const OTHER_KINDS = (Object.keys(PRINT_ROUTE_BY_KIND) as Array<keyof typeof PRINT_ROUTE_BY_KIND>).filter(k => k !== 'dashboard' && k !== 'version')

describe('U15 — mise en page PDF par type d\'export', () => {
  it("seuls le dashboard et, depuis GH439, la page d'une version ont une mise en page propre", () => {
    expect(Object.keys(PDF_LAYOUT_BY_KIND)).toEqual(['dashboard', 'version'])
    expect(PDF_LAYOUT_BY_KIND.dashboard).toEqual({ scale: PRINT_SCALE, marginMm: PRINT_MARGIN_MM })
  })

  it('Electron : échelle 0,65 et marges de 10 mm en pouces, identiques sur les quatre côtés', () => {
    const layout = electronPdfLayout('dashboard')
    expect(layout.scale).toBe(0.65)
    const inch = 10 / 25.4
    expect(layout.margins).toEqual({ top: inch, bottom: inch, left: inch, right: inch })
  })

  it('Playwright : même échelle, marges de 10 mm', () => {
    expect(playwrightPdfLayout('dashboard')).toEqual({
      scale: 0.65,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    })
  })

  it('les deux moteurs reçoivent la même mise en page', () => {
    const electron = electronPdfLayout('dashboard')
    const playwright = playwrightPdfLayout('dashboard')
    expect(electron.scale).toBe(playwright.scale)
    expect(electron.margins!.left * 25.4).toBeCloseTo(parseFloat(playwright.margin!.left), 6)
  })

  it('la grille de référence tient dans la page : largeur utile / échelle ≥ W', () => {
    expect(printContentWidth() / PDF_LAYOUT_BY_KIND.dashboard!.scale).toBeGreaterThanOrEqual(DASHBOARD_REF_WIDTH)
  })

  it('les autres exports gardent les options par défaut de leur moteur', () => {
    expect(OTHER_KINDS.length).toBeGreaterThan(3)
    for (const kind of OTHER_KINDS) {
      expect(electronPdfLayout(kind), kind).toEqual({})
      expect(playwrightPdfLayout(kind), kind).toEqual({})
    }
  })
})
