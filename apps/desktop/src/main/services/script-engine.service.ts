import * as path from 'path'
import { Worker } from 'worker_threads'
import type { GraphDrillValue, GraphParamValue, GraphRow, ScriptClientInfo, ScriptError, ScriptRunResult } from '@polenta/types'
import { GRAPH_CONTRACT_VERSION, buildHost, inferColumns, parseContractHeader, stableJson } from '@polenta/types'
import type { GraphService } from './graph.service'
import type { DashboardLibraryService } from './dashboard-library.service'
import { DEFAULT_SANDBOX_LIMITS } from './script-limits'
import type { SandboxLimits } from './script-limits'
import type { WorkerMessage, WorkerReply, WorkerRunMessage } from './script-worker'

// GH74 — moteur d'exécution des scripts de données et des transformations de widget, côté hôte
// (specs/GH74-design.md §2.2). Un worker par process, démarré à la première exécution ; file FIFO ;
// chien de garde ; contexte préparé par (workspace, version du graphe, empreinte de la bibliothèque).

export interface ScriptEngineOptions {
  limits?: SandboxLimits
  /** Chemin du worker compilé (défaut : `script-worker.js` à côté du bundle). */
  workerPath?: string
  /** Marge du chien de garde au-delà de la limite de temps. */
  watchdogGraceMs?: number
  now?: () => Date
}

/** Code à exécuter : script de données, transformation facultative. */
export interface ScriptRunCode {
  script: string
  transform?: string
  /** Nom rapporté dans les erreurs de la transformation (`<widgetId>.js`). */
  transformFile?: string
  drill?: Record<string, GraphDrillValue> | null
  /** GH93 — `polenta.params`, déjà validés et complétés par les défauts (`SuiviService.run`). */
  params?: Record<string, GraphParamValue>
  limit?: number
}

interface Pending {
  resolve: (reply: WorkerReply) => void
  timer: NodeJS.Timeout
}

type ChainResult = { ok: true; rows: GraphRow[]; ms: number } | { ok: false; error: ScriptError }

/** Worker à côté du bundle ; dans l'app packagée, hors asar (`asarUnpack`, `new Worker` ne lit pas l'asar). */
export function defaultWorkerPath(): string {
  return path.join(__dirname, 'script-worker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

export class ScriptEngineService {
  private readonly limits: SandboxLimits
  private readonly workerPath: string
  private readonly graceMs: number
  private readonly now: () => Date
  private worker: Worker | null = null
  /** Contextes que le worker courant a préparés (oubliés à son remplacement), et leur workspace. */
  private readonly preparedKeys = new Set<string>()
  private readonly scopeOf = new Map<string, string>()
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  /** File FIFO : une exécution à la fois (QuickJS est synchrone dans le worker de toute façon). */
  private queue: Promise<unknown> = Promise.resolve()
  /** Scripts en cours, partagés par les widgets qui les utilisent (un rafraîchissement commun). */
  private readonly inFlight = new Map<string, Promise<ChainResult>>()

  constructor(
    private readonly graph: GraphService,
    private readonly library: DashboardLibraryService,
    options: ScriptEngineOptions = {},
  ) {
    this.limits = options.limits ?? DEFAULT_SANDBOX_LIMITS
    this.workerPath = options.workerPath ?? defaultWorkerPath()
    this.graceMs = options.watchdogGraceMs ?? 3000
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Exécute un script (puis la transformation éventuelle) sur le graphe du périmètre. Les erreurs
   * de script sont renvoyées dans le résultat (`ok: false`), jamais levées.
   */
  async run(repoPath: string, workspaceDir: string | undefined, code: ScriptRunCode, client: ScriptClientInfo): Promise<ScriptRunResult> {
    const started = Date.now()
    for (const [text, file] of [[code.script, 'script.js'], [code.transform, code.transformFile ?? 'transform.js']] as const) {
      if (text === undefined) continue
      const declared = parseContractHeader(text)
      if (declared > GRAPH_CONTRACT_VERSION) {
        return { ok: false, error: { kind: 'contract', message: `Contrat v${declared} non pris en charge par cette version de Polenta (v${GRAPH_CONTRACT_VERSION}).`, file, line: null, column: null } }
      }
    }
    const params = code.params ?? {}
    const host = buildHost(client, GRAPH_CONTRACT_VERSION, this.now(), code.drill ?? null, params)
    let built: Awaited<ReturnType<GraphService['build']>>
    let lib: Awaited<ReturnType<DashboardLibraryService['load']>>
    try {
      ;[built, lib] = await Promise.all([
        this.graph.build(repoPath, workspaceDir, host.locale),
        this.library.load(repoPath, workspaceDir),
      ])
    } catch (err) {
      // Index, schéma ou fichier de dashboards/lib/ illisible : erreur affichable, pas une exception.
      return { ok: false, error: { kind: 'runtime', message: `Données du projet indisponibles : ${err instanceof Error ? err.message : String(err)}`, file: null, line: null, column: null } }
    }
    const scope = `${path.resolve(repoPath)}\u0000${workspaceDir ?? ''}\u0000${host.locale}`
    const key = `${scope}\u0000${built.version}\u0000${lib.hash}`
    const prepare = () => ({ graphJson: built.json, modules: lib.modules })

    // Le script : partagé entre les appels simultanés au même contexte (même script, même drill,
    // mêmes paramètres — GH93).
    const shareKey = `${key}\u0000${host.locale}\u0000${host.timezone}\u0000${JSON.stringify(code.drill ?? null)}\u0000${stableJson(params)}\u0000${code.script}`
    let scriptRun = this.inFlight.get(shareKey)
    if (!scriptRun) {
      scriptRun = this.exec(key, scope, prepare, { kind: 'script', code: code.script, file: 'script.js', host }, this.limits.timeMs)
        .finally(() => this.inFlight.delete(shareKey))
      this.inFlight.set(shareKey, scriptRun)
    }
    const first = await scriptRun
    if (!first.ok) return first
    let rows = first.rows
    if (code.transform !== undefined) {
      const remaining = Math.max(100, this.limits.timeMs - first.ms)
      const second = await this.exec(key, scope, prepare, { kind: 'transform', code: code.transform, file: code.transformFile ?? 'transform.js', rows, host }, remaining)
      if (!second.ok) return second
      rows = second.rows
    }
    const total = rows.length
    const limited = code.limit !== undefined && code.limit >= 0 && total > code.limit ? rows.slice(0, code.limit) : rows
    return { ok: true, columns: inferColumns(rows), rows: limited, total, truncated: limited.length < total, ms: Date.now() - started }
  }

  /** Arrête le worker (fin de process, tests). */
  async dispose(): Promise<void> {
    const w = this.worker
    this.worker = null
    this.forgetAll()
    if (w) await w.terminate()
  }

  private forget(key: string): void {
    this.preparedKeys.delete(key)
    this.scopeOf.delete(key)
  }

  private forgetAll(): void {
    this.preparedKeys.clear()
    this.scopeOf.clear()
  }

  private exec(
    key: string,
    scope: string,
    prepare: () => { graphJson: string; modules: Record<string, string> },
    job: Pick<WorkerRunMessage, 'kind' | 'code' | 'file' | 'rows' | 'host'>,
    budgetMs: number,
  ): Promise<ChainResult> {
    const task = this.queue.then(async (): Promise<ChainResult> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const needsPrepare = attempt > 0 || !this.preparedKeys.has(key)
        // Le budget de temps démarre à l'exécution, pas à la préparation (graphe volumineux).
        const reply = await this.send({
          type: 'run', key, scope, ...job, budgetMs,
          ...(needsPrepare ? { prepare: prepare() } : {}),
        }, budgetMs)
        if ('missingContext' in reply) {
          this.preparedKeys.delete(key)
          continue
        }
        if ('configured' in reply) continue
        // Le worker a libéré les contextes plus anciens du même workspace.
        if (needsPrepare) for (const k of [...this.preparedKeys]) if (this.scopeOf.get(k) === scope) this.forget(k)
        this.preparedKeys.add(key)
        this.scopeOf.set(key, scope)
        if (reply.ok) return { ok: true, rows: reply.rows, ms: reply.ms }
        if (reply.error.kind === 'memory' || reply.error.kind === 'stack') this.forgetAll()
        return { ok: false, error: reply.error }
      }
      return { ok: false, error: { kind: 'runtime', message: 'Contexte d\'exécution indisponible.', file: null, line: null, column: null } }
    })
    this.queue = task.catch(() => undefined)
    return task
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(this.workerPath)
    w.on('message', (reply: WorkerReply) => {
      const p = this.pending.get(reply.id)
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(reply.id)
      p.resolve(reply)
    })
    const fail = (message: string) => {
      if (this.worker !== w) return
      this.worker = null
      this.forgetAll()
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer)
        p.resolve({ id, ok: false, error: { kind: 'runtime', message, file: null, line: null, column: null } })
      }
      this.pending.clear()
    }
    w.on('error', (err) => fail(`Moteur de scripts arrêté : ${err.message}`))
    w.on('exit', (code) => fail(`Moteur de scripts arrêté (code ${code}).`))
    w.unref()
    this.worker = w
    const configure: WorkerMessage = { id: this.nextId++, type: 'configure', limits: this.limits }
    w.postMessage(configure)
    return w
  }

  /**
   * Envoie un message et attend la réponse. Le worker décompte le budget après la préparation
   * éventuelle du contexte. Chien de garde : pas de réponse dans le budget + marge (+ budget de
   * préparation) → worker remplacé.
   */
  private send(msg: Omit<WorkerRunMessage, 'id'>, budgetMs: number): Promise<WorkerReply> {
    const w = this.ensureWorker()
    const id = this.nextId++
    return new Promise<WorkerReply>((resolve) => {
      const prepareGrace = msg.prepare ? this.limits.timeMs * 5 : 0
      const timer = setTimeout(() => {
        this.pending.delete(id)
        if (this.worker === w) {
          this.worker = null
          this.forgetAll()
          void w.terminate()
        }
        resolve({ id, ok: false, error: { kind: 'timeout', message: 'Délai dépassé : le moteur de scripts ne répondait plus et a été redémarré.', file: msg.file, line: null, column: null } })
      }, budgetMs + this.graceMs + prepareGrace)
      this.pending.set(id, { resolve, timer })
      w.postMessage({ ...msg, id } satisfies WorkerRunMessage)
    })
  }
}
