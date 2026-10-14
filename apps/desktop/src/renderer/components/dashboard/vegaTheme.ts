/**
 * GH74 — thème des specs Vega-Lite (specs/GH74.md §3) : une spec désigne ses couleurs par jeton
 * (`"var(--status-success-solid)"`), remplacé ici par la valeur du thème courant (jetons « R G B »
 * de `theme.config.ts`, exposés en variables CSS) ; la `config` Vega (axes, légendes, fond, palette)
 * est dérivée des mêmes jetons. Un changement de thème impose de recompiler la spec.
 */

const TOKEN = /^var\(--([a-z0-9-]+)\)$/

/** Couleur CSS d'un jeton du thème courant (`rgb(r g b)`), ou `null` s'il n'existe pas. */
export function tokenColor(name: string, root: HTMLElement = document.documentElement): string | null {
  const raw = getComputedStyle(root).getPropertyValue(`--${name}`).trim()
  return raw ? `rgb(${raw})` : null
}

/** Copie de la spec dont toutes les valeurs `var(--jeton)` sont remplacées par leur couleur. */
export function resolveTokens<T>(value: T, resolve: (name: string) => string | null = tokenColor): T {
  if (typeof value === 'string') {
    const m = TOKEN.exec(value)
    return (m ? resolve(m[1]) ?? value : value) as T
  }
  if (Array.isArray(value)) return value.map((v) => resolveTokens(v, resolve)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveTokens(v, resolve)])) as T
  }
  return value
}

/** `config` Vega-Lite dérivée des jetons du thème courant. */
export function themeConfig(resolve: (name: string) => string | null = tokenColor): Record<string, unknown> {
  const c = (name: string, fallback: string) => resolve(name) ?? fallback
  const ink = c('ink', '#0f172a')
  const ink2 = c('activity-fg', '#475569')
  const edge = c('edge', '#e2e8f0')
  const series = Array.from({ length: 8 }, (_, i) => c(`chart-series-${i + 1}`, '#2a78d6'))
  return {
    background: 'transparent',
    font: 'system-ui, sans-serif',
    view: { stroke: 'transparent' },
    axis: { domainColor: edge, gridColor: edge, tickColor: edge, labelColor: ink2, titleColor: ink2, labelFontSize: 10, titleFontSize: 10 },
    legend: { labelColor: ink, titleColor: ink2, labelFontSize: 10, titleFontSize: 10, symbolType: 'square' },
    title: { color: ink },
    text: { color: ink },
    range: { category: series },
    mark: { color: series[0] },
    bar: { cornerRadiusEnd: 2 },
  }
}

/** Mesures agrégées par Vega-Lite (qui perdent `_ids`) : pour avertir dans l'éditeur. */
export function hasVegaAggregate(spec: unknown): boolean {
  return /"aggregate"\s*:/.test(JSON.stringify(spec ?? null))
}
