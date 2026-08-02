/**
 * Categorical color slots shared by Bar/Pie/Line widgets (T77 sprint 2). Fixed order,
 * never cycled arbitrarily beyond this list (dataviz skill § color-formula) — the 8
 * hues map 1:1 to the `--chart-series-N` custom properties defined in `index.css`
 * (light + dark steps of the skill's own validated reference palette). Recharts marks
 * accept a CSS `var(...)` reference directly as their `fill`/`stroke` value, so light/
 * dark switching stays a single edit in `index.css` — nothing here is theme-aware.
 */
export const CHART_SERIES_COLORS = [
  'rgb(var(--chart-series-1))',
  'rgb(var(--chart-series-2))',
  'rgb(var(--chart-series-3))',
  'rgb(var(--chart-series-4))',
  'rgb(var(--chart-series-5))',
  'rgb(var(--chart-series-6))',
  'rgb(var(--chart-series-7))',
  'rgb(var(--chart-series-8))',
] as const

export function seriesColor(index: number): string {
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]
}
