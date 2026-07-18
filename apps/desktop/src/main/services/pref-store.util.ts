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
