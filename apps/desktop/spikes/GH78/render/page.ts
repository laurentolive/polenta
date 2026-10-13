/**
 * GH78 — page de rendu sous CSP stricte (pas de 'unsafe-eval') : les 3 widgets, thème clair et
 * sombre à partir des jetons CSS de l'application, interpréteur d'expressions Vega (AST), clic sur
 * une marque → `_ids` de la ligne d'origine. Résultats exposés dans `window.__gh78`.
 */
import { parse, View } from 'vega'
import { compile, type TopLevelSpec } from 'vega-lite'
import { expressionInterpreter } from 'vega-interpreter'
import embed from 'vega-embed'

type Row = Record<string, unknown> & { _ids: string[] }
interface Report {
  cspViolations: string[]
  evalBlocked: string
  widgets: Record<string, { theme: string; ok: boolean; error?: string; marks?: number; compileMs?: number; renderMs?: number; click?: unknown }[]>
  embed: { ok: boolean; error?: string }
  withoutInterpreter: string
  done: boolean
}
const report: Report = { cspViolations: [], evalBlocked: '', widgets: {}, embed: { ok: false }, withoutInterpreter: '', done: false }
;(window as unknown as { __gh78: Report }).__gh78 = report
let phase = 'contrôle eval'
document.addEventListener('securitypolicyviolation', e => report.cspViolations.push(`[${phase}] ${e.violatedDirective} ← ${e.blockedURI || e.sample}`))

// La CSP est-elle active ? (doit échouer)
try { new Function('return 1')(); report.evalBlocked = 'NON — new Function autorisé' } catch (e) { report.evalBlocked = `oui (${(e as Error).name})` }

/** Jetons « R G B » de l'app → couleurs CSS ; `var(--x)` dans la spec remplacé par la valeur du thème. */
function token(name: string, root: Element): string {
  const v = getComputedStyle(root).getPropertyValue(`--${name}`).trim()
  return v ? `rgb(${v.split(/\s+/).join(', ')})` : '#888'
}
function resolveTokens<T>(spec: T, root: Element): T {
  return JSON.parse(JSON.stringify(spec), (_k, v) => (typeof v === 'string' && /^var\(--[\w-]+\)$/.test(v) ? token(v.slice(6, -1), root) : v))
}
function themeConfig(root: Element) {
  const ink = token('ink', root), edge = token('edge', root), muted = token('activity-fg', root)
  return {
    background: token('surface', root),
    font: 'system-ui, sans-serif',
    title: { color: ink, fontSize: 13, anchor: 'start' as const },
    axis: { labelColor: muted, titleColor: ink, gridColor: edge, domainColor: edge, tickColor: edge },
    legend: { labelColor: muted, titleColor: ink },
    view: { stroke: 'transparent' },
    range: { category: Array.from({ length: 8 }, (_, i) => token(`chart-series-${i + 1}`, root)) },
  }
}

async function renderWidget(key: string, spec: TopLevelSpec, rows: Row[], themeRoot: HTMLElement) {
  const host = document.createElement('div')
  host.className = 'widget'
  host.dataset.widget = key
  themeRoot.querySelector('.grid')!.appendChild(host)
  const t0 = performance.now()
  const vl = compile(resolveTokens(spec, themeRoot) as TopLevelSpec, { config: themeConfig(themeRoot) })
  const t1 = performance.now()
  const runtime = parse(vl.spec, undefined, { ast: true })
  const view = new View(runtime, { expr: expressionInterpreter, renderer: 'svg', container: host, hover: true })
  view.data('rows', rows)
  await view.runAsync()
  const t2 = performance.now()
  const clicks: unknown[] = []
  view.addEventListener('click', (_e, item) => {
    const d = (item as { datum?: Row } | null)?.datum
    clicks.push(d ? { ids: d._ids, keys: Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('_') && k !== 'Symbol(vega_id)')) } : null)
  })
  return { view, host, compileMs: Math.round(t1 - t0), renderMs: Math.round(t2 - t1), clicks }
}

/** Clic simulé au centre de la n-ième marque interactive (path/rect SVG portant un item Vega). */
async function clickMark(host: HTMLElement, selector: string, index: number) {
  const marks = [...host.querySelectorAll<SVGGraphicsElement>(selector)].filter(m => m.getBBox().width > 0 && m.getBBox().height > 0)
  const m = marks[Math.min(index, marks.length - 1)]
  if (!m) return { marks: 0 }
  const r = m.getBoundingClientRect()
  const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window }
  m.dispatchEvent(new PointerEvent('pointerdown', opts)); m.dispatchEvent(new MouseEvent('mousedown', opts))
  m.dispatchEvent(new PointerEvent('pointerup', opts)); m.dispatchEvent(new MouseEvent('mouseup', opts))
  m.dispatchEvent(new MouseEvent('click', opts))
  await new Promise(res => setTimeout(res, 50))
  return { marks: marks.length }
}

async function main() {
  const [specs, rows] = await Promise.all([fetch('./data/specs.json').then(r => r.json()), fetch('./data/rows.json').then(r => r.json())])
  const selectors: Record<string, string> = { a: '.mark-rect path', b: '.mark-rect path', c: '.layer_1_marks path, .mark-rect path' }
  for (const theme of ['light', 'dark']) {
    const root = document.getElementById(theme)!
    for (const key of ['a', 'b', 'c']) {
      phase = 'widget ' + key + ' ' + theme
      const entry: Report['widgets'][string][number] = { theme, ok: false }
      ;(report.widgets[key] ??= []).push(entry)
      try {
        const { host, compileMs, renderMs, clicks } = await renderWidget(key, specs[key], rows[key], root)
        const { marks } = await clickMark(host, selectors[key], key === 'c' ? 40 : 2)
        Object.assign(entry, { ok: true, compileMs, renderMs, marks, click: clicks[0] ?? 'aucun clic reçu' })
      } catch (e) {
        entry.error = String((e as Error).stack ?? e).slice(0, 400)
      }
    }
  }
  phase = 'vega-embed'
  // vega-embed sous la même CSP (options ast + interpréteur, sans styles injectés).
  try {
    const el = document.createElement('div'); document.getElementById('light')!.appendChild(el)
    await embed(el, resolveTokens({ ...specs.a, data: { values: rows.a } }, document.getElementById('light')!), { ast: true, expr: expressionInterpreter, actions: false, defaultStyle: false, renderer: 'svg' })
    report.embed = { ok: true }
  } catch (e) { report.embed = { ok: false, error: String(e).slice(0, 300) } }
  phase = 'contrôle sans interpréteur'
  // Contrôle négatif : sans interpréteur, Vega compile ses expressions avec Function → bloqué par la CSP.
  try {
    const el = document.createElement('div'); document.body.appendChild(el)
    const v = new View(parse(compile(resolveTokens(specs.a, document.body) as TopLevelSpec).spec), { renderer: 'svg', container: el })
    v.data('rows', rows.a); await v.runAsync()
    report.withoutInterpreter = 'rendu SANS interpréteur (la CSP ne bloque pas eval ?)'
  } catch (e) { report.withoutInterpreter = `bloqué comme attendu : ${(e as Error).name}: ${(e as Error).message.slice(0, 120)}` }
  report.done = true
}
void main().catch(e => { report.widgets.fatal = [{ theme: '-', ok: false, error: String(e) }]; report.done = true })
