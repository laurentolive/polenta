import { Text } from '@codemirror/state'
import { Chunk } from '@codemirror/merge'

/** Precise diff on large files too (the default 500-character scan limit of the merge view merges
 *  distant changes of a long file into one chunk), with a time budget as a safety net. */
export const DIFF_CONFIG = { scanLimit: 50_000, timeout: 1000 }

/**
 * GH222 — compteurs `+n / −m` d'un diff, avec le même algorithme que la vue Raw
 * (`@codemirror/merge`) : lignes des blocs changés côté Après (ajoutées) et côté Avant (retirées).
 */
export function lineStats(before: string, after: string): { added: number; removed: number } {
  const a = Text.of(before.split('\n'))
  const b = Text.of(after.split('\n'))
  let added = 0
  let removed = 0
  for (const c of Chunk.build(a, b, DIFF_CONFIG)) {
    if (c.toB > c.fromB) added += b.lineAt(c.endB).number - b.lineAt(c.fromB).number + 1
    if (c.toA > c.fromA) removed += a.lineAt(c.endA).number - a.lineAt(c.fromA).number + 1
  }
  return { added, removed }
}
