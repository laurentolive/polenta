import { describe, expect, it } from 'vitest'
import * as vega from 'vega'
import { compile } from 'vega-lite'
import { fitSpec, isTooSmall, measureChart, MIN_PLOT_PX, type FitInput, type MeasurableView, type Spec } from './vegaFit'
import { themeConfig } from './vegaTheme'

// GH435 — adaptation des légendes à la taille de la carte (specs/GH435-tests.md U12 à U14).

const LONG = (i: number) => `Série numéro ${i} avec un libellé de plus de trente caractères`
const ROWS_LONG = Array.from({ length: 9 }, (_, i) => ({ cat: 'A', serie: LONG(i + 1), n: i + 1 }))
const ROWS_SHORT = [{ cat: 'A', serie: 'Oui', n: 1 }, { cat: 'A', serie: 'Non', n: 2 }]

const BAR = (legend?: unknown): Spec => ({
  data: { name: 'rows' },
  mark: 'bar',
  encoding: {
    x: { field: 'cat', type: 'nominal' },
    y: { field: 'n', type: 'quantitative' },
    color: { field: 'serie', type: 'nominal', ...(legend !== undefined ? { legend } : {}) },
  },
})
const legendOf = (spec: Spec, channel = 'color') => ((spec.encoding as Record<string, { legend?: Record<string, unknown> | null }>)[channel]).legend
const input = (width: number, height: number, rows: FitInput['rows'], minFont?: number): FitInput => ({ width, height, rows, minFont })

describe('U12 — place et limites de la légende', () => {
  it('peu d\'entrées courtes dans un graphique large : à droite, sans limite d\'entrées', () => {
    const legend = legendOf(fitSpec(BAR(), input(600, 300, ROWS_SHORT)))!
    expect(legend).toMatchObject({ orient: 'right', symbolLimit: 0 })
    expect(legend.labelLimit as number).toBeGreaterThanOrEqual(3 * 10 * 0.58)
  })

  it('9 entrées de plus de 30 caractères en 544 × 256 : en bas, en colonnes, libellés jamais coupés', () => {
    const legend = legendOf(fitSpec(BAR(), input(544, 256, ROWS_LONG)))!
    const longest = Math.max(...ROWS_LONG.map(r => r.serie.length))
    expect(legend).toMatchObject({ orient: 'bottom', direction: 'horizontal', symbolLimit: 0 })
    expect(legend.columns as number).toBeGreaterThanOrEqual(1)
    expect(legend.labelLimit as number).toBeGreaterThanOrEqual(Math.floor(longest * 10 * 0.58))
  })

  it('en 264 px (sm) : une seule colonne, libellé borné à la place disponible', () => {
    const legend = legendOf(fitSpec(BAR(), input(264, 256, ROWS_LONG)))!
    expect(legend).toMatchObject({ orient: 'bottom', columns: 1 })
    expect(legend.labelLimit as number).toBeLessThanOrEqual(264 - 24 - 16 - 8)
  })

  it('pleine largeur (1104) avec libellés longs : à droite, car la légende tient dans 40 % de la largeur', () => {
    const legend = legendOf(fitSpec(BAR(), input(1104, 256, ROWS_LONG.slice(0, 4))))!
    expect(legend.orient).toBe('right')
  })

  it('trop d\'entrées pour la hauteur : en bas même si la largeur le permettrait', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ cat: 'A', serie: `S${i}`, n: i }))
    expect(legendOf(fitSpec(BAR(), input(1104, 256, rows)))!.orient).toBe('bottom')
  })

  it('police plus grande (impression) : la légende à droite tient moins vite', () => {
    const rows = [1, 2, 3, 4, 5, 6].map(i => ({ cat: 'A', serie: `Série numéro ${i}`, n: i }))
    expect(legendOf(fitSpec(BAR(), input(380, 300, rows, 10)))!.orient).toBe('right')
    expect(legendOf(fitSpec(BAR(), input(380, 300, rows, 13)))!.orient).toBe('bottom')
  })

  it('le domaine explicite de l\'échelle donne les entrées (séries inconnues des lignes)', () => {
    const spec: Spec = { ...BAR(), encoding: { ...(BAR().encoding as object), color: { field: 'serie', type: 'nominal', scale: { domain: ROWS_LONG.map(r => r.serie), range: ROWS_LONG.map(() => 'red') } } } }
    expect(legendOf(fitSpec(spec, input(544, 256, [])))!.orient).toBe('bottom')
  })
})

describe('U13 — ce qui n\'est pas touché', () => {
  it('clés de légende écrites par l\'utilisateur conservées, le reste calculé', () => {
    const legend = legendOf(fitSpec(BAR({ orient: 'top', labelLimit: 100, title: null, symbolOpacity: 1 }), input(544, 256, ROWS_LONG)))!
    expect(legend).toMatchObject({ orient: 'top', labelLimit: 100, title: null, symbolOpacity: 1, symbolLimit: 0, direction: 'horizontal' })
  })

  it('orientation imposée en haut ou en bas : la rangée passe en colonnes ; à droite ou dans un coin : limites seules', () => {
    const top = legendOf(fitSpec(BAR({ orient: 'top' }), input(544, 256, ROWS_LONG)))!
    expect(top.orient).toBe('top')
    expect(top.columns as number).toBeGreaterThanOrEqual(1)
    const bottom = legendOf(fitSpec(BAR({ orient: 'bottom' }), input(1104, 256, ROWS_LONG)))!
    expect(bottom.columns as number).toBeGreaterThan(top.columns as number)
    for (const orient of ['right', 'left', 'top-left', 'bottom-right', 'none']) {
      const legend = legendOf(fitSpec(BAR({ orient }), input(544, 256, ROWS_LONG)))!
      expect(legend.orient, orient).toBe(orient)
      expect(legend, orient).not.toHaveProperty('columns')
      expect(legend, orient).not.toHaveProperty('direction')
      expect(legend.symbolLimit, orient).toBe(0)
    }
  })

  it('legend: null, champ quantitatif, spec sans encodage : rendus tels quels', () => {
    const hidden = BAR(null)
    const fitted = fitSpec(hidden, input(544, 256, ROWS_LONG))
    expect(legendOf(fitted)).toBeNull()
    expect((fitted.encoding as Record<string, unknown>).color).toEqual((hidden.encoding as Record<string, unknown>).color)
    const quant: Spec = { mark: 'bar', encoding: { color: { field: 'n', type: 'quantitative' } } }
    expect(fitSpec(quant, input(544, 256, ROWS_LONG))).toEqual(quant)
    const bare: Spec = { data: { name: 'rows' }, mark: 'text' }
    expect(fitSpec(bare, input(544, 256, ROWS_LONG))).toEqual(bare)
  })

  it('ne modifie pas la spec reçue', () => {
    const spec = BAR()
    const snapshot = JSON.parse(JSON.stringify(spec))
    fitSpec(spec, input(544, 256, ROWS_LONG))
    expect(spec).toEqual(snapshot)
  })

  it('encodages des couches : chacun adapté', () => {
    const layered: Spec = { data: { name: 'rows' }, layer: [BAR(), { mark: 'line', encoding: (BAR().encoding as object) }] }
    const out = fitSpec(layered, input(544, 256, ROWS_LONG)) as { layer: Spec[] }
    expect((out.layer[0].encoding as { color: { legend: { orient: string } } }).color.legend.orient).toBe('bottom')
    expect((out.layer[1].encoding as { color: { legend: { orient: string } } }).color.legend.orient).toBe('bottom')
  })
})

describe('U14 — axes de catégories', () => {
  const horizontalBars = (axis?: unknown): Spec => ({
    mark: 'bar',
    encoding: { y: { field: 'serie', type: 'nominal', ...(axis !== undefined ? { axis } : {}) }, x: { field: 'n', type: 'quantitative' } },
  })
  const axisOf = (spec: Spec, channel: 'x' | 'y') => ((spec.encoding as Record<string, { axis?: Record<string, unknown> }>)[channel]).axis

  it('axe y : le libellé ne prend pas plus de 40 % de la largeur', () => {
    const limit = axisOf(fitSpec(horizontalBars(), input(500, 300, ROWS_LONG)), 'y')!.labelLimit as number
    expect(limit).toBeLessThanOrEqual(500 * 0.4)
    expect(limit).toBeGreaterThanOrEqual(40)
  })

  it('axe x : 35 % de la hauteur ; libellés courts : limite à leur taille', () => {
    const spec: Spec = { mark: 'bar', encoding: { x: { field: 'serie', type: 'nominal' }, y: { field: 'n', type: 'quantitative' } } }
    expect(axisOf(fitSpec(spec, input(500, 300, ROWS_LONG)), 'x')!.labelLimit as number).toBeLessThanOrEqual(300 * 0.35)
    const short = fitSpec(horizontalBars(), input(500, 300, ROWS_SHORT))
    expect(axisOf(short, 'y')!.labelLimit as number).toBeLessThan(60)
  })

  it('axe de l\'utilisateur conservé ; axis: null intact', () => {
    expect(axisOf(fitSpec(horizontalBars({ labelLimit: 999 }), input(500, 300, ROWS_LONG)), 'y')!.labelLimit).toBe(999)
    expect(axisOf(fitSpec(horizontalBars(null), input(500, 300, ROWS_LONG)), 'y')).toBeNull()
  })
})

// ─── Mesure sur une vue Vega rendue (sans navigateur : `renderer: 'none'`) ───────────────────────────────
// Sans canevas, Vega estime la largeur du texte (plus large que la réalité) : les cas ci-dessous sont des
// cas nets, la vérification dans un vrai navigateur est celle des e2e.

async function render(spec: Spec, rows: FitInput['rows'], size: { width: number; height: number }, fit = true): Promise<MeasurableView> {
  const prepared = fit ? fitSpec(spec, { ...size, rows }) : spec
  const full = { width: size.width, height: size.height, autosize: { type: 'fit', contains: 'padding' }, ...prepared, data: { name: 'rows' }, config: themeConfig(() => null) }
  const view = new vega.View(vega.parse(compile(full as never).spec), { renderer: 'none' })
  await view.runAsync()
  // Même enchaînement que `VegaView` : lignes injectées, puis second passage de la mise en page `fit`.
  await view.data('rows', rows.map(r => ({ ...r }))).runAsync()
  await view.resize().runAsync()
  return view as unknown as MeasurableView
}
const LABEL34 = (i: number) => `Série ${i} libellé de trente-quatre`.padEnd(34, '.')
const ROWS_34 = Array.from({ length: 9 }, (_, i) => ({ cat: 'A', serie: LABEL34(i + 1), n: i + 1 }))

describe('U12b — mesure du graphique rendu', () => {
  it('assez de place : tracé d\'au moins 48 px, légende dans la vue, pas « trop petit »', async () => {
    const size = { width: 600, height: 300 }
    const m = measureChart(await render(BAR(), ROWS_SHORT, size), size)
    expect(m.plotWidth).toBeGreaterThanOrEqual(MIN_PLOT_PX)
    expect(m.plotHeight).toBeGreaterThanOrEqual(MIN_PLOT_PX)
    expect(m.legendClipped).toBe(false)
    expect(isTooSmall(m)).toBe(false)
  })

  it('9 séries de 34 caractères dans 528 × 207 (corps d\'un widget md) : légende en bas, tout visible', async () => {
    const size = { width: 528, height: 207 }
    const m = measureChart(await render(BAR(), ROWS_34, size), size)
    expect(m.legendClipped).toBe(false)
    expect(isTooSmall(m), `tracé ${m.plotWidth} × ${m.plotHeight}`).toBe(false)
  })

  it('mêmes séries dans 240 × 120 : trop petit (jamais un tracé tronqué)', async () => {
    const size = { width: 240, height: 120 }
    expect(isTooSmall(measureChart(await render(BAR(), ROWS_34, size), size))).toBe(true)
  })

  it('légende imposée à droite et plus haute que la vue : détectée comme coupée', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ cat: 'A', serie: `S${i}`, n: i }))
    const size = { width: 400, height: 200 }
    const m = measureChart(await render(BAR({ orient: 'right' }), rows, size), size)
    expect(m.legendClipped).toBe(true)
    expect(isTooSmall(m)).toBe(true)
  })
})
