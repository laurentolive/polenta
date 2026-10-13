/**
 * GH78 — bac à sable QuickJS (wasm) pour les scripts de widget.
 *
 * Deux modes :
 *  - `runFresh` : runtime neuf par exécution (injection du graphe, chargement de la bibliothèque,
 *    exécution, destruction) — isolation maximale entre exécutions ;
 *  - `prepare` → `PreparedContext.run` : runtime conservé, graphe parsé et gelé une fois,
 *    modules de la bibliothèque compilés et mis en cache par QuickJS au premier import ;
 *    seul le script du widget est évalué à chaque exécution.
 *
 * Le script est un module ES : `export default function (data, polenta) { return rows }`.
 * Il importe la bibliothèque projet par `import { … } from "lib/<module>.js"`.
 */
import {
  newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline,
  type QuickJSWASMModule, type QuickJSRuntime, type QuickJSContext, type QuickJSHandle,
} from 'quickjs-emscripten-core'
import type { PolentaHost } from './contract'

export interface Limits {
  /** Limite mémoire du runtime (graphe compris), en octets. */
  memoryBytes: number
  /** Limite de temps d'une exécution de script, en ms. */
  timeMs: number
  /** Pile maximale, en octets. */
  stackBytes: number
}
export const DEFAULT_LIMITS: Limits = { memoryBytes: 256 * 1024 * 1024, timeMs: 2000, stackBytes: 256 * 1024 }

export interface ScriptError {
  name: string
  message: string
  /** Ligne / colonne dans le fichier fautif (script du widget ou module de la bibliothèque). */
  file: string | null
  line: number | null
  column: number | null
  stack: string
}

export interface RunTimings {
  /** Copie de la chaîne JSON dans le tas wasm (`newString`). */
  copyMs?: number
  /** `JSON.parse` dans QuickJS. */
  parseMs?: number
  /** Gel profond du graphe (lecture seule). */
  freezeMs?: number
  /** Compilation + évaluation des modules (script et bibliothèque), appel de la fonction. */
  execMs: number
  /** `JSON.stringify` des lignes dans QuickJS + lecture côté hôte + `JSON.parse`. */
  outputMs: number
  totalMs: number
}

export type RunResult =
  | { ok: true; rows: Record<string, unknown>[]; timings: RunTimings; memoryUsedBytes: number }
  | { ok: false; error: ScriptError; timings: Partial<RunTimings>; memoryUsedBytes: number | null }

export type Library = Record<string, string>

let modulePromise: Promise<QuickJSWASMModule> | undefined
/** Variante par défaut : `release-sync` avec fichier .wasm séparé. */
export function loadQuickJS(variant?: unknown): Promise<QuickJSWASMModule> {
  if (variant) return newQuickJSWASMModuleFromVariant(variant as never)
  modulePromise ??= import('@jitl/quickjs-wasmfile-release-sync').then(m => newQuickJSWASMModuleFromVariant((m as { default: never }).default))
  return modulePromise
}

/**
 * Module QuickJS à mémoire linéaire PLAFONNÉE : `setMemoryLimit` ne borne pas la mémoire wasm
 * (mesuré : croissance jusqu'à 2 Go avant l'OOM), et une mémoire wasm ne rétrécit jamais. Le
 * plafond dur borne le process ; le module se jette et se recrée (`maxMb` ≥ limite runtime + marge).
 */
export async function loadQuickJSCapped(maxMb: number): Promise<QuickJSWASMModule> {
  const { newVariant } = await import('quickjs-emscripten-core')
  const base = (await import('@jitl/quickjs-wasmfile-release-sync')).default
  return newQuickJSWASMModuleFromVariant(newVariant(base as never, { wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: maxMb * 16 }) }))
}

const DEEP_FREEZE = `(function f(o){ if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k in o) f(o[k]) } return o })`

function setupRuntime(qjs: QuickJSWASMModule, lib: Library, limits: Limits): { rt: QuickJSRuntime; vm: QuickJSContext } {
  const rt = qjs.newRuntime()
  rt.setMemoryLimit(limits.memoryBytes)
  rt.setMaxStackSize(limits.stackBytes)
  // Seuls les modules de la bibliothèque projet (et le script du widget) sont résolvables.
  rt.setModuleLoader(
    (name) => (name in lib ? lib[name] : { error: new Error(`Module introuvable : "${name}" (seuls les modules lib/*.js du projet sont importables)`) }),
    (base, req) => (req.startsWith('./') && base.startsWith('lib/') ? `lib/${req.slice(2)}` : req),
  )
  const vm = rt.newContext()
  return { rt, vm }
}

function memoryUsed(rt: QuickJSRuntime, vm: QuickJSContext): number {
  const h = rt.computeMemoryUsage()
  const usage = vm.dump(h) as { memory_used_size?: number }
  h.dispose()
  return usage.memory_used_size ?? 0
}

function toScriptError(vm: QuickJSContext, h: QuickJSHandle, widgetFile: string): ScriptError {
  const d = vm.dump(h) as { name?: string; message?: string; stack?: string } | string
  h.dispose()
  const e = typeof d === 'object' && d ? d : { name: 'Error', message: String(d), stack: '' }
  const stack = e.stack ?? ''
  // QuickJS : "    at default (widget-3.js:12:9)" ; on rapporte la première frame localisée.
  const m = /\(?([\w./-]+\.js):(\d+)(?::(\d+))?\)?/.exec(stack)
  const file = m ? (m[1] === widgetFile ? 'widget.js' : m[1]) : null
  return { name: e.name ?? 'Error', message: e.message ?? String(d), file, line: m ? Number(m[2]) : null, column: m?.[3] ? Number(m[3]) : null, stack: stack.split(widgetFile).join('widget.js') }
}

/** Vérifie la forme des lignes : tableau d'objets, valeurs scalaires, `_ids` tableau de chaînes. */
export function validateRows(rows: unknown): string | null {
  if (!Array.isArray(rows)) return `Le script doit renvoyer un tableau de lignes (reçu : ${rows === null ? 'null' : typeof rows}).`
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r || typeof r !== 'object' || Array.isArray(r)) return `Ligne ${i} : objet attendu.`
    const ids = (r as { _ids?: unknown })._ids
    if (!Array.isArray(ids) || ids.some(x => typeof x !== 'string')) return `Ligne ${i} : "_ids" doit être un tableau d'identifiants.`
    for (const [k, v] of Object.entries(r)) {
      if (k === '_ids') continue
      if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) return `Ligne ${i}, colonne "${k}" : valeur non scalaire (${Array.isArray(v) ? 'tableau' : typeof v}).`
    }
  }
  return null
}

export class PreparedContext {
  private n = 0
  constructor(private readonly rt: QuickJSRuntime, private readonly vm: QuickJSContext, private readonly limits: Limits, readonly prepTimings: { copyMs: number; parseMs: number; freezeMs: number; hardenMs: number }) {}

  /** Mémoire linéaire wasm du module (partagée par tous les runtimes du module ; ne rétrécit jamais). */
  static wasmMemoryMb(qjs: QuickJSWASMModule): number {
    return (qjs as unknown as { getWasmMemory(): WebAssembly.Memory }).getWasmMemory().buffer.byteLength / 1048576
  }

  get memoryUsedBytes(): number { return memoryUsed(this.rt, this.vm) }

  run(script: string, host: PolentaHost): RunResult {
    const { rt, vm } = this
    const widgetFile = `widget-${++this.n}.js`
    const t0 = performance.now()
    rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + this.limits.timeMs))
    const scriptRes = vm.evalCode(script, widgetFile, { type: 'module' })
    if (scriptRes.error) return this.fail(scriptRes.error, widgetFile, t0)
    const ns = scriptRes.value
    const fn = vm.getProp(ns, 'default')
    ns.dispose()
    if (vm.typeof(fn) !== 'function') {
      fn.dispose()
      return { ok: false, error: { name: 'TypeError', message: 'Le script doit exporter une fonction par défaut : export default function (data, polenta) { … }', file: 'widget.js', line: null, column: null, stack: '' }, timings: { totalMs: performance.now() - t0 }, memoryUsedBytes: null }
    }
    // Appel + sérialisation des lignes dans QuickJS (`__call`, posé par `prepare`).
    const caller = vm.getProp(vm.global, '__call')
    const hostH = vm.newString(JSON.stringify(host))
    const out = vm.callFunction(caller, vm.undefined, fn, hostH)
    caller.dispose(); fn.dispose(); hostH.dispose()
    const t1 = performance.now()
    if (out.error) return this.fail(out.error, widgetFile, t0)
    const json = vm.typeof(out.value) === 'string' ? vm.getString(out.value) : 'null'
    out.value.dispose()
    const rows = JSON.parse(json ?? 'null')
    const t2 = performance.now()
    const invalid = validateRows(rows)
    const memoryUsedBytes = memoryUsed(rt, vm)
    if (invalid) return { ok: false, error: { name: 'RowsError', message: invalid, file: 'widget.js', line: null, column: null, stack: '' }, timings: { execMs: t1 - t0, outputMs: t2 - t1, totalMs: t2 - t0 }, memoryUsedBytes }
    return { ok: true, rows, timings: { execMs: t1 - t0, outputMs: t2 - t1, totalMs: t2 - t0 }, memoryUsedBytes }
  }

  private fail(h: QuickJSHandle, widgetFile: string, t0: number): RunResult {
    const error = toScriptError(this.vm, h, widgetFile)
    let memoryUsedBytes: number | null = null
    try { memoryUsedBytes = memoryUsed(this.rt, this.vm) } catch { /* runtime saturé */ }
    return { ok: false, error, timings: { totalMs: performance.now() - t0 }, memoryUsedBytes }
  }

  dispose(): void { this.vm.dispose(); this.rt.dispose() }
}

/** Runtime prêt : graphe injecté (copie + JSON.parse + gel), bibliothèque résolvable. */
export function prepare(qjs: QuickJSWASMModule, graphJson: string, lib: Library, limits: Limits = DEFAULT_LIMITS, opts: PrepareOptions = {}): PreparedContext {
  const { rt, vm } = setupRuntime(qjs, lib, limits)
  rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.timeMs * 5))
  const t0 = performance.now()
  const s = vm.newString(graphJson)
  vm.setProp(vm.global, '__graphJson', s)
  s.dispose()
  const t1 = performance.now()
  vm.unwrapResult(vm.evalCode(`globalThis.__data = JSON.parse(globalThis.__graphJson); delete globalThis.__graphJson`, '__inject.js', { type: 'global' })).dispose()
  const t2 = performance.now()
  if (opts.freeze !== false) vm.unwrapResult(vm.evalCode(`${DEEP_FREEZE}(globalThis.__data); Object.defineProperty(globalThis, '__data', { writable: false, configurable: false })`, '__freeze.js', { type: 'global' })).dispose()
  // Appel du widget : fonction figée, l'hôte passe `polenta` en argument (aucune écriture globale par exécution).
  vm.unwrapResult(vm.evalCode(`Object.defineProperty(globalThis, '__call', { value: Object.freeze((fn, hostJson) => JSON.stringify(fn(globalThis.__data, JSON.parse(hostJson)))), writable: false, configurable: false })`, '__call.js', { type: 'global' })).dispose()
  const t3 = performance.now()
  // Durcissement (type « lockdown ») : intrinsèques et objet global gelés, pour qu'un widget ne
  // laisse rien au suivant dans un contexte réutilisé (globalThis.x = …, Array.prototype.y = …).
  if (opts.harden) vm.unwrapResult(vm.evalCode(HARDEN, '__harden.js', { type: 'global' })).dispose()
  const t4 = performance.now()
  return new PreparedContext(rt, vm, limits, { copyMs: t1 - t0, parseMs: t2 - t1, freezeMs: t3 - t2, hardenMs: t4 - t3 })
}

const HARDEN = `(function () {
  const seen = new Set()
  const f = (o) => {
    if (!o || (typeof o !== 'object' && typeof o !== 'function') || seen.has(o)) return
    seen.add(o)
    Object.freeze(o)
    for (const k of Reflect.ownKeys(o)) { const d = Object.getOwnPropertyDescriptor(o, k); if (d) { f(d.value); f(d.get); f(d.set) } }
    f(Object.getPrototypeOf(o))
  }
  seen.add(globalThis.__data) // déjà gelé en profondeur : inutile de reparcourir le graphe
  f(globalThis)
})()`

export interface PrepareOptions { freeze?: boolean; harden?: boolean }

/** Exécution isolée : runtime neuf, détruit à la fin. */
export function runFresh(qjs: QuickJSWASMModule, graphJson: string, lib: Library, script: string, host: PolentaHost, limits: Limits = DEFAULT_LIMITS, opts: PrepareOptions = {}): RunResult {
  const t0 = performance.now()
  let ctx: PreparedContext
  try {
    ctx = prepare(qjs, graphJson, lib, limits, opts)
  } catch (err) {
    return { ok: false, error: { name: 'InjectError', message: err instanceof Error ? err.message : String(err), file: null, line: null, column: null, stack: '' }, timings: { totalMs: performance.now() - t0 }, memoryUsedBytes: null }
  }
  try {
    const res = ctx.run(script, host)
    const timings = { ...ctx.prepTimings, ...res.timings, totalMs: performance.now() - t0 }
    return { ...res, timings } as RunResult
  } finally {
    ctx.dispose()
  }
}
