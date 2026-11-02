/**
 * GH238 — terminal de la vue Version : raccourci, routes où il existe, rafraîchissement de
 * l'interface après une commande. Logique pure (pas de DOM réel) pour être testée par vitest.
 */

/** Routes du panneau Version (même liste que `deducePanel` ; `/versioning` redirige vers `/graph`). */
const VERSION_ROUTES = new Set(['/graph', '/diff', '/version-diff', '/baseline'])

export function isVersionRoute(pathname: string): boolean {
  return VERSION_ROUTES.has(pathname)
}

/** Ctrl+ù (AZERTY) ou Ctrl+` (QWERTY) — la même touche physique que le terminal de VS Code.
 *  Pas de filtre « cible éditable » (contrairement à Ctrl+B) : le raccourci doit marcher depuis
 *  le terminal lui-même. */
export function isTerminalToggleShortcut(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'repeat' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): boolean {
  if (e.repeat || !e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false
  return e.key === 'ù' || e.key === '`' || e.code === 'Backquote'
}

/** QUIET_MS après la dernière sortie qui suit une Entrée : la commande est supposée terminée,
 *  l'interface est rafraîchie (index git, état de merge/rebase : invisibles au watcher). Reste
 *  armé jusqu'à la frappe suivante : une commande qui marque une pause (fetch lent) est
 *  rafraîchie à chaque accalmie, donc aussi à sa vraie fin. */
export const QUIET_MS = 500

export class QuietRefresh {
  private armed = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly refresh: () => void, private readonly delay = QUIET_MS) {}

  /** Frappe dans le terminal : Entrée arme, toute autre frappe désarme (l'écho de la saisie de la
   *  commande suivante ne déclenche rien). */
  onInput(data: string): void {
    if (data.includes('\r')) {
      this.armed = true
      this.restart()
    } else {
      this.disarm()
    }
  }

  onOutput(): void {
    if (this.armed) this.restart()
  }

  dispose(): void {
    this.disarm()
  }

  private disarm(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.armed = false
  }

  private restart(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.refresh()
    }, this.delay)
  }
}
