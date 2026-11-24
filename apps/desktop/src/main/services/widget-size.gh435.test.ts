import { describe, expect, it } from 'vitest'
import {
  clampWidgetHeight, clampWidgetWidth, DASHBOARD_GAP, DASHBOARD_REF_WIDTH, DASHBOARD_SMALL_ZONE, PRINT_MIN_FONT_PX, PRINT_SCALE,
  printContentWidth, printFontFloor, printLayoutWidth, printScale, readWidgetDim, WIDGET_MAX_HEIGHT, WIDGET_MIN_HEIGHT, WIDGET_MIN_WIDTH,
  WIDGET_PRESET_WIDTH, widgetDisplayWidth, widgetRequestedWidth,
} from '@polenta/types'

// GH435 — règles de dimension des widgets (specs/GH435-tests.md U1 à U5).

describe('U1 — bornage', () => {
  it('largeur : arrondie puis bornée de 240 à 1104', () => {
    expect(clampWidgetWidth(700)).toBe(700)
    expect(clampWidgetWidth(700.4)).toBe(700)
    expect(clampWidgetWidth(700.6)).toBe(701)
    expect(clampWidgetWidth(10)).toBe(WIDGET_MIN_WIDTH)
    expect(clampWidgetWidth(5000)).toBe(DASHBOARD_REF_WIDTH)
    expect(clampWidgetWidth(-3)).toBe(WIDGET_MIN_WIDTH)
  })

  it('largeur : un maximum plus étroit (zone) l\'emporte sur le minimum, sans dépasser W', () => {
    expect(clampWidgetWidth(900, 800)).toBe(800)
    expect(clampWidgetWidth(900, 200)).toBe(200)
    expect(clampWidgetWidth(900, 99999)).toBe(900)
    expect(clampWidgetWidth(2000, 99999)).toBe(DASHBOARD_REF_WIDTH)
  })

  it('hauteur : arrondie puis bornée de 160 à 720', () => {
    expect(clampWidgetHeight(400.2)).toBe(400)
    expect(clampWidgetHeight(0)).toBe(WIDGET_MIN_HEIGHT)
    expect(clampWidgetHeight(10_000)).toBe(WIDGET_MAX_HEIGHT)
  })
})

describe('U2 — dimension lue d\'un fichier', () => {
  it('un nombre fini est borné ; tout le reste est ignoré', () => {
    expect(readWidgetDim(640, 'width')).toBe(640)
    expect(readWidgetDim(5000, 'width')).toBe(DASHBOARD_REF_WIDTH)
    expect(readWidgetDim(10, 'height')).toBe(WIDGET_MIN_HEIGHT)
    for (const bad of ['640', '', null, undefined, Number.NaN, Infinity, -Infinity, {}, [], true]) {
      expect(readWidgetDim(bad, 'width')).toBeUndefined()
      expect(readWidgetDim(bad, 'height')).toBeUndefined()
    }
  })
})

describe('U3 — préréglages', () => {
  it('deux md + espacement = W ; quatre sm + 3 espacements = W ; sm ≥ minimum', () => {
    expect(WIDGET_PRESET_WIDTH.md * 2 + DASHBOARD_GAP).toBe(DASHBOARD_REF_WIDTH)
    expect(WIDGET_PRESET_WIDTH.sm * 4 + 3 * DASHBOARD_GAP).toBe(DASHBOARD_REF_WIDTH)
    expect(WIDGET_PRESET_WIDTH.lg).toBe(DASHBOARD_REF_WIDTH)
    expect(WIDGET_PRESET_WIDTH.sm).toBeGreaterThanOrEqual(WIDGET_MIN_WIDTH)
  })

  it('largeur demandée : la sienne, sinon celle du préréglage', () => {
    expect(widgetRequestedWidth({ size: 'md' })).toBe(544)
    expect(widgetRequestedWidth({ size: 'sm' })).toBe(264)
    expect(widgetRequestedWidth({ size: 'md', width: 700 })).toBe(700)
  })
})

describe('U4 — largeur affichée dans la zone', () => {
  it('zone large : largeur demandée ; zone plus étroite : bornée à la zone', () => {
    expect(widgetDisplayWidth(544, DASHBOARD_REF_WIDTH)).toBe(544)
    expect(widgetDisplayWidth(1104, 900)).toBe(900)
    expect(widgetDisplayWidth(300, 900)).toBe(300)
    expect(widgetDisplayWidth(100, 900)).toBe(WIDGET_MIN_WIDTH)
  })

  it('sous 640 px de zone : pleine largeur ; à 640 px, plus', () => {
    expect(widgetDisplayWidth(544, DASHBOARD_SMALL_ZONE - 1)).toBe('100%')
    expect(widgetDisplayWidth(544, 200)).toBe('100%')
    expect(widgetDisplayWidth(544, DASHBOARD_SMALL_ZONE)).toBe(544)
  })
})

describe('U5 — impression', () => {
  it('largeur utile A4 avec marges de 10 mm : 718,1 px', () => {
    expect(printContentWidth()).toBeCloseTo(718.11, 1)
  })

  it('échelle 0,65, arrondie vers le bas : la mise en page du moteur contient toujours W', () => {
    expect(PRINT_SCALE).toBe(0.65)
    expect(printScale()).toBe(0.65)
    expect(printLayoutWidth()).toBeGreaterThanOrEqual(DASHBOARD_REF_WIDTH)
    expect(printLayoutWidth()).toBeLessThan(DASHBOARD_REF_WIDTH + 2)
    // Toute largeur de référence : jamais d'échelle qui rognerait le contenu.
    for (const w of [800, 1000, 1104, 1200, 1500]) expect(printContentWidth() / printScale(w)).toBeGreaterThanOrEqual(w)
  })

  it('police de plancher : 13 px de mise en page = au moins 8 px imprimés', () => {
    expect(printFontFloor()).toBe(13)
    expect(printFontFloor() * PRINT_SCALE).toBeGreaterThanOrEqual(PRINT_MIN_FONT_PX)
  })
})
