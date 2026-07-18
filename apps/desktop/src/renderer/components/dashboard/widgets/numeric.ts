/** Shared cell coercion helpers for the chart widgets (Bar/Pie/Line/Kpi) — the query
 *  result is a `Record<string, unknown>[]` (AlaSQL doesn't know the widget's intent),
 *  so any "measure"/"category" value must be defensively coerced before being handed
 *  to recharts, which otherwise renders nothing useful for `null`/objects/NaN. */

export function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function toLabel(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (v instanceof Date) return v.toLocaleDateString()
  return String(v)
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n)
}
