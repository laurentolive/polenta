import { parentPort } from 'worker_threads'
import type { QuickJSWASMModule } from 'quickjs-emscripten-core'
import type { GraphRow, PolentaHost, ScriptError } from '@polenta/types'
import { createSandboxModule, SandboxContext } from './script-sandbox'
import { DEFAULT_SANDBOX_LIMITS } from './script-limits'
import type { LibraryModules, SandboxLimits } from './script-limits'

// GH74 — point d'entrée `worker_threads` du bac à sable (specs/GH74-design.md §2.2). QuickJS est
// synchrone : il tourne hors du thread principal du main, du serveur web et du serveur MCP, pour
// qu'un script qui va jusqu'à sa limite de temps ne bloque ni l'IPC ni les requêtes HTTP.

export interface WorkerRunMessage {
  id: number
  type: 'run'
  /** Contexte préparé visé (workspace + version du graphe + empreinte de la bibliothèque). */
  key: string
  /** Workspace du contexte : un contexte plus récent du même workspace remplace les anciens. */
  scope: string
  /** Fourni quand l'hôte ne sait pas le worker en possession du contexte. */
  prepare?: { graphJson: string; modules: LibraryModules }
  code: string
  file: string
  kind: 'script' | 'transform'
  rows?: GraphRow[]
  host: PolentaHost
  /** Budget de temps de l'exécution, décompté après la préparation éventuelle du contexte. */
  budgetMs: number
}

export interface WorkerConfigureMessage {
  id: number
  type: 'configure'
  limits: SandboxLimits
}

export type WorkerMessage = WorkerRunMessage | WorkerConfigureMessage

export type WorkerReply =
  /** `ms` : durée de l'exécution seule, préparation du contexte exclue. */
  | { id: number; ok: true; rows: GraphRow[]; ms: number }
  | { id: number; ok: false; error: ScriptError }
  /** Le contexte demandé n'est pas (ou plus) préparé : renvoyer avec `prepare`. */
  | { id: number; ok: false; missingContext: true }
  | { id: number; ok: true; configured: true }

/** Contextes gardés au plus (un workspace ouvert + le précédent). */
const MAX_CONTEXTS = 2
/** Au-delà, le contexte est reconstruit : chaque script évalué reste dans la table des modules. */
const MAX_RUNS_PER_CONTEXT = 500

let limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS
let modulePromise: Promise<QuickJSWASMModule> | null = null
const contexts = new Map<string, SandboxContext>()
const scopes = new Map<string, string>()

function dropAll(): void {
  for (const ctx of contexts.values()) ctx.dispose()
  contexts.clear()
  scopes.clear()
  modulePromise = null
}

function drop(key: string): void {
  contexts.get(key)?.dispose()
  contexts.delete(key)
  scopes.delete(key)
}

async function contextFor(msg: WorkerRunMessage): Promise<SandboxContext | null> {
  const existing = contexts.get(msg.key)
  if (existing && existing.runs < MAX_RUNS_PER_CONTEXT) {
    contexts.delete(msg.key)
    contexts.set(msg.key, existing) // LRU : le plus récent en dernier
    return existing
  }
  if (existing) drop(msg.key)
  if (!msg.prepare) return null
  // Graphe ou bibliothèque périmés du même workspace : libérés avant de préparer le nouveau contexte
  // (deux graphes dans une même mémoire wasm plafonnée la satureraient vite).
  for (const [key, scope] of [...scopes]) if (scope === msg.scope) drop(key)
  modulePromise ??= createSandboxModule(limits)
  const qjs = await modulePromise
  const ctx = SandboxContext.prepare(qjs, msg.prepare.graphJson, msg.prepare.modules, limits)
  contexts.set(msg.key, ctx)
  scopes.set(msg.key, msg.scope)
  while (contexts.size > MAX_CONTEXTS) drop(contexts.keys().next().value as string)
  return ctx
}

async function handle(msg: WorkerMessage): Promise<WorkerReply> {
  if (msg.type === 'configure') {
    limits = msg.limits
    dropAll()
    return { id: msg.id, ok: true, configured: true }
  }
  let ctx: SandboxContext | null
  try {
    ctx = await contextFor(msg)
  } catch (err) {
    // Préparation impossible (graphe trop volumineux pour la limite, module saturé) : tout jeter.
    dropAll()
    const message = err instanceof Error ? err.message : String(err)
    return { id: msg.id, ok: false, error: { kind: /memory/i.test(message) ? 'memory' : 'runtime', message: `Préparation du contexte impossible : ${message}`, file: null, line: null, column: null } }
  }
  if (!ctx) return { id: msg.id, ok: false, missingContext: true }
  const started = Date.now()
  const deadline = started + msg.budgetMs
  const res = msg.kind === 'script'
    ? ctx.runScript(msg.code, msg.host, msg.file, deadline)
    : ctx.runTransform(msg.code, msg.rows ?? [], msg.host, msg.file, deadline)
  if (res.ok) return { id: msg.id, ok: true, rows: res.rows, ms: Date.now() - started }
  // Dépassement mémoire / pile : le module wasm n'est plus fiable, on le recrée (#78 §3.4).
  if (res.fatal) dropAll()
  return { id: msg.id, ok: false, error: res.error }
}

parentPort?.on('message', (msg: WorkerMessage) => {
  handle(msg).then(
    (reply) => parentPort?.postMessage(reply),
    (err) => parentPort?.postMessage({ id: msg.id, ok: false, error: { kind: 'runtime', message: err instanceof Error ? err.message : String(err), file: null, line: null, column: null } } satisfies WorkerReply),
  )
})
