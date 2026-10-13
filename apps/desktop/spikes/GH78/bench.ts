/**
 * GH78 — mesures : construction du graphe, passage dans QuickJS, exécution des 3 scripts
 * (frais / contexte en cache), bibliothèque projet, limites, isolation.
 * Écrit `results/bench.json`. Lancé par `run.ts`.
 */
import '../../scripts/register-brand'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { graphSource } from './build-graph'
import { inflate } from './inflate'
import { DEFAULT_LIMITS, loadQuickJS, loadQuickJSCapped, prepare, PreparedContext, runFresh, type Library, type RunResult } from './sandbox'
import { loadLibrary, loadWidget, syntheticLibrary, SPIKE_DIR, type WidgetKey } from './widgets'
import type { PolentaGraph, PolentaHost } from './contract'

const quietLog = console.log
console.log = (...a: unknown[]) => { if (!/Index\]/.test(String(a[0]))) quietLog(...a) }
const say = (...a: unknown[]) => quietLog('[bench]', ...a)

const DEMO_WS = path.resolve(process.env.GH78_DEMO_WS ?? path.join(SPIKE_DIR, '../../../../../demo-lave-linge'))
const ROOT_REPO = 'll800-produit'
const DATA_DIR = path.join(SPIKE_DIR, '.data')
const RESULTS = path.join(SPIKE_DIR, 'results')
const NOW = '2026-10-13T12:00:00Z'
const FACTORS = (process.env.GH78_FACTORS ?? '1,10,50').split(',').map(Number)

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN }
const r1 = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? null : Math.round(x * 10) / 10)
const stats = (xs: number[]) => ({ median: r1(median(xs)), min: r1(Math.min(...xs)), max: r1(Math.max(...xs)), n: xs.length })

function counts(g: PolentaGraph) {
  return {
    requirements: g.requirements.length, tests: g.tests.length, links: g.links.length, campaigns: g.campaigns.length,
    entries: g.campaigns.reduce((n, c) => n + c.entries.length, 0), runs: g.runs.length,
  }
}

function biggestCampaign(g: PolentaGraph): string {
  return [...g.campaigns].sort((a, b) => b.entries.length - a.entries.length || (a.id < b.id ? -1 : 1))[0].id
}

type Case = { name: string; widget: WidgetKey; params: Record<string, unknown> }

/** Copie le widget et la bibliothèque en .mjs (imports `lib/…` réécrits) pour les importer dans Node. */
async function nativeWidget(key: WidgetKey): Promise<(g: PolentaGraph, h: PolentaHost) => unknown> {
  const dir = path.join(DATA_DIR, 'native')
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
  const toMjs = (src: string, prefix: string) => src.replace(/from '(?:lib\/|\.\/)([\w-]+)\.js'/g, `from '${prefix}$1.mjs'`)
  for (const [name, src] of Object.entries(loadLibrary())) fs.writeFileSync(path.join(dir, name.replace(/\.js$/, '.mjs')), toMjs(src, './'))
  const file = path.join(dir, `${key}.mjs`)
  fs.writeFileSync(file, toMjs(loadWidget(key).script, './lib/'))
  const mod = await import(pathToFileURL(file).href)
  return mod.default
}

async function benchDataset(factor: number, qjs: Awaited<ReturnType<typeof loadQuickJS>>, lib: Library) {
  let ws = DEMO_WS
  if (factor > 1) {
    ws = path.join(DATA_DIR, `x${factor}`)
    const t = performance.now()
    inflate(DEMO_WS, ws, factor)
    say(`x${factor} prêt (${Math.round(performance.now() - t)} ms)`)
  }
  // Construction : froide (index vides, lecture disque + git log) puis chaude (index en mémoire).
  const src = graphSource(ws, ROOT_REPO)
  const cold = await src.build({ simulate: true })
  const warm: number[] = []
  let graph = cold.graph
  for (let i = 0; i < 5; i++) { const b = await src.build({ simulate: true }); warm.push(b.timings.fetchMs + b.timings.assembleMs); graph = b.graph }
  const tS = performance.now()
  const json = JSON.stringify(graph)
  const stringifyMs = performance.now() - tS
  const host = (params: Record<string, unknown>): PolentaHost => ({ contractVersion: 1, now: NOW, params })

  const cases: Case[] = [
    { name: 'a', widget: 'a', params: {} },
    { name: 'b', widget: 'b', params: {} },
    { name: 'c (1 campagne)', widget: 'c', params: { campaignId: biggestCampaign(graph) } },
    { name: 'c (toutes campagnes)', widget: 'c', params: {} },
    { name: 'c (toutes, sans _ids)', widget: 'c', params: { ids: false } },
  ]

  // Mode frais : un runtime par exécution.
  const fresh: Record<string, unknown> = {}
  for (const c of cases) {
    const script = loadWidget(c.widget).script
    const runs: RunResult[] = []
    for (let i = 0; i < 5; i++) runs.push(runFresh(qjs, json, lib, script, host(c.params)))
    const bad = runs.find(r => !r.ok)
    if (bad && !bad.ok) throw new Error(`${c.name} x${factor} : ${bad.error.message}`)
    const pick = (k: 'copyMs' | 'parseMs' | 'freezeMs' | 'execMs' | 'outputMs' | 'totalMs') => stats(runs.map(r => (r.timings as Record<string, number>)[k]))
    fresh[c.name] = { rows: (runs[0] as { rows: unknown[] }).rows.length, total: pick('totalMs'), copy: pick('copyMs'), parse: pick('parseMs'), freeze: pick('freezeMs'), exec: pick('execMs'), output: pick('outputMs') }
  }

  // Mode cache : graphe parsé/gelé une fois, bibliothèque compilée au premier import.
  const tP = performance.now()
  const ctx = prepare(qjs, json, lib)
  const prepareMs = performance.now() - tP
  const memAfterPrepare = ctx.memoryUsedBytes
  const prep = ctx.prepTimings
  const cached: Record<string, unknown> = {}
  for (const c of cases) {
    const script = loadWidget(c.widget).script
    const first = ctx.run(script, host(c.params))
    if (!first.ok) throw new Error(`${c.name} cache x${factor} : ${first.error.message}`)
    const times: number[] = []
    for (let i = 0; i < 10; i++) { const r = ctx.run(script, host(c.params)); times.push(r.timings.totalMs!) }
    cached[c.name] = { first: r1(first.timings.totalMs), next: stats(times), outputKb: r1(JSON.stringify(first.rows).length / 1024) }
  }
  // Référence : mêmes scripts exécutés nativement par V8 (hors bac à sable), graphe déjà en objet.
  const native: Record<string, unknown> = {}
  for (const c of cases) {
    const fn = await nativeWidget(c.widget)
    const times: number[] = []
    for (let i = 0; i < 6; i++) { const t = performance.now(); fn(graph, host(c.params)); times.push(performance.now() - t) }
    native[c.name] = stats(times.slice(1))
  }
  const memAfterRuns = ctx.memoryUsedBytes
  const wasmMemMb = PreparedContext.wasmMemoryMb(qjs)
  ctx.dispose()
  // Contexte durci : coût du durcissement et effet sur l'exécution de (c).
  const hard = prepare(qjs, json, lib, DEFAULT_LIMITS, { harden: true })
  const cScript = loadWidget('c').script
  hard.run(cScript, host({}))
  const hardTimes: number[] = []
  for (let i = 0; i < 5; i++) hardTimes.push(hard.run(cScript, host({})).timings.totalMs!)
  const hardened = { hardenMs: r1(hard.prepTimings.hardenMs), cAllCampaigns: stats(hardTimes) }
  hard.dispose()

  // Sans gel : pour isoler le coût du gel dans la préparation.
  const ctxNoFreeze = prepare(qjs, json, lib, DEFAULT_LIMITS, { freeze: false })
  const noFreeze = ctxNoFreeze.prepTimings
  ctxNoFreeze.dispose()

  return {
    factor, counts: counts(graph), graphJsonKb: r1(json.length / 1024),
    build: { coldMs: r1(cold.timings.fetchMs + cold.timings.assembleMs), coldFetchMs: r1(cold.timings.fetchMs), warm: stats(warm), stringifyMs: r1(stringifyMs) },
    fresh,
    native,
    cached: { prepareMs: r1(prepareMs), prepTimings: { copyMs: r1(prep.copyMs), parseMs: r1(prep.parseMs), freezeMs: r1(prep.freezeMs) },memAfterPrepareMb: r1(memAfterPrepare / 1048576), memAfterRunsMb: r1(memAfterRuns / 1048576), noFreezePrep: { copyMs: r1(noFreeze.copyMs), parseMs: r1(noFreeze.parseMs) }, runs: cached, hardened },
    memory: { quickjsHeapMb: r1(memAfterRuns / 1048576), wasmLinearMemoryMb: r1(wasmMemMb), processRssMb: r1(process.memoryUsage().rss / 1048576), hostHeapMb: r1(process.memoryUsage().heapUsed / 1048576) },
    _json: json,
  }
}

/** 3 bis — chargement de la bibliothèque projet : import ES (frais / cache) vs injection globale. */
function benchLibrary(qjs: Awaited<ReturnType<typeof loadQuickJS>>, json: string, lib: Library) {
  const host: PolentaHost = { contractVersion: 1, now: NOW, params: {} }
  const big = syntheticLibrary(100)
  const libs: Record<string, Library> = { 'bibliothèque de départ (~3 Ko)': lib, 'bibliothèque synthétique 100 Ko': { ...lib, 'lib/big.js': big } }
  const scripts = {
    'sans import': `export default function (data) { return [{ n: data.requirements.length, _ids: [] }] }`,
    'import lib/history.js': `import { timeline } from 'lib/history.js'\nexport default function (data) { return [{ n: typeof timeline, _ids: [] }] }`,
    'import lib/big.js': `import { util0 } from 'lib/big.js'\nexport default function (data) { return [{ n: typeof util0, _ids: [] }] }`,
  }
  const out: Record<string, unknown> = {}
  for (const [libName, l] of Object.entries(libs)) {
    for (const [sName, script] of Object.entries(scripts)) {
      if (sName.includes('big') && !l['lib/big.js']) continue
      const freshT: number[] = []
      for (let i = 0; i < 5; i++) { const r = runFresh(qjs, json, l, script, host); if (!r.ok) throw new Error(r.error.message); freshT.push(r.timings.execMs!) }
      const ctx = prepare(qjs, json, l)
      const first = ctx.run(script, host)
      const next: number[] = []
      for (let i = 0; i < 10; i++) next.push(ctx.run(script, host).timings.execMs!)
      ctx.dispose()
      out[`${libName} — ${sName}`] = { freshExecMs: stats(freshT), cachedFirstExecMs: r1(first.timings.execMs), cachedNextExecMs: stats(next) }
    }
  }
  // Injection : la bibliothèque évaluée comme script global (fonctions sur globalThis), sans modules.
  const injected = big.replace(/export function /g, 'globalThis.') .replace(/globalThis\.(util\d+)\(/g, 'globalThis.$1 = function (')
  const inj: number[] = []
  for (let i = 0; i < 5; i++) {
    const rt = qjs.newRuntime(); const vm = rt.newContext()
    const t = performance.now()
    vm.unwrapResult(vm.evalCode(injected, 'big-injected.js', { type: 'global' })).dispose()
    inj.push(performance.now() - t)
    vm.dispose(); rt.dispose()
  }
  out['injection globale 100 Ko (évaluation seule)'] = { evalMs: stats(inj) }
  return out
}

/** Mêmes sondes avec un module à mémoire wasm plafonnée (128 Mo) ; coût d'instanciation du module. */
async function benchCapped(json: string, lib: Library, probes: Record<string, string>) {
  const host: PolentaHost = { contractVersion: 1, now: NOW, params: {} }
  const limits = { memoryBytes: 64 * 1024 * 1024, timeMs: 1000, stackBytes: 256 * 1024 }
  const inst: number[] = []
  for (let i = 0; i < 5; i++) { const t = performance.now(); await loadQuickJSCapped(128); inst.push(performance.now() - t) }
  const out: Record<string, unknown> = {}
  for (const [name, script] of Object.entries(probes)) {
    const qjs = await loadQuickJSCapped(128)
    const t = performance.now()
    let res: string
    try { const r = runFresh(qjs, json, lib, script, host, limits); res = r.ok ? 'ok' : `${r.error.name}: ${r.error.message}` } catch (e) { res = `EXCEPTION HÔTE ${String(e).slice(0, 80)}` }
    const ms = performance.now() - t
    let reusable = true
    try { const r = runFresh(qjs, json, lib, loadWidget('a').script, host, limits); reusable = r.ok } catch { reusable = false }
    out[name] = { ms: r1(ms), error: res, wasmMb: r1(PreparedContext.wasmMemoryMb(qjs)), moduleReusableAfter: reusable }
  }
  return { capMb: 128, moduleInstantiateMs: stats(inst), probes: out }
}

/** Limites : boucle infinie, allocation massive, récursion ; reprise du contexte en cache ensuite. */
async function benchLimits(qjs: Awaited<ReturnType<typeof loadQuickJS>>, json: string, lib: Library) {
  const host: PolentaHost = { contractVersion: 1, now: NOW, params: {} }
  const limits = { memoryBytes: 64 * 1024 * 1024, timeMs: 1000, stackBytes: 256 * 1024 }
  const probes = {
    'boucle infinie': `export default function () { while (true) {} }`,
    'allocation massive': `export default function () { const a = []; while (true) a.push(new Array(100000).fill(a.length)) }`,
    'chaîne géante': `export default function () { let s = 'x'; while (true) s += s }`,
    'récursion infinie': `export default function f() { return f() + 1 }`,
  }
  const out: Record<string, unknown> = {}
  const ctx = prepare(qjs, json, lib, limits)
  const ok = loadWidget('a').script
  for (const [name, script] of Object.entries(probes)) {
    const t = performance.now()
    const fresh = runFresh(qjs, json, lib, script, host, limits)
    const freshMs = performance.now() - t
    const t2 = performance.now()
    const cachedRes = ctx.run(script, host)
    const cachedMs = performance.now() - t2
    const after = ctx.run(ok, host)
    out[name] = {
      fresh: { ms: r1(freshMs), error: fresh.ok ? null : `${fresh.error.name}: ${fresh.error.message}` },
      cached: { ms: r1(cachedMs), error: cachedRes.ok ? null : `${cachedRes.error.name}: ${cachedRes.error.message}` },
      cachedContextUsableAfter: after.ok, memAfterMb: r1((ctx.memoryUsedBytes) / 1048576),
    }
  }
  ctx.dispose()
  return { limits: { memoryMb: 64, timeMs: 1000, stackKb: 256 }, probes: out, capped: await benchCapped(json, lib, probes), wasmLinearMemoryAfterMb: r1(PreparedContext.wasmMemoryMb(qjs)), processRssAfterMb: r1(process.memoryUsage().rss / 1048576) }
}

/** Isolation et remontée des erreurs. */
function benchIsolation(qjs: Awaited<ReturnType<typeof loadQuickJS>>, json: string, lib: Library) {
  const host: PolentaHost = { contractVersion: 1, now: NOW, params: {} }
  const globalsProbe = `export default function () {
  const names = ['fetch', 'require', 'process', 'module', 'setTimeout', 'setInterval', 'queueMicrotask', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'WebAssembly', 'Deno', 'Bun', 'std', 'os', 'console', 'window', 'document', 'navigator', 'performance', 'SharedArrayBuffer', 'Atomics']
  return names.map(n => ({ name: n, type: typeof globalThis[n], _ids: [] }))
}`
  const globals = runFresh(qjs, json, lib, globalsProbe, host)
  const imports: Record<string, string> = {}
  for (const spec of ['os', 'std', 'fs', 'node:fs', 'child_process', 'https://example.com/x.js', '../../package.json', 'lib/../../secret.js']) {
    const r = runFresh(qjs, json, lib, `import * as m from ${JSON.stringify(spec)}\nexport default function () { return [{ keys: Object.keys(m).join(','), _ids: [] }] }`, host)
    imports[spec] = r.ok ? `CHARGÉ (${JSON.stringify(r.rows)})` : `${r.error.name}: ${r.error.message}`
  }
  const dyn = runFresh(qjs, json, lib, `export default function () { let r = 'aucune erreur synchrone'; import('os').then(() => { r = 'chargé' }, e => { r = String(e) }); return [{ r, _ids: [] }] }`, host)
  const escapes = {
    'Function("return this")()': `export default function () { const g = Function('return this')(); return [{ r: typeof g.process + '/' + typeof g.require, _ids: [] }] }`,
    'eval de code': `export default function () { return [{ r: eval('1 + 1'), _ids: [] }] }`,
    'Date.now / Math.random': `export default function () { return [{ r: typeof Date.now() + '/' + typeof Math.random(), _ids: [] }] }`,
    'mutation des données': `export default function (data) { 'use strict'; data.requirements[0].status = 'hacked'; return [] }`,
    'remplacement de data.requirements': `export default function (data) { 'use strict'; data.requirements = []; return [] }`,
    'Atomics.wait (blocage)': `export default function () { return [{ r: typeof Atomics, _ids: [] }] }`,
  }
  const escapeResults: Record<string, string> = {}
  for (const [name, s] of Object.entries(escapes)) {
    const r = runFresh(qjs, json, lib, s, host)
    escapeResults[name] = r.ok ? `ok → ${JSON.stringify(r.rows)}` : `${r.error.name}: ${r.error.message}`
  }
  // Fuite entre exécutions dans le contexte en cache.
  const leakProbe = (harden: boolean) => {
    const ctx = prepare(qjs, json, lib, DEFAULT_LIMITS, { harden })
    const w1 = ctx.run(`export default function () { globalThis.leak = 'du widget 1'; Array.prototype.sum = function () { return 42 }; return [] }`, host)
    const w2 = ctx.run(`export default function () { return [{ leak: String(globalThis.leak), proto: typeof [].sum, _ids: [] }] }`, host)
    const w3 = ctx.run(loadWidget('c').script, { ...host, params: {} })
    ctx.dispose()
    return { widget1: w1.ok ? 'ok' : `${w1.error.name}: ${w1.error.message}`, widget2: w2.ok ? w2.rows[0] : w2.error, widgetCStillWorks: w3.ok, hardenMs: r1(ctx.prepTimings.hardenMs) }
  }
  const leak = { sansDurcissement: leakProbe(false), avecDurcissement: leakProbe(true) }

  const errors = {
    'throw ligne 3': `export default function (data) {\n  const n = data.requirements.length\n  throw new Error('seuil dépassé : ' + n)\n}`,
    'champ absent ligne 4': `export default function (data) {\n  return data.campaigns.map(c => ({\n    id: c.id,\n    n: c.entrees.length,\n    _ids: [c.id],\n  }))\n}`,
    'erreur de syntaxe ligne 2': `export default function (data) {\n  return data.requirements.map(r => ({ id: r.id, _ids: [r.id] })\n}`,
    'erreur dans la bibliothèque': `import { campaignTimeline } from 'lib/campaign.js'\nexport default function (data) {\n  return campaignTimeline({ id: 'X', createdAt: '2026-01-01', entries: null }, [], { to: '2026-01-02' })\n}`,
    'pas d\'export par défaut': `export function widget() { return [] }`,
    'ligne sans _ids': `export default function (data) { return [{ n: 1 }] }`,
    'valeur non scalaire': `export default function (data) { return [{ r: data.requirements[0], _ids: [] }] }`,
    'renvoie une promesse': `export default async function (data) { return [] }`,
  }
  const errorResults: Record<string, unknown> = {}
  for (const [name, s] of Object.entries(errors)) {
    const r = runFresh(qjs, json, lib, s, host)
    errorResults[name] = r.ok ? 'AUCUNE ERREUR' : { name: r.error.name, message: r.error.message, file: r.error.file, line: r.error.line, column: r.error.column }
  }
  return {
    globals: globals.ok ? Object.fromEntries(globals.rows.map(r => [r.name as string, r.type])) : globals.error,
    staticImports: imports,
    dynamicImport: dyn.ok ? dyn.rows : dyn.error,
    escapes: escapeResults,
    cachedContextLeak: leak,
    errors: errorResults,
  }
}

/** Variantes QuickJS : exécution de (c) toutes campagnes sur le plus gros jeu, contexte en cache. */
async function benchVariants(json: string, lib: Library) {
  const out: Record<string, unknown> = {}
  const host: PolentaHost = { contractVersion: 1, now: NOW, params: {} }
  const script = loadWidget('c').script
  for (const name of ['@jitl/quickjs-wasmfile-release-sync', '@jitl/quickjs-ng-wasmfile-release-sync']) {
    const t0 = performance.now()
    const variant = (await import(name)).default
    const qjs = await loadQuickJS(variant)
    const loadMs = performance.now() - t0
    const tP = performance.now()
    const ctx = prepare(qjs, json, lib)
    const prepareMs = performance.now() - tP
    ctx.run(script, host)
    const times: number[] = []
    for (let i = 0; i < 5; i++) times.push(ctx.run(script, host).timings.totalMs!)
    out[name] = { moduleLoadMs: r1(loadMs), prepareMs: r1(prepareMs), memMb: r1(ctx.memoryUsedBytes / 1048576), cAllCampaigns: stats(times) }
    ctx.dispose()
  }
  return out
}

export async function runBench() {
  fs.mkdirSync(RESULTS, { recursive: true })
  const machine = {
    os: `${os.type()} ${os.release()} (${os.arch()})`, cpu: os.cpus()[0]?.model, cores: os.cpus().length,
    ramGb: Math.round(os.totalmem() / 1073741824), node: process.version, date: new Date().toISOString(),
  }
  const t0 = performance.now()
  const qjs = await loadQuickJS()
  const moduleLoadMs = performance.now() - t0
  const lib = loadLibrary()
  const datasets = []
  let biggestJson = ''
  let demoJson = ''
  for (const f of FACTORS) {
    say(`jeu x${f}…`)
    const d = await benchDataset(f, qjs, lib)
    if (f === 1 || !demoJson) demoJson = d._json
    biggestJson = d._json
    const { _json, ...rest } = d
    void _json
    datasets.push(rest)
  }
  say('bibliothèque…')
  const library = benchLibrary(qjs, demoJson, lib)
  say('limites…')
  const limits = await benchLimits(qjs, demoJson, lib)
  say('isolation…')
  const isolation = benchIsolation(qjs, demoJson, lib)
  say('variantes…')
  const variants = await benchVariants(biggestJson, lib)
  // Graphe de démo exporté pour le rendu Vega et l'écriture par l'IA.
  fs.writeFileSync(path.join(RESULTS, 'graph-demo.json'), demoJson)
  const result = { machine, quickjs: { variant: '@jitl/quickjs-wasmfile-release-sync@0.32.0', moduleLoadMs: r1(moduleLoadMs) }, rssMb: r1(process.memoryUsage().rss / 1048576), datasets, library, limits, isolation, variants }
  fs.writeFileSync(path.join(RESULTS, 'bench.json'), JSON.stringify(result, null, 2))
  say('écrit results/bench.json')
  return result
}

if (require.main === module) void runBench().catch(err => { console.error(err); process.exit(1) })
