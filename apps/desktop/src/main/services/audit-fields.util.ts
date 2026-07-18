/**
 * T112 — `createdAt`/`createdBy`/`updatedAt`/`updatedBy` are derived from the file's git
 * log at read time (see `GitService.fileHistory()`), never persisted in the YAML itself.
 * Shared by `requirements.service.ts` and `tests.service.ts`: strips the 4 fields off an
 * in-memory `Requirement`/`TestCase` right before `GitService.writeYaml()` — the object
 * returned to the caller (and passed to the index's `upsert`) keeps them, only the
 * on-disk payload omits them.
 */
export function omitAuditFields<
  T extends { createdAt: unknown; createdBy: unknown; updatedAt: unknown; updatedBy: unknown },
>(obj: T): Omit<T, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> {
  const { createdAt: _createdAt, createdBy: _createdBy, updatedAt: _updatedAt, updatedBy: _updatedBy, ...rest } = obj
  return rest
}
