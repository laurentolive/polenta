import { describe, expect, it } from 'vitest'
import { PRINT_MIN_FONT_PX, PRINT_SCALE, printFontFloor } from '@polenta/types'
import { CHART_FONT_PX, themeConfig } from './vegaTheme'

// GH435 — taille de police des axes et légendes : 10 px à l'écran, relevée à l'impression (U16).

type Config = { axis: { labelFontSize: number; titleFontSize: number }; legend: { labelFontSize: number; titleFontSize: number } }

describe('U16 — police des graphiques', () => {
  it('10 px par défaut', () => {
    const c = themeConfig(() => null) as Config
    expect(CHART_FONT_PX).toBe(10)
    expect([c.axis.labelFontSize, c.axis.titleFontSize, c.legend.labelFontSize, c.legend.titleFontSize]).toEqual([10, 10, 10, 10])
  })

  it('à l\'impression : plancher qui donne au moins 8 px une fois l\'échelle appliquée', () => {
    const font = printFontFloor()
    const c = themeConfig(() => null, font) as Config
    for (const size of [c.axis.labelFontSize, c.axis.titleFontSize, c.legend.labelFontSize, c.legend.titleFontSize]) {
      expect(size).toBe(font)
      expect(size * PRINT_SCALE).toBeGreaterThanOrEqual(PRINT_MIN_FONT_PX)
    }
  })
})
