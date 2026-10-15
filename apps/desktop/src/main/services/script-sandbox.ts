import * as fs from 'fs'
import * as path from 'path'
import { newQuickJSWASMModuleFromVariant, newVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core'
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten-core'
import type { GraphRow, PolentaHost, ScriptError, ScriptErrorKind } from '@polenta/types'
import { DEFAULT_SANDBOX_LIMITS } from './script-limits'
import type { LibraryModules, SandboxLimits } from './script-limits'
import { validateRows } from '@polenta/types'

// GH74 — bac à sable QuickJS (wasm) des scripts de données et des transformations de widget
// (specs/GH74-design.md §2.2, mesures specs/GH78-report.md). Pur Node + wasm, sans worker : le
// worker (`script-worker.ts`) l'enveloppe, les tests l'appellent directement.
//
// - Mémoire linéaire wasm PLAFONNÉE (`WebAssembly.Memory` bornée) : `setMemoryLimit` seul laisse
//   monter le process à 2 Go avant l'OOM (#78 §3.4).
// - Contexte préparé : graphe injecté une fois, gelé ; objet global et intrinsèques gelés
//   (durcissement) pour qu'une exécution ne laisse rien à la suivante.
// - Seuls les modules de la bibliothèque projet sont importables.

export { DEFAULT_SANDBOX_LIMITS } from './script-limits'
export type { LibraryModules, SandboxLimits } from './script-limits'

export type SandboxResult =
  | { ok: true; rows: GraphRow[] }
  | { ok: false; error: ScriptError; /** Contexte inutilisable : à jeter (et le module avec). */ fatal: boolean }

const WASM_FILE = 'emscripten-module.wasm'

/** Emplacement du `.wasm` : variable d'environnement, à côté du bundle, ou dans le paquet npm. */
export function locateQuickJSWasm(): string {
  const candidates = [process.env.POLENTA_QUICKJS_WASM, path.join(__dirname, WASM_FILE)]
  for (const c of candidates) if (c && fs.existsSync(c)) return c
  // Repli hors bundle (tests, tsx) : le fichier du paquet npm.
  return require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm')
}

/** Module QuickJS neuf, à mémoire wasm plafonnée. Un module se jette après un OOM. */
export async function createSandboxModule(limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS, wasmPath = locateQuickJSWasm()): Promise<QuickJSWASMModule> {
  const base = (await import('@jitl/quickjs-wasmfile-release-sync')).default
  const wasmBinary = fs.readFileSync(wasmPath)
  const pages = limits.wasmMaxMb * 16 // 64 Ko par page
  const variant = newVariant(base, {
    wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer,
    wasmMemory: new WebAssembly.Memory({ initial: Math.min(256, pages), maximum: pages }),
  })
  return newQuickJSWASMModuleFromVariant(variant)
}

// ─── Résolution des imports ──────────────────────────────────────────────────

const SCRIPT_PREFIX = '__polenta_script_'

/** Préfixe de repo d'une clé (`comp::`), ou chaîne vide pour le repo ouvert. */
function scopeOf(name: string): string {
  const i = name.indexOf('::')
  return i >= 0 ? name.slice(0, i + 2) : ''
}

/**
 * Nom canonique d'un import. `lib/x.js` désigne la bibliothèque du repo de l'importateur (repo ouvert
 * pour un script ; le composant lui-même pour un module `<comp>::lib/…`, qui fonctionne ainsi aussi
 * ouvert seul) ; `<comp>::lib/x.js` celle d'un composant. Un chemin relatif n'est permis que depuis
 * un module de bibliothèque et doit rester dans le même `lib/`. Renvoie `null` si l'import est interdit.
 */
export function normalizeImport(base: string, requested: string): string | null {
  if (requested.startsWith('./') || requested.startsWith('../')) {
    if (base.startsWith(SCRIPT_PREFIX)) return null
    const scope = scopeOf(base)
    const local = base.slice(scope.length)
    if (!local.startsWith('lib/')) return null
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(local), requested))
    return joined.startsWith('lib/') ? scope + joined : null
  }
  const scope = scopeOf(requested)
  const local = requested.slice(scope.length)
  if (scope && !/^[\w.-]+::$/.test(scope)) return null
  if (!local.startsWith('lib/')) return null
  const normalized = path.posix.normalize(local)
  if (!normalized.startsWith('lib/') || normalized !== local) return null
  if (scope) return requested
  return base.startsWith(SCRIPT_PREFIX) ? requested : scopeOf(base) + requested
}

// ─── Code d'amorçage (évalué dans QuickJS) ───────────────────────────────────

const DEEP_FREEZE = `(function f(o){ if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k in o) f(o[k]) } return o })`

/** Gel profond des exports d'un module de bibliothèque (objets et fonctions). Une structure
 *  interne mutable (`Map`, `Set`) reste modifiable : le gel ne la protège pas. */
const LIB_FREEZE = `(function f(o){ if (o && (typeof o === 'object' || typeof o === 'function') && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.getOwnPropertyNames(o)) { let v; try { v = o[k] } catch (e) { continue } f(v) } } return o })`

const ASYNC_MARK = '__POLENTA_ASYNC__'
/** Préfixe d'un import interdit (pas de caractère NUL : QuickJS manipule des chaînes C). */
const REFUSED = 'refused:'

/** Message d'un import introuvable ; module du repo ouvert (`lib/…`) : la bibliothèque de départ est
 *  peut-être incomplète (branche en lecture seule au premier accès, `dashboards/lib/` du projet). */
function missingModuleMessage(name: string): string {
  const shown = name.replace(REFUSED, '')
  if (!name.startsWith(REFUSED) && shown.startsWith('lib/')) {
    return `Module introuvable : "${shown}" (absent de dashboards/lib/ ; un fichier de la bibliothèque de départ manquant est proposé dans les mises à jour de la vue Suivi)`
  }
  return `Module introuvable : "${shown}" (seuls les modules de dashboards/lib/ sont importables)`
}

const BOOT = `
Object.defineProperty(globalThis, '__freeze', { value: ${DEEP_FREEZE}, writable: false, configurable: false });
Object.defineProperty(globalThis, '__call', { value: Object.freeze((fn, hostJson) => {
  const r = fn(globalThis.__data, globalThis.__freeze(JSON.parse(hostJson)));
  if (r && typeof r.then === 'function') return ${JSON.stringify(ASYNC_MARK)};
  return JSON.stringify(r === undefined ? null : r);
}), writable: false, configurable: false });
Object.defineProperty(globalThis, '__callT', { value: Object.freeze((fn, rowsJson, hostJson) => {
  const rows = globalThis.__freeze(JSON.parse(rowsJson));
  const r = fn(rows, globalThis.__freeze(JSON.parse(hostJson)));
  if (r && typeof r.then === 'function') return ${JSON.stringify(ASYNC_MARK)};
  return JSON.stringify(r === undefined ? null : r);
}), writable: false, configurable: false });
`

/** Durcissement : intrinsèques et objet global gelés (le graphe, déjà gelé, n'est pas reparcouru). */
const HARDEN = `(function () {
  const seen = new Set()
  const f = (o) => {
    if (!o || (typeof o !== 'object' && typeof o !== 'function') || seen.has(o)) return
    seen.add(o)
    Object.freeze(o)
    for (const k of Reflect.ownKeys(o)) { const d = Object.getOwnPropertyDescriptor(o, k); if (d) { f(d.value); f(d.get); f(d.set) } }
    f(Object.getPrototypeOf(o))
  }
  seen.add(globalThis.__data)
  f(globalThis)
})()`

// ─── Contexte préparé ────────────────────────────────────────────────────────

export class SandboxContext {
  private n = 0
  /** Exécutions faites : chaque script évalué reste dans la table des modules du runtime. */
  get runs(): number { return this.n }

  private constructor(
    private readonly rt: QuickJSRuntime,
    private readonly vm: QuickJSContext,
    private readonly limits: SandboxLimits,
    private readonly modules: LibraryModules,
  ) {}

  /** Runtime prêt : graphe injecté et gelé, bibliothèque résolvable, contexte durci. */
  static prepare(qjs: QuickJSWASMModule, graphJson: string, modules: LibraryModules, limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS): SandboxContext {
    const rt = qjs.newRuntime()
    rt.setMemoryLimit(limits.memoryBytes)
    rt.setMaxStackSize(limits.stackBytes)
    rt.setModuleLoader(
      // Module absent : un module qui lève l'erreur lui-même. Une erreur rendue par l'hôte perdrait
      // son message — `Error.prototype` est gelé par le durcissement (« override mistake »).
      (name) => (Object.prototype.hasOwnProperty.call(modules, name)
        ? modules[name]
        : `throw new Error(${JSON.stringify(missingModuleMessage(name))})`),
      (base, requested) => normalizeImport(base, requested) ?? `${REFUSED}${requested}`,
    )
    const vm = rt.newContext()
    const ctx = new SandboxContext(rt, vm, limits, modules)
    try {
      // La préparation a son propre budget (graphe volumineux : ~0,4 s sur ×50).
      rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.timeMs * 5))
      const s = vm.newString(graphJson)
      vm.setProp(vm.global, '__graphJson', s)
      s.dispose()
      vm.unwrapResult(vm.evalCode(
        `globalThis.__data = JSON.parse(globalThis.__graphJson); delete globalThis.__graphJson;`,
        '__inject.js', { type: 'global' },
      )).dispose()
      vm.unwrapResult(vm.evalCode(
        `${BOOT}\n${DEEP_FREEZE}(globalThis.__data); Object.defineProperty(globalThis, '__data', { writable: false, configurable: false });`,
        '__boot.js', { type: 'global' },
      )).dispose()
      // Modules de la bibliothèque évalués une fois ici, exports gelés : un script ne peut pas les
      // modifier pour les exécutions suivantes (le contexte est partagé). Un module en erreur est
      // laissé tel quel : l'import le signalera, avec son fichier et sa ligne.
      Object.keys(modules).forEach((key, i) => {
        const r = vm.evalCode(
          `import * as m from ${JSON.stringify(key)}
const freeze = ${LIB_FREEZE}
for (const k of Object.keys(m)) freeze(m[k])`,
          `__preload_${i}.js`, { type: 'module' },
        )
        if (r.error) r.error.dispose()
        else r.value.dispose()
      })
      vm.unwrapResult(vm.evalCode(HARDEN, '__harden.js', { type: 'global' })).dispose()
    } catch (err) {
      ctx.dispose()
      throw err
    }
    return ctx
  }

  /** Mémoire utilisée par le runtime. */
  memoryUsedBytes(): number {
    const h = this.rt.computeMemoryUsage()
    const usage = this.vm.dump(h) as { memory_used_size?: number }
    h.dispose()
    return usage.memory_used_size ?? 0
  }

  /** Exécute un script de données (`export default (data, polenta) => rows`). */
  runScript(script: string, host: PolentaHost, file = 'script.js', deadline = Date.now() + this.limits.timeMs): SandboxResult {
    return this.invoke(script, file, deadline, (fn) => {
      const caller = this.vm.getProp(this.vm.global, '__call')
      const hostH = this.vm.newString(JSON.stringify(host))
      try {
        return this.vm.callFunction(caller, this.vm.undefined, fn, hostH)
      } finally {
        caller.dispose()
        hostH.dispose()
      }
    }, '(data, polenta)')
  }

  /** Exécute une transformation de widget (`export default (rows, polenta) => rows`). */
  runTransform(transform: string, rows: readonly GraphRow[], host: PolentaHost, file: string, deadline = Date.now() + this.limits.timeMs): SandboxResult {
    return this.invoke(transform, file, deadline, (fn) => {
      const caller = this.vm.getProp(this.vm.global, '__callT')
      const rowsH = this.vm.newString(JSON.stringify(rows))
      const hostH = this.vm.newString(JSON.stringify(host))
      try {
        return this.vm.callFunction(caller, this.vm.undefined, fn, rowsH, hostH)
      } finally {
        caller.dispose()
        rowsH.dispose()
        hostH.dispose()
      }
    }, '(rows, polenta)')
  }

  private invoke(
    code: string,
    file: string,
    deadline: number,
    call: (fn: QuickJSHandle) => ReturnType<QuickJSContext['callFunction']>,
    signature: string,
  ): SandboxResult {
    const { rt, vm } = this
    const internal = `${SCRIPT_PREFIX}${++this.n}.js`
    rt.setInterruptHandler(shouldInterruptAfterDeadline(deadline))
    const evaluated = vm.evalCode(code, internal, { type: 'module' })
    if (evaluated.error) return this.fail(evaluated.error, internal, file)
    const ns = evaluated.value
    const fn = vm.getProp(ns, 'default')
    ns.dispose()
    if (vm.typeof(fn) !== 'function') {
      fn.dispose()
      return {
        ok: false,
        fatal: false,
        error: { kind: 'export', message: `Le script doit exporter une fonction par défaut : export default function ${signature} { … }`, file, line: null, column: null },
      }
    }
    const out = call(fn)
    fn.dispose()
    if (out.error) return this.fail(out.error, internal, file)
    const json = vm.typeof(out.value) === 'string' ? vm.getString(out.value) : 'null'
    out.value.dispose()
    if (json === ASYNC_MARK) {
      return { ok: false, fatal: false, error: { kind: 'async', message: 'Le script doit être synchrone : pas de fonction async ni de promesse.', file, line: null, column: null } }
    }
    let rows: unknown
    try {
      rows = JSON.parse(json)
    } catch {
      rows = null
    }
    const invalid = validateRows(rows)
    if (invalid) return { ok: false, fatal: false, error: { kind: 'rows', message: invalid, file, line: null, column: null } }
    return { ok: true, rows: rows as GraphRow[] }
  }

  private fail(h: QuickJSHandle, internal: string, file: string): SandboxResult {
    let dumped: unknown
    try {
      dumped = this.vm.dump(h)
    } catch {
      dumped = { name: 'InternalError', message: 'out of memory' }
    } finally {
      h.dispose()
    }
    const error = toScriptError(dumped, internal, file, (name) => Object.prototype.hasOwnProperty.call(this.modules, name))
    return { ok: false, error, fatal: error.kind === 'memory' || error.kind === 'stack' }
  }

  dispose(): void {
    try { this.vm.dispose() } catch { /* runtime saturé */ }
    try { this.rt.dispose() } catch { /* idem */ }
  }
}

const LIMIT_MESSAGES: Partial<Record<ScriptErrorKind, string>> = {
  timeout: 'Délai dépassé : le script a été interrompu.',
  memory: 'Mémoire dépassée : le script a été interrompu.',
  stack: 'Pile dépassée (récursion trop profonde) : le script a été interrompu.',
}

/** Convertit une erreur QuickJS en `ScriptError` localisée (première frame d'un fichier connu). */
export function toScriptError(dumped: unknown, internal: string, file: string, isKnownModule: (name: string) => boolean = () => true): ScriptError {
  const e = typeof dumped === 'object' && dumped !== null
    ? dumped as { name?: string; message?: string; stack?: string }
    : { name: 'Error', message: String(dumped), stack: '' }
  const name = e.name ?? 'Error'
  const message = e.message ?? String(dumped)
  const stack = e.stack ?? ''
  const rename = (f: string) => (f === internal ? file : f)

  // Import d'un module absent par nom (`import x from …`) : QuickJS échoue à la liaison, avant
  // d'évaluer le module de remplacement — « Could not find export 'x' in module 'os' ».
  const missing = /in module '([^']+)'/.exec(message)
  if (name === 'SyntaxError' && missing && !isKnownModule(missing[1])) {
    return { kind: 'import', message: missingModuleMessage(missing[1]), file, line: null, column: null }
  }

  let kind: ScriptErrorKind = 'runtime'
  if (name === 'SyntaxError') kind = 'syntax'
  else if (/^interrupted$/i.test(message)) kind = 'timeout'
  else if (/out of memory|string too long|invalid array length/i.test(message)) kind = 'memory'
  else if (/stack overflow/i.test(message)) kind = 'stack'
  else if (/^Module introuvable/.test(message)) kind = 'import'

  // Frames QuickJS : « at default (lib/campaign.js:12:9) » ; erreur de syntaxe : « at file:3:1 ».
  const m = /([\w.:-]*?(?:lib\/[\w./-]+|__polenta_script_\d+)\.js):(\d+)(?::(\d+))?/.exec(stack)
  const cleanMessage = message.split(internal).join(file)
  return {
    kind,
    message: LIMIT_MESSAGES[kind] ?? (kind === 'import' ? cleanMessage : `${name}: ${cleanMessage}`.replace(/^Error: /, '')),
    file: m ? rename(m[1]) : (kind === 'syntax' || kind === 'runtime' ? file : null),
    line: m ? Number(m[2]) : null,
    column: m?.[3] ? Number(m[3]) : null,
  }
}
