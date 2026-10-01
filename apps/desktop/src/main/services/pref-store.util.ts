import * as fs from 'fs'
import * as path from 'path'

/**
 * Shared read/write for the per-user `.{username}.pref` JSON file (never committed —
 * same mechanism as column-visibility prefs, cf. `ipc/pref.handlers.ts`). Extracted so
 * `saved-queries.service.ts` (savedQueries / queryHistory / queriesOrder keys) and
 * `pref.handlers.ts` (fieldVisibility key) don't each reimplement the same tiny
 * read-whole-file/merge-key/write-whole-file logic.
 */

export function prefPath(repoPath: string, username: string): string {
  return path.join(repoPath, `.${username}.pref`)
}

export function readPref(repoPath: string, username: string): Record<string, unknown> {
  try {
    const content = fs.readFileSync(prefPath(repoPath, username), 'utf-8')
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function writePref(repoPath: string, username: string, data: Record<string, unknown>): void {
  fs.writeFileSync(prefPath(repoPath, username), JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * GH29 — one-shot merge of `.local.pref` into `.{username}.pref`. Until GH29 the renderer
 * always resolved the identity to `local`, so everything saved so far lives in `.local.pref`.
 * The first time a real login is resolved for this repo, its content is folded into the
 * user's file (what the user's file already holds wins), then `.local.pref` is renamed to
 * `.local.migrated.pref` — still matched by the `*.pref` gitignore — so it isn't merged twice.
 */
export function migrateLocalPref(repoPath: string, username: string): void {
  if (username === 'local') return
  const localPath = prefPath(repoPath, 'local')
  if (!fs.existsSync(localPath)) return
  const local = readPref(repoPath, 'local')
  const merged = readPref(repoPath, username)
  for (const [key, value] of Object.entries(local)) {
    merged[key] = mergePrefValue(merged[key], value)
  }
  writePref(repoPath, username, merged)
  fs.renameSync(localPath, path.join(repoPath, '.local.migrated.pref'))
}

/** `target` wins; arrays are unioned (by `id` for objects, by value otherwise), plain
 *  objects merged key by key (fieldVisibility). */
function mergePrefValue(target: unknown, source: unknown): unknown {
  if (target === undefined) return source
  if (Array.isArray(target) && Array.isArray(source)) {
    const keyOf = (v: unknown): unknown =>
      v && typeof v === 'object' && 'id' in v ? (v as { id: unknown }).id : v
    const seen = new Set(target.map(keyOf))
    return [...target, ...source.filter((v) => !seen.has(keyOf(v)))]
  }
  if (isPlainObject(target) && isPlainObject(source)) return { ...source, ...target }
  return target
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
