export type DiffLine = { type: 'context' | 'add' | 'remove'; content: string; lineNum: number }

/** Line diff (LCS) of two texts, capped at 2 000 lines per side — the Raw mode of the diff views. */
export function computeLineDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent ? oldContent.split('\n') : []
  const newLines = newContent ? newContent.split('\n') : []

  const m = Math.min(oldLines.length, 2000)
  const n = Math.min(newLines.length, 2000)

  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const result: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'context', content: oldLines[i - 1], lineNum: j })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', content: newLines[j - 1], lineNum: j })
      j--
    } else {
      result.unshift({ type: 'remove', content: oldLines[i - 1], lineNum: i })
      i--
    }
  }
  return result
}
