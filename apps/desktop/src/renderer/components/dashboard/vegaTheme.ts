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

/**
 * Couleurs de série portées par les lignes (convention de l'hôte, GH74) :
 * `usermeta.polenta.seriesColors = { field, color, order? }` → l'échelle de chaque encodage `color`
 * sur `field` reçoit `domain` (valeurs distinctes, triées par `order` croissant puis par ordre
 * d'apparition) et `range` (couleur de la première ligne de chaque valeur, jeton `var(--…)` accepté).
 * Sert aux séries dont les valeurs ne sont pas connues à l'écriture de la spec (étapes d'avancement :
 * statuts de préparation du projet). Sans la convention, la spec est rendue telle quelle.
 */
export function applySeriesColors<T>(spec: T, rows: readonly Record<string, unknown>[]): T {
  const meta = (spec as { usermeta?: { polenta?: { seriesColors?: { field?: unknown; color?: unknown; order?: unknown } } } })?.usermeta?.polenta?.seriesColors
  if (!meta || typeof meta.field !== 'string' || typeof meta.color !== 'string') return spec
  const { field, color } = meta
  const order = typeof meta.order === 'string' ? meta.order : null
  // Valeurs gardées avec leur type (un domaine de chaînes ne reconnaîtrait pas des nombres).
  const seen = new Map<unknown, { color: unknown; order: number; index: number }>()
  rows.forEach((r, index) => {
    const v = r[field]
    if (v === null || v === undefined || seen.has(v)) return
    const o = order ? Number(r[order]) : NaN
    seen.set(v, { color: r[color], order: Number.isFinite(o) ? o : Infinity, index })
  })
  const entries = [...seen.entries()].sort((a, b) => a[1].order - b[1].order || a[1].index - b[1].index)
  const scale = { domain: entries.map(([v]) => v), range: entries.map(([, e]) => e.color) }
  const patch = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(patch)
    if (!node || typeof node !== 'object') return node
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'color' && v && typeof v === 'object' && (v as { field?: unknown }).field === field) {
        const { sort: _sort, ...rest } = v as Record<string, unknown>
        out[k] = { ...rest, scale: { ...((rest.scale as object | undefined) ?? {}), ...scale } }
      } else {
        out[k] = patch(v)
      }
    }
    return out
  }
  return patch(spec) as T
}

/**
 * Ligne d'origine d'un datum Vega : Vega travaille sur des copies dérivées (champs recopiés, dates
 * analysées en `Date`, bornes d'empilement ajoutées), l'identité d'objet est perdue. Retrouvée par
 * contenu : la seule ligne dont chaque colonne se retrouve dans le datum (date comparée à son
 * instant). Aucune ou plusieurs : `null` (le datum sert alors tel quel).
 */
export function originalRow(datum: Record<string, unknown>, rows: readonly Record<string, unknown>[]): Record<string, unknown> | null {
  const same = (a: unknown, b: unknown): boolean => {
    if (a === b) return true
    if (typeof b === 'string' && (a instanceof Date || typeof a === 'number')) {
      const t = Date.parse(b)
      return !Number.isNaN(t) && t === +a
    }
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
    return false
  }
  let found: Record<string, unknown> | null = null
  for (const r of rows) {
    if (!Object.keys(r).every((k) => same(datum[k], r[k]))) continue
    if (found) return null
    found = r
  }
  return found
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
