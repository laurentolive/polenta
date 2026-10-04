import * as path from 'path'
import { formatCounterId } from '@polenta/merge-core'
import type { GitService } from './git.service'

/**
 * Shared, serialized ID generation for every counter-backed object type (requirements,
 * tests, campaigns, reviews, shared dashboards, shared queries) stored one-YAML-file-per-object
 * under `dir/<prefix>-XXXX.yaml` (T118, reworked GH20).
 *
 * GH20 — no persisted counter any more: the next number is derived from what is on disk,
 * `max(highest <prefix>-NNNN in dir, highest tombstone <prefix>-NNNN, highest issued this
 * session) + 1`. The former `config/counters.yaml` was rewritten on every creation, which made
 * it a merge conflict on nearly every pair of branches creating objects; its only real value
 * over parsing was remembering physically deleted IDs, which the tombstones now do
 * (`deleteWithTombstone`). An existing `counters.yaml` is migrated lazily on the first
 * allocation in its repo (`migrateCountersIfPresent`).
 *
 * Serialization (T118): an in-memory queue per repo makes concurrent `nextCounterId` calls of
 * one process run one after the other. Since nothing is written to reserve an ID any more, the
 * `issued` high-water mark is what keeps two back-to-back calls from getting the same number
 * before the first caller has written its file (a gap if that write never happens, never a
 * collision — cf. specs/GH20-design.md §2.2).
 */

/** Tombstones of physically deleted objects: one empty file per ID, never removed. */
export const TOMBSTONES_DIR = '.polenta/tombstones'

const COUNTERS_PATH = 'config/counters.yaml'
/** Every folder holding counter-backed objects — searched by the counters.yaml migration. */
const OBJECT_DIRS = ['requirements', 'tests', 'campaigns', 'reviews', 'dashboards', 'queries']

const queues = new Map<string, Promise<unknown>>()
/** Highest number issued this session, keyed by `issuedKey(repoPath, prefix)`. */
const issued = new Map<string, number>()

const issuedKey = (repoPath: string, prefix: string) => `${path.resolve(repoPath)}\0${prefix}`

/**
 * `historyRepos`: other repos whose ID history for `prefix` must also be honored — the product
 * repo when a component's requirement/test is created from it. Before GH20 those IDs were
 * counted in the product's `counters.yaml`, whose migration leaves the matching tombstone in
 * the product repo, not in the component: their tombstones and not-yet-migrated counter value
 * are included in the max (never migrated from here — that happens on their own allocations).
 */
export async function nextCounterId(
  git: GitService,
  repoPath: string,
  prefix: string,
  dir: string,
  historyRepos: string[] = [],
): Promise<string> {
  const key = path.resolve(repoPath)
  const prev = queues.get(key) ?? Promise.resolve()
  const run = prev.then(
    () => computeNextId(git, repoPath, prefix, dir, historyRepos),
    () => computeNextId(git, repoPath, prefix, dir, historyRepos),
  )
  queues.set(key, run.then(() => undefined, () => undefined))
  return run
}

/**
 * Formats a counter number into the `<PREFIX>-XXXX` ID convention shared by every
 * counter-backed object type — extracted so `computeNextId` (writes) and
 * `peekNextCounterId` (read-only preview, T122 sprint 2) always render the same format
 * from the same number. GH37: lives in `@polenta/merge-core`, whose renumbering
 * ("Garder les deux") must issue IDs in exactly this format too.
 */
export { formatCounterId }

/**
 * Physically deletes an object's file, leaving its tombstone behind so its ID is never
 * issued again (GH20). The tombstone is written first: if the deletion then fails, the
 * leftover tombstone only means the ID won't be reused — harmless.
 */
export async function deleteWithTombstone(
  git: GitService,
  repoPath: string,
  relPath: string,
  id: string,
): Promise<void> {
  await git.writeText(repoPath, `${TOMBSTONES_DIR}/${id}`, '')
  await git.deleteFile(repoPath, relPath)
}

/**
 * Belt-and-suspenders before writing a freshly allocated object: `writeYaml` overwrites
 * silently, and the serialization above only covers one process — the desktop app and the
 * MCP server working on the same repo at once could still both get the same ID. Same check
 * as `RequirementsService`/`TestsService.create` (T118), shared by the other creators (GH20).
 */
export async function assertNewObjectFile(git: GitService, repoPath: string, relPath: string, id: string): Promise<void> {
  if (await git.fileExists(repoPath, relPath)) {
    throw new Error(`${id} already exists`)
  }
}

const escapeRegExp =(s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Highest `NNNN` among `files` whose basename is `<prefix>-NNNN<suffix>`, 0 if none. */
function maxNumber(files: string[], prefix: string, suffix: string): number {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)${escapeRegExp(suffix)}$`)
  return files.reduce((max, f) => {
    const m = pattern.exec(path.basename(f))
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
}

/** Numeric entries of a pre-GH20 `counters.yaml` (value = last number issued); the legacy
 *  `nextId`/`prefixes` keys and any non-integer value are ignored. Null if the file is absent. */
async function readLegacyCounters(git: GitService, repoPath: string): Promise<Record<string, number> | null> {
  const raw = await git.readYaml<unknown>(repoPath, COUNTERS_PATH)
  if (raw === null) return null
  const counts: Record<string, number> = {}
  if (typeof raw !== 'object' || Array.isArray(raw)) return counts
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === 'nextId' || k === 'prefixes') continue
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) counts[k] = v
  }
  return counts
}

/**
 * Next number for `prefix` in `repoPath`, without writing anything. Shared by
 * `computeNextId` (write path) and `peekNextCounterId` (read-only preview) so the two can
 * never compute a different number from the same state. A not-yet-migrated `counters.yaml`
 * is taken into account (it holds the last number issued), so a preview made before the
 * migration predicts what the allocation right after it will return.
 */
async function computeNextNumber(
  git: GitService,
  repoPath: string,
  prefix: string,
  dir: string,
  historyRepos: string[],
): Promise<number> {
  const [files, ...history] = await Promise.all([
    git.listFiles(repoPath, dir),
    ...[repoPath, ...historyRepos].map((r) => historyMax(git, r, prefix)),
  ])
  return Math.max(
    maxNumber(files, prefix, '.yaml'),
    ...history,
    issued.get(issuedKey(repoPath, prefix)) ?? 0,
  ) + 1
}

/** Highest number `repoPath` remembers for `prefix` beyond its live files: tombstones, plus a
 *  not-yet-migrated `counters.yaml` entry. */
async function historyMax(git: GitService, repoPath: string, prefix: string): Promise<number> {
  const [tombstones, legacy] = await Promise.all([
    git.listFiles(repoPath, TOMBSTONES_DIR),
    readLegacyCounters(git, repoPath),
  ])
  return Math.max(maxNumber(tombstones, prefix, ''), legacy?.[prefix] ?? 0)
}

/**
 * GH20 migration, idempotent: for every counter whose last issued ID has no file left in the
 * repo, lay its tombstone (that ID was issued, then deleted), then remove `counters.yaml`. An
 * interruption between the two steps is replayed identically on the next allocation.
 */
async function migrateCountersIfPresent(git: GitService, repoPath: string): Promise<void> {
  const legacy = await readLegacyCounters(git, repoPath)
  if (legacy === null) return

  const entries = Object.entries(legacy)
  if (entries.length > 0) {
    const [objectFiles, tombstones] = await Promise.all([
      Promise.all(OBJECT_DIRS.map((d) => git.listFiles(repoPath, d)))
        .then((lists) => new Set(lists.flat().map((f) => path.basename(f)))),
      git.listFiles(repoPath, TOMBSTONES_DIR).then((l) => new Set(l.map((f) => path.basename(f)))),
    ])
    for (const [prefix, last] of entries) {
      const id = formatCounterId(prefix, last)
      if (objectFiles.has(`${id}.yaml`) || tombstones.has(id)) continue
      await git.writeText(repoPath, `${TOMBSTONES_DIR}/${id}`, '')
    }
  }
  await git.deleteFile(repoPath, COUNTERS_PATH)
}

async function computeNextId(
  git: GitService,
  repoPath: string,
  prefix: string,
  dir: string,
  historyRepos: string[],
): Promise<string> {
  await migrateCountersIfPresent(git, repoPath)
  const nextNum = await computeNextNumber(git, repoPath, prefix, dir, historyRepos)
  issued.set(issuedKey(repoPath, prefix), nextNum)
  return formatCounterId(prefix, nextNum)
}

/**
 * Read-only variant of `nextCounterId` (T122 sprint 2 — `bulk_import_*` dry-run
 * preview): the counter number a new object of this `prefix`/`dir` would receive right
 * now, WITHOUT writing anything (no migration, no `issued` update). Deliberately NOT
 * serialized through the `queues` map — nothing is written, so there's no race to
 * protect against here.
 *
 * Returns only the baseline number, not a formatted ID — a caller previewing several
 * entries of the same prefix within one batch (e.g. `bulk_import_requirements` with
 * 5 entries of the same type) must add its own in-batch offset on top of this
 * baseline before formatting (see `mcp-server/tools/bulk-import.tools.ts`).
 */
export async function peekNextCounterId(
  git: GitService,
  repoPath: string,
  prefix: string,
  dir: string,
  historyRepos: string[] = [],
): Promise<number> {
  return computeNextNumber(git, repoPath, prefix, dir, historyRepos)
}
