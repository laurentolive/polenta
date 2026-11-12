/**
 * GH342 — partage d'un appel asynchrone entre plusieurs demandeurs (plusieurs fenêtres desktop,
 * plusieurs onglets web d'un même utilisateur) : un appel en cours pour la même clé est partagé, et
 * un résultat obtenu il y a moins de `windowMs` est renvoyé tel quel. Un échec n'est pas gardé :
 * l'appel suivant réessaie.
 */
export function coalesceRecent<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  keyOf: (...args: A) => string,
  windowMs: number,
  now: () => number = Date.now,
): (...args: A) => Promise<R> {
  const inflight = new Map<string, Promise<R>>()
  const recent = new Map<string, { at: number; value: R }>()

  return (...args: A) => {
    const key = keyOf(...args)
    const cached = recent.get(key)
    if (cached && now() - cached.at < windowMs) return Promise.resolve(cached.value)
    const running = inflight.get(key)
    if (running) return running

    const p = fn(...args).then(
      value => {
        recent.set(key, { at: now(), value })
        return value
      },
    ).finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }
}
