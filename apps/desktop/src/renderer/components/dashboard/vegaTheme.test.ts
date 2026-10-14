import { describe, expect, it } from 'vitest'
import { applySeriesColors, originalRow, resolveTokens } from './vegaTheme'

// GH74 — couleurs de série portées par les lignes (`usermeta.polenta.seriesColors`).

const SPEC = {
  data: { name: 'rows' },
  mark: 'bar',
  encoding: {
    x: { field: 'campaignTitle', type: 'nominal' },
    color: { field: 'stepLabel', type: 'nominal', sort: { field: 'stepRank', op: 'min' } },
  },
  usermeta: { polenta: { seriesColors: { field: 'stepLabel', color: 'stepColor', order: 'stepRank' } } },
}

const ROWS = [
  { campaignTitle: 'A', stepLabel: 'Passé', stepRank: 1004, stepColor: 'var(--chart-progress-pass)' },
  { campaignTitle: 'A', stepLabel: 'Brouillon', stepRank: 0, stepColor: 'var(--chart-progress-prep-1)' },
  { campaignTitle: 'B', stepLabel: 'Échoué', stepRank: 1003, stepColor: 'var(--chart-progress-fail)' },
  { campaignTitle: 'B', stepLabel: 'Brouillon', stepRank: 0, stepColor: 'var(--chart-progress-prep-1)' },
]

describe('applySeriesColors', () => {
  it('construit domaine (ordre de la colonne) et couleurs depuis les lignes ; jetons résolus ensuite', () => {
    const out = applySeriesColors(SPEC, ROWS)
    expect(out.encoding.color).toEqual({
      field: 'stepLabel', type: 'nominal',
      scale: {
        domain: ['Brouillon', 'Échoué', 'Passé'],
        range: ['var(--chart-progress-prep-1)', 'var(--chart-progress-fail)', 'var(--chart-progress-pass)'],
      },
    })
    const resolved = resolveTokens(out, (name) => `rgb(${name})`)
    expect((resolved.encoding.color as unknown as { scale: { range: string[] } }).scale.range[2]).toBe('rgb(chart-progress-pass)')
    expect(out.encoding.x).toEqual(SPEC.encoding.x)
  })

  it('valeurs de série numériques : domaine numérique (mêmes clés que les données)', () => {
    const spec = { ...SPEC, encoding: { color: { field: 'level', type: 'ordinal' } }, usermeta: { polenta: { seriesColors: { field: 'level', color: 'c' } } } }
    const out = applySeriesColors(spec, [{ level: 2, c: 'red' }, { level: 1, c: 'blue' }, { level: 2, c: 'red' }])
    expect((out.encoding.color as unknown as { scale: { domain: unknown[] } }).scale.domain).toEqual([2, 1])
  })

  it('sans la convention : spec inchangée', () => {
    const { usermeta: _u, ...plain } = SPEC
    expect(applySeriesColors(plain, ROWS)).toBe(plain)
  })

  it('sans colonne d\'ordre : ordre d\'apparition', () => {
    const spec = { ...SPEC, usermeta: { polenta: { seriesColors: { field: 'stepLabel', color: 'stepColor' } } } }
    expect((applySeriesColors(spec, ROWS).encoding.color as unknown as { scale: { domain: string[] } }).scale.domain).toEqual(['Passé', 'Brouillon', 'Échoué'])
  })
})

describe('originalRow', () => {
  const rows = [
    { date: '2026-10-13', status: 'PASS', count: 2, _ids: ['C/1', 'C/2'] },
    { date: '2026-10-14', status: 'PASS', count: 3 },
    { date: '2026-10-14', status: 'FAIL', count: 1 },
  ]
  it('retrouve la ligne d\'un datum dérivé (date analysée, champs ajoutés par Vega)', () => {
    const datum = { ...rows[1], date: new Date('2026-10-14'), count_start: 1, count_end: 4 }
    expect(originalRow(datum, rows)).toBe(rows[1])
    expect(originalRow({ ...rows[0], date: Date.parse('2026-10-13') }, rows)).toBe(rows[0])
  })
  it('aucune ou plusieurs lignes : null', () => {
    expect(originalRow({ date: '2026-10-15', status: 'PASS', count: 2 }, rows)).toBeNull()
    expect(originalRow({ a: 1 }, [{ a: 1 }, { a: 1 }])).toBeNull()
  })
})
