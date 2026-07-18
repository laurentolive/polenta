import * as path from 'path'
import type { GitService } from './git.service'

/**
 * Shared, serialized ID generation for counter-backed objects (requirements, tests,
 * campaigns…) stored one-YAML-file-per-object under `dir/<prefix>-XXXX.yaml`, with the
 * running count kept in `config/counters.yaml` (T118).
 *
 * Each call site used to read-modify-write `counters.yaml` on its own, with two bugs:
 *  - no serialization → two `create()` calls racing within the same process can read the
 *    same counter value before either writes back, so they mint the same ID and the second
 *    write silently clobbers the first object's file (no error, data loss).
 *  - the counter was trusted blindly, with no reconciliation against `dir` — a counter left
 *    stale by files written outside this path (seed data, manual edits) could hand out an ID
 *    that already exists on disk, again clobbering it.
 *
 * `nextCounterId` fixes both: an in-memory queue serializes every counter read+write for a
 * given `repoPath` (matching the pattern `CampaignsService.enqueue` already uses for
 * per-object mutations), and the candidate number is the max of the stored counter and the
 * highest `<prefix>-NNNN` actually present in `dir`, so a stale counter self-heals instead
 * of colliding.
 */
const queues = new Map<string, Promise<unknown>>()

export async function nextCounterId(
  git: GitService,
  repoPath: string,
  prefix: string,
  dir: string,
): Promise<string> {
  const key = repoPath
  const prev = queues.get(key) ?? Promise.resolve()
  const run = prev.then(
    () => computeNextId(git, repoPath, prefix, dir),
    () => computeNextId(git, repoPath, prefix, dir),
  )
  queues.set(key, run.then(() => undefined, () => undefined))
  return run
}

/**
 * Formats a counter number into the `<PREFIX>-XXXX` ID convention shared by every
 * counter-backed object type (requirements, tests, campaigns…) — extracted so
 * `computeNextId` (writes) and `peekNextCounterId` (read-only preview, T122 sprint 2)
 * always render the same format from the same number.
 */
export function formatCounterId(prefix: string, num: number): string {
  return `${prefix}-${String(num).padStart(4, '0')}`
}

/**
 * Reads `config/counters.yaml` + the highest `<prefix>-NNNN` file actually present in
 * `dir`, and returns both the reconciled next number and the raw per-prefix counts
 * map (needed by `computeNextId` to write back without clobbering other prefixes).
 * Shared by `computeNextId` (write path) and `peekNextCounterId` (read-only preview)
 * so the two can never compute a different "next number" from the same disk state.
 */
async function readCounterState(
  git: GitService,
  repoPath: string,
  prefix: string,
  dir: string,
): Promise<{ counts: Record<string, number>; nextNum: number }> {
  const raw = await git.readYaml<Record<string, unknown>>(repoPath, 'config/counters.yaml') ?? {}
  // Strip old-format fields (nextId, prefixes), keep per-prefix counts.
  const { nextId: _n, prefixes: _p, ...counts } = raw as { nextId?: unknown; prefixes?: unknown } & Record<string, number>
  const counterValue = typeof counts[prefix] === 'number' ? counts[prefix] : 0

  const files = await git.listFiles(repoPath, dir)
  const idPattern = new RegExp(`^${prefix}-(\\d+)\\.yaml$`)
  const maxOnDisk = files.reduce((max, f) => {
    const m = idPattern.exec(path.basename(f))
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)

  return { counts, nextNum: Math.max(counterValue, maxOnDisk) + 1 }
}

async function computeNextId(git: GitService, repoPath: string, prefix: string, dir: string): Promise<string> {
  const { counts, nextNum } = await readCounterState(git, repoPath, prefix, dir)
  await git.writeYaml(repoPath, 'config/counters.yaml', { ...counts, [prefix]: nextNum })
  return formatCounterId(prefix, nextNum)
}

/**
 * Read-only variant of `nextCounterId` (T122 sprint 2 — `bulk_import_*` dry-run
 * preview): computes the counter number a new object of this `prefix`/`dir` would
 * receive right now, WITHOUT writing `counters.yaml`. Deliberately NOT serialized
 * through the `queues` map — nothing is written, so there's no read-modify-write
 * race to protect against here (unlike `nextCounterId`).
 *
 * Returns only the baseline number, not a formatted ID — a caller previewing several
 * entries of the same prefix within one batch (e.g. `bulk_import_requirements` with
 * 5 entries of the same type) must add its own in-batch offset on top of this
 * baseline before formatting (see `mcp-server/tools/bulk-import.tools.ts`), so that
 * predicted IDs within the same batch are distinct even though this function itself
 * only reflects the current on-disk state.
 */
export async function peekNextCounterId(
  git: GitService,
  repoPath: string,
  prefix: string,
  dir: string,
): Promise<number> {
  const { nextNum } = await readCounterState(git, repoPath, prefix, dir)
  return nextNum
}
