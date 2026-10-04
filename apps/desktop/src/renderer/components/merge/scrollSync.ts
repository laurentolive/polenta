import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * GH37 sprint 2 — défilement synchronisé des panneaux de l'éditeur de résolution.
 *
 * Un panneau qui défile publie une ancre : l'unité (`title`, `fields.statement`, région…) en haut
 * de sa zone visible, le décalage en lignes dans cette unité, et sa position relative (repli quand
 * l'unité n'existe pas ailleurs, ou pour un fichier texte sans unités). Les autres panneaux se
 * placent sur la même unité. Un défilement programmatique n'est pas republié.
 */

export interface SyncAnchor {
  key: string | null
  offset: number
  ratio: number
}

export interface SyncPane {
  scrollTo(anchor: SyncAnchor): void
}

export class ScrollSyncGroup {
  private panes = new Map<string, SyncPane>()

  register(id: string, pane: SyncPane): () => void {
    this.panes.set(id, pane)
    return () => { if (this.panes.get(id) === pane) this.panes.delete(id) }
  }

  publish(fromId: string, anchor: SyncAnchor): void {
    for (const [id, pane] of this.panes) if (id !== fromId) pane.scrollTo(anchor)
  }
}

export function useScrollSyncGroup(): ScrollSyncGroup {
  const [group] = useState(() => new ScrollSyncGroup())
  return group
}

/**
 * Sets `scrollTop` and remembers it was not the user: the scroll events it triggers must not be
 * published again (the panes would chase each other). A time window rather than the expected
 * value: CodeMirror re-measures and nudges its own scroll position, and a shorter pane is clamped
 * — both produce scroll events whose position matches nothing that was set.
 */
export function programmaticScroller(windowMs = 200) {
  let until = 0
  return {
    set(el: HTMLElement, top: number) {
      const target = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight))
      if (Math.abs(el.scrollTop - target) < 1) return
      until = Date.now() + windowMs
      el.scrollTop = target
    },
    /** True while the scroll events of this pane come from `set`, not from the user. */
    isEcho(_el: HTMLElement): boolean {
      return Date.now() < until
    },
  }
}

export function ratioOf(el: HTMLElement): number {
  const max = el.scrollHeight - el.clientHeight
  return max > 0 ? el.scrollTop / max : 0
}

// ─── Préférences de l'éditeur (par poste, localStorage) ──────────────────────────────

const SHOW_BASE_KEY = 'polenta:mergeShowBase'
const SPLIT_KEY = 'polenta:mergeSplit'
const MODE_KEY = 'polenta:mergeViewMode'

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable: preference not kept */ }
}

export const mergePrefs = {
  showBase: () => read(SHOW_BASE_KEY) === 'true',
  setShowBase: (v: boolean) => write(SHOW_BASE_KEY, String(v)),
  /** Part (en %) de la rangée du haut — 45 par défaut, bornée à [15, 85]. */
  split: () => {
    const n = Number(read(SPLIT_KEY))
    return Number.isFinite(n) && n >= 15 && n <= 85 ? n : 45
  },
  setSplit: (v: number) => write(SPLIT_KEY, String(Math.round(v))),
  mode: (): 'raw' | 'rendered' => (read(MODE_KEY) === 'rendered' ? 'rendered' : 'raw'),
  setMode: (v: 'raw' | 'rendered') => write(MODE_KEY, v),
}

/** Same synchronization for an HTML pane whose units carry `data-unit` (mode « Rendu »). */
export function useElementSync(group: ScrollSyncGroup, id: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [scroller] = useState(programmaticScroller)
  useEffect(() => group.register(id, {
    scrollTo(anchor) {
      const el = ref.current
      if (!el) return
      const target = anchor.key ? el.querySelector<HTMLElement>(`[data-unit="${CSS.escape(anchor.key)}"]`) : null
      scroller.set(el, target ? target.offsetTop : anchor.ratio * (el.scrollHeight - el.clientHeight))
    },
  }), [group, id, scroller])
  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el || scroller.isEcho(el)) return
    const units = [...el.querySelectorAll<HTMLElement>('[data-unit]')]
    const top = units.find(u => u.offsetTop + u.offsetHeight > el.scrollTop)
    group.publish(id, { key: top?.dataset.unit ?? null, offset: 0, ratio: ratioOf(el) })
  }, [group, id, scroller])
  return { ref, onScroll }
}
