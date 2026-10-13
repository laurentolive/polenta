/**
 * GH78 — question 6 : scripts + specs écrits par une IA à partir du seul contrat (`contract.ts`).
 * Chaque sortie est exécutée dans le bac à sable sur le graphe de démo, comparée à la sortie du
 * widget de référence (mêmes agrégats), et sa spec est compilée par Vega-Lite.
 * Entrée : `ai/<cas>/widget.js|spec.vl.json` (copie versionnée des sorties d'agents). Écrit `results/ai.json`.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
// vega-lite (ESM, await de premier niveau dans vega-canvas) : import dynamique, pas de require CJS.
import { loadQuickJS, runFresh } from './sandbox'
import { loadLibrary, loadWidget, SPIKE_DIR, type WidgetKey } from './widgets'

const AI_DIR = path.join(SPIKE_DIR, 'ai')
const RESULTS = path.join(SPIKE_DIR, 'results')
const PARAMS: Record<WidgetKey, Record<string, unknown>> = { a: {}, b: {}, c: { campaignId: 'CAMP-0002' } }

type R = Record<string, unknown>
/** Agrégat comparable, indépendant des noms de colonnes choisis par l'IA. */
function signature(key: WidgetKey, rows: R[]): Map<string, number> {
  const m = new Map<string, number>()
  const add = (k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n)
  for (const r of rows) {
    const ids = (r._ids as string[]) ?? []
    const vals = Object.values(r).filter(v => typeof v === 'string') as string[]
    const status = vals.find(v => /^(draft|review|approved|obsolete|PASS|FAIL|BLOCKED|INCOMPLETE|pending)$/.test(v)) ?? '?'
    const count = typeof r.count === 'number' ? r.count : ids.length
    if (key === 'a') add(`${vals.find(v => !/^(draft|review|approved|obsolete)$/.test(v) && !/^[A-Z]+-\d+$/.test(v))}|${status}`, count)
    if (key === 'b') add(`${vals.find(v => /^T[A-Z]+-\d+$/.test(v)) ?? ids.find(i => /^T/.test(i))}|${vals.find(v => /^CAMP-\d+$/.test(v)) ?? ids.find(i => /^CAMP/.test(i))}|${status}`, 1)
    if (key === 'c') {
      const d = vals.find(v => /^\d{4}-\d{2}-\d{2}/.test(v)) ?? (typeof r.date === 'number' ? new Date(r.date).toISOString() : '?')
      if (count > 0) add(`${d.slice(0, 10)}|${status}`, count)
    }
  }
  return m
}
function diff(ref: Map<string, number>, got: Map<string, number>) {
  const keys = new Set([...ref.keys(), ...got.keys()])
  const mismatches: string[] = []
  for (const k of keys) if ((ref.get(k) ?? 0) !== (got.get(k) ?? 0)) mismatches.push(`${k}: attendu ${ref.get(k) ?? 0}, obtenu ${got.get(k) ?? 0}`)
  return { equal: mismatches.length === 0, mismatches: mismatches.length, sample: mismatches.slice(0, 8) }
}

export async function runAiEval() {
  const graphJson = fs.readFileSync(path.join(RESULTS, 'graph-demo.json'), 'utf8')
  const qjs = await loadQuickJS()
  const out: Record<string, unknown> = {}
  for (const key of ['a', 'b', 'c'] as WidgetKey[]) {
    const dir = path.join(AI_DIR, key)
    if (!fs.existsSync(path.join(dir, 'widget.js'))) { out[key] = 'absent'; continue }
    const host = { contractVersion: 1 as const, now: '2026-10-13T12:00:00Z', params: PARAMS[key] }
    const ref = runFresh(qjs, graphJson, loadLibrary(), loadWidget(key).script, host)
    const ai = runFresh(qjs, graphJson, {}, fs.readFileSync(path.join(dir, 'widget.js'), 'utf8'), host)
    let specResult: unknown
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(dir, 'spec.vl.json'), 'utf8'))
      const fields = new Set(ai.ok ? ai.rows.flatMap(r => Object.keys(r)) : [])
      const used = [...JSON.stringify(spec).matchAll(/"field"\s*:\s*"([^"]+)"/g)].map(m => m[1])
      const { compile } = await import('vega-lite')
      compile(spec)
      specResult = { compiles: true, unknownFields: used.filter(f => !fields.has(f)) }
    } catch (e) { specResult = { compiles: false, error: String(e).slice(0, 300) } }
    out[key] = {
      run: ai.ok ? { ok: true, rows: ai.rows.length, columns: Object.keys(ai.rows[0] ?? {}) } : { ok: false, error: ai.error },
      matchesReference: ai.ok && ref.ok ? diff(signature(key, ref.rows), signature(key, ai.rows)) : null,
      spec: specResult,
    }
  }
  fs.writeFileSync(path.join(RESULTS, 'ai.json'), JSON.stringify(out, null, 2))
  return out
}

if (require.main === module) void runAiEval().then(r => console.log(JSON.stringify(r, null, 1))).catch(e => { console.error(e); process.exit(1) })
