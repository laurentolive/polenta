import { matchQuery, type Query, type QueryClient, type QueryFilters } from '@tanstack/react-query'

/**
 * GH397 — regroupement des invalidations déclenchées par les événements de fichier
 * (`repo:file-changed`, `useLiveFileSync`).
 *
 * Avant : chaque fichier écrit relançait aussitôt toutes les lectures actives qu'il concerne
 * (widgets de Suivi, liens du workspace…), et un nouvel événement arrivé pendant ces lectures les
 * annulait côté page pour les relancer — le serveur, lui, finissait les premières. Une rafale de
 * N écritures coûtait N tournées complètes de relecture, qui occupaient aussi les connexions HTTP du
 * navigateur (6 par hôte) : les écritures suivantes attendaient derrière (0,9 s à 4 s par création).
 *
 * Ici un événement isolé (aucun autre depuis `quietMs`) est appliqué aussitôt, comme avant — au tour
 * suivant de la boucle d'événements, ce qui réunit les invalidations d'un même événement. Les
 * suivants sont cumulés, puis appliqués ensemble après `quietMs` sans nouvel événement (au plus
 * tard `maxWaitMs` après le premier : fraîcheur garantie pendant une rafale continue).
 * À l'application, chaque requête concernée est :
 * - invalidée tout de suite si elle est au repos (une seule relecture pour toute la rafale) ;
 * - laissée finir si elle est en cours de lecture, puis invalidée une fois : elle n'est pas annulée
 *   pour être aussitôt relancée ;
 * - après une relecture lancée ici, laissée en pause aussi longtemps qu'a duré cette relecture (au
 *   plus `maxRestMs`) : les lectures lourdes (widgets de Suivi) ne reprennent pas aussitôt toutes les
 *   connexions de la page, les écritures passent entre deux tournées. Une lecture rapide (schéma,
 *   liste) n'a qu'une pause aussi brève qu'elle.
 * Au-delà de `busyMaxMs` d'attente, une requête est invalidée quoi qu'il en soit.
 *
 * Seules les requêtes présentes dans le cache au moment de l'application sont concernées : une
 * requête créée ensuite lit les données à jour.
 */
export interface InvalidationBatcherOptions {
  /** Calme attendu après le dernier événement (ms). */
  quietMs?: number
  /** Délai maximal entre le premier événement en attente et l'application des filtres (ms). */
  maxWaitMs?: number
  /** Attente maximale d'une requête en cours de lecture ou en pause (ms). */
  busyMaxMs?: number
  /** Pause maximale après une relecture lancée ici (ms) ; la pause vaut sa durée, bornée. */
  maxRestMs?: number
  /** Intervalle de vérification des requêtes en attente (ms). */
  pollMs?: number
  now?: () => number
}

export class InvalidationBatcher {
  private filters: QueryFilters[] = []
  private readonly seen = new Set<string>()
  private firstAt: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Requêtes à invalider dès qu'elles le peuvent, avec l'instant depuis lequel elles attendent. */
  private readonly waiting = new Map<Query, number>()
  /** Relectures lancées ici : début, puis fin de pause une fois terminées. */
  private readonly started = new Map<Query, number>()
  private readonly restUntil = new Map<Query, number>()
  private readonly quietMs: number
  private readonly maxWaitMs: number
  private readonly busyMaxMs: number
  private readonly maxRestMs: number
  private readonly pollMs: number
  private readonly now: () => number
  /** Dernier événement reçu (début de rafale si plus ancien que `quietMs`). */
  private lastEventAt = -Infinity

  constructor(private readonly qc: QueryClient, opts: InvalidationBatcherOptions = {}) {
    this.quietMs = opts.quietMs ?? 150
    this.maxWaitMs = opts.maxWaitMs ?? 1000
    this.busyMaxMs = opts.busyMaxMs ?? 30_000
    this.maxRestMs = opts.maxRestMs ?? 2000
    this.pollMs = opts.pollMs ?? 100
    this.now = opts.now ?? Date.now
  }

  /** Ajoute un filtre à la prochaine application (doublons de clé ignorés). */
  add(filters: QueryFilters): void {
    if (!filters.predicate) {
      const id = JSON.stringify([filters.queryKey ?? null, filters.exact ?? false])
      if (!this.seen.has(id)) {
        this.seen.add(id)
        this.filters.push(filters)
      }
    } else {
      this.filters.push(filters)
    }
    const now = this.now()
    const isolated = now - this.lastEventAt >= this.quietMs
    this.lastEventAt = now
    if (this.firstAt === null) this.firstAt = now
    // Événement isolé : appliqué au tour suivant (déjà programmé si l'événement a plusieurs filtres).
    if (isolated) this.setTimer(0)
    else if (!(this.timer !== null && this.timerDelay === 0)) {
      this.setTimer(Math.max(0, Math.min(this.quietMs, this.firstAt + this.maxWaitMs - now)))
    }
  }

  /** Filtres et requêtes en attente (tests, diagnostic). */
  get pending(): number {
    return this.filters.length + this.waiting.size
  }

  dispose(): void {
    this.clearTimer()
    this.filters = []
    this.seen.clear()
    this.firstAt = null
    this.lastEventAt = -Infinity
    this.waiting.clear()
    this.started.clear()
    this.restUntil.clear()
  }

  private run(): void {
    this.timer = null
    const now = this.now()
    // Filtres reçus → requêtes du cache concernées.
    if (this.filters.length > 0) {
      const filters = this.filters
      this.filters = []
      this.seen.clear()
      this.firstAt = null
      for (const q of this.qc.getQueryCache().findAll({ predicate: q => filters.some(f => matchQuery(f, q)) })) {
        if (!this.waiting.has(q)) this.waiting.set(q, now)
      }
    }
    this.settleStarted(now)

    const ready: Query[] = []
    let next = Infinity
    for (const [q, since] of this.waiting) {
      const overdue = now - since >= this.busyMaxMs
      const fetching = q.state.fetchStatus === 'fetching'
      const rest = this.restUntil.get(q) ?? 0
      if (overdue || (!fetching && now >= rest)) ready.push(q)
      else next = Math.min(next, fetching ? now + this.pollMs : rest)
    }
    if (ready.length > 0) {
      const set = new Set<Query>(ready)
      for (const q of ready) {
        this.waiting.delete(q)
        this.restUntil.delete(q)
      }
      void this.qc.invalidateQueries({ predicate: q => set.has(q) })
      for (const q of ready) if (q.state.fetchStatus === 'fetching') this.started.set(q, now)
    }
    if (this.waiting.size > 0 && this.timer === null) this.setTimer(Math.max(0, next - now))
  }

  /** Relectures lancées ici et terminées : pause de leur durée, bornée, depuis leur réponse. */
  private settleStarted(now: number): void {
    for (const [q, startedAt] of this.started) {
      if (q.state.fetchStatus === 'fetching') continue
      this.started.delete(q)
      const endedAt = Math.min(now, Math.max(startedAt, q.state.dataUpdatedAt, q.state.errorUpdatedAt))
      const rest = endedAt + Math.min(endedAt - startedAt, this.maxRestMs)
      if (rest > now) this.restUntil.set(q, rest)
    }
    for (const [q, until] of this.restUntil) if (until <= now && !this.waiting.has(q)) this.restUntil.delete(q)
  }

  private timerDelay = 0

  private setTimer(delay: number): void {
    this.clearTimer()
    this.timerDelay = delay
    this.timer = setTimeout(() => this.run(), delay)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
