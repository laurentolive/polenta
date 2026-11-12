/**
 * GH342 — saisies en attente d'enregistrement, vidées avant la fermeture d'une fenêtre : la fenêtre
 * est détruite sans démonter les vues, donc sans leurs propres « flush au démontage » (EditView,
 * édition en place de la vue système).
 *
 * - Les vues qui temporisent un enregistrement s'inscrivent (`registerEditFlusher`) : à la demande,
 *   elles lancent tout de suite ce qu'elles auraient envoyé plus tard.
 * - Les appels au main en cours sont suivis (`trackInflight`, posé dans `renderer/api.ts`) :
 *   `flushPendingEdits` attend qu'ils aboutissent, dans la limite d'un délai.
 */

type Flusher = () => void

const flushers = new Set<Flusher>()
const inflight = new Set<Promise<unknown>>()

export function registerEditFlusher(flush: Flusher): () => void {
  flushers.add(flush)
  return () => { flushers.delete(flush) }
}

export function trackInflight<T>(p: Promise<T>): Promise<T> {
  inflight.add(p)
  const done = () => { inflight.delete(p) }
  p.then(done, done)
  return p
}

function nextTask(): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, 0) })
}

function isEditable(el: Element | null): el is HTMLElement {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

/** Quitte le champ actif (son enregistrement « au blur »), lance les enregistrements temporisés,
 *  puis attend les appels en cours (au plus `timeoutMs`). */
export async function flushPendingEdits(timeoutMs = 2000): Promise<void> {
  const active = typeof document !== 'undefined' ? document.activeElement : null
  if (isEditable(active)) active.blur()
  for (const flush of flushers) {
    try { flush() } catch (err) { console.error('[GH342] flush des saisies', err) }
  }
  // Les enregistrements lancés ci-dessus ou par le blur passent souvent par `mutate()` (TanStack
  // Query), qui n'appelle le main qu'après plusieurs étapes asynchrones : une tâche complète (toutes
  // les micro-tâches écoulées) pour qu'ils soient suivis avant d'attendre.
  await nextTask()
  if (inflight.size === 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.allSettled([...inflight]),
    new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs) }),
  ])
  clearTimeout(timer)
}
