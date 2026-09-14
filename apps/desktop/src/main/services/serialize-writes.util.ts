/**
 * T159 — Per-key async serialization.
 *
 * `RequirementsService` / `TestsService` mutations are read-modify-write on a YAML file
 * (`findById` → merge → `writeYaml`) with no locking. Two concurrent mutations of the same
 * object (e.g. a debounced richtext autosave landing next to a status transition, or the
 * per-field autosave of the Excel/Word views) can interleave so the second `writeYaml`
 * overwrites the first's field. Wrapping each mutation in `withKeyLock(objectKey, …)` runs
 * them one at a time per object; unrelated objects still run in parallel.
 */

const tails = new Map<string, Promise<unknown>>()

/** Runs `fn` after any in-flight call sharing the same `key` has settled. The returned
 *  promise rejects if `fn` rejects (the caller still sees its own error); a rejection does
 *  not block the queued followers. */
export function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn)
  const settled = run.then(
    () => undefined,
    () => undefined,
  )
  tails.set(key, settled)
  void settled.then(() => {
    if (tails.get(key) === settled) tails.delete(key)
  })
  return run
}
