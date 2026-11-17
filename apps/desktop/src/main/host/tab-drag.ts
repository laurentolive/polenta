import type { TabDragPayload } from '../../shared/tab-drag'

/**
 * GH343 — glisser d'onglet en cours, tenu par le main : le geste est un glisser HTML5 (Chromium le
 * transporte d'une fenêtre à l'autre), mais seul son id voyage dans le `dataTransfer` ; le contenu
 * (page, historique, saisie) passe par ici. Un seul glisser à la fois (un seul pointeur).
 *
 * Logique sans Electron : les fenêtres sont désignées par l'id de leur webContents, et l'hôte fournit
 * le projet affiché par une fenêtre et l'envoi d'un événement (testé unitairement).
 */

export interface TabDragHost {
  /** Projet affiché par la fenêtre (`projectId` de sa route), `null` sans projet. */
  projectOf(windowId: number): string | null
  /** La fenêtre existe encore. */
  isAlive(windowId: number): boolean
  /** Prévient la fenêtre source que son onglet a été pris. */
  notifyMoved(sourceId: number, dragId: string): void
  now(): number
}

interface Drag {
  id: string
  sourceId: number
  payload: TabDragPayload
  ready: Promise<void>
  markReady: () => void
  /** Échéance : glisser abandonné (fenêtre cible jamais prête, plantage). */
  expiresAt: number
}

/** Durée de vie d'un glisser (geste en cours, puis nouvelle fenêtre qui démarre). */
export const TAB_DRAG_TTL_MS = 60_000
/** Attente max des enregistrements automatiques de la source avant le transfert. */
export const TAB_DRAG_READY_TIMEOUT_MS = 2_500

export type TabDragInfo = { accept: boolean; sameWindow: boolean }

export class TabDragRegistry {
  private current: Drag | null = null

  constructor(private readonly host: TabDragHost) {}

  private live(): Drag | null {
    if (this.current && this.host.now() > this.current.expiresAt) this.current = null
    return this.current
  }

  start(sourceId: number, id: string, payload: TabDragPayload): void {
    let markReady!: () => void
    const ready = new Promise<void>(resolve => { markReady = resolve })
    this.current = { id, sourceId, payload, ready, markReady, expiresAt: this.host.now() + TAB_DRAG_TTL_MS }
  }

  markReady(sourceId: number, id: string): void {
    const drag = this.live()
    if (drag && drag.id === id && drag.sourceId === sourceId) drag.markReady()
  }

  /** Une fenêtre accepterait-elle le glisser en cours (D2 : même projet, ou fenêtre sans projet) ? */
  info(askerId: number): TabDragInfo | null {
    const drag = this.live()
    if (!drag) return null
    const sameWindow = drag.sourceId === askerId
    return { sameWindow, accept: !sameWindow && this.accepts(askerId, drag) }
  }

  private accepts(askerId: number, drag: Drag): boolean {
    const project = this.host.projectOf(askerId)
    return project === null || project === drag.payload.projectId
  }

  /** Prise de l'onglet par une autre fenêtre : payload, puis la source est prévenue. */
  async take(takerId: number, id: string, readyTimeoutMs = TAB_DRAG_READY_TIMEOUT_MS): Promise<TabDragPayload | null> {
    const drag = this.live()
    if (!drag || drag.id !== id || drag.sourceId === takerId || !this.accepts(takerId, drag)) return null
    // Pris une seule fois, même si deux fenêtres le demandent en même temps.
    this.current = null
    // Saisies à enregistrement automatique de la source (vue Édition…) écrites avant d'afficher la page ailleurs.
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([drag.ready, new Promise<void>(resolve => { timer = setTimeout(resolve, readyTimeoutMs) })])
    clearTimeout(timer)
    if (this.host.isAlive(drag.sourceId)) this.host.notifyMoved(drag.sourceId, drag.id)
    return drag.payload
  }

  /**
   * Fin du geste côté source. `dropped` : une cible a accepté le dépôt (la prise suit) ; sinon, et si
   * le pointeur n'est sur aucune fenêtre de l'application et que la source garde un onglet, une
   * nouvelle fenêtre doit prendre l'onglet : retourne vrai (le glisser reste en attente de sa prise).
   */
  end(sourceId: number, id: string, opts: { dropped: boolean; cursorOverAppWindow: boolean }): boolean {
    const drag = this.live()
    if (!drag || drag.id !== id || drag.sourceId !== sourceId) return false
    if (opts.dropped) return false              // la cible prend l'onglet (ou l'échéance le libère)
    if (opts.cursorOverAppWindow || drag.payload.tabCount < 2) {
      this.current = null                       // lâché sur une page, ou dernier onglet : rien
      return false
    }
    return true
  }
}
