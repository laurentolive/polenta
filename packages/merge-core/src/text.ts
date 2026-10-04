/// <reference path="./diff3.d.ts" />
import diff3Merge from 'diff3'
import { renderRegion } from './markers'
import type { FileMerge, MarkerLabels, MergeBlock } from './types'

/** Lines with their line break kept, so joining them gives the text back exactly. */
export function linesWithBreaks(text: string): string[] {
  if (text === '') return []
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

/**
 * Line-based 3-way merge — same `diff3` library and argument order as isomorphic-git's
 * `mergeFile`, so a file is in conflict here exactly when it is for `git.merge`. Each conflicting
 * chunk becomes a block `hunk:<n>`.
 */
export function mergeText(base: string | null, left: string, right: string, labels: MarkerLabels): FileMerge {
  const chunks = diff3Merge(linesWithBreaks(left), linesWithBreaks(base ?? ''), linesWithBreaks(right))
  const blocks: MergeBlock[] = []
  let output = ''
  for (const chunk of chunks) {
    if (chunk.ok) {
      output += chunk.ok.join('')
      continue
    }
    const key = `hunk:${blocks.length}`
    const block: MergeBlock = { key, left: chunk.conflict.a.join(''), right: chunk.conflict.b.join('') }
    blocks.push(block)
    // A region always starts on its own line: if the previous chunk ended without a line break
    // (cannot normally happen, a chunk boundary is a line boundary), add one.
    if (output !== '' && !output.endsWith('\n')) output += '\n'
    output += renderRegion(key, block.left, block.right, labels)
  }
  return { kind: 'text', output, blocks, auto: [] }
}

/** Above this many cells the LCS table is not built — the caller simply gets no highlighting. */
const MAX_LCS_CELLS = 4_000_000

/**
 * 0-based indexes of the lines of `text` that are not part of a longest common subsequence with
 * `base` (added or changed lines) — used to highlight what a side changed. `null` when the files
 * are too large to diff cheaply.
 */
export function changedLineIndexes(base: string | null, text: string): Set<number> | null {
  const a = (base ?? '').split('\n')
  const b = text.split('\n')
  if (base === null) return new Set(b.map((_, i) => i))
  if (a.length * b.length > MAX_LCS_CELLS) return null
  const n = a.length
  const m = b.length
  // lcs[i][j] = LCS length of a[i..] and b[j..], flattened.
  const lcs = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = a[i] === b[j]
        ? lcs[(i + 1) * (m + 1) + j + 1] + 1
        : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1])
    }
  }
  const changed = new Set<number>()
  let i = 0
  let j = 0
  while (j < m) {
    if (i < n && a[i] === b[j]) { i++; j++ }
    else if (i < n && lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1]) i++
    else { changed.add(j); j++ }
  }
  return changed
}
