import { describe, expect, it } from 'vitest'
import { themeTokens } from '../theme.config'

/** GH222 — lisibilité des jetons `diff-*` (specs/GH222-tests.md H12), dans les deux thèmes. */

type Theme = 'light' | 'dark'
const rgb = (name: string, theme: Theme) => themeTokens[name][theme].split(' ').map(Number)

function luminance([r, g, b]: number[]): number {
  const c = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}

const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const FILLS = ['line-del', 'char-del', 'line-ins', 'char-ins', 'left-line', 'left-char', 'right-line', 'right-char', 'conflict-bg']
const PAIRS: [string, string][] = [['line-del', 'char-del'], ['line-ins', 'char-ins'], ['left-line', 'left-char'], ['right-line', 'right-char']]

describe.each(['light', 'dark'] as Theme[])('jetons diff-* — thème %s', theme => {
  it.each(FILLS)('texte lisible sur diff-%s (≥ 4,5:1)', fill => {
    expect(contrast(rgb('ink', theme), rgb(`diff-${fill}`, theme))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(FILLS)('diff-%s se distingue du fond des panneaux', fill => {
    expect(distance(rgb(`diff-${fill}`, theme), rgb('surface', theme))).toBeGreaterThanOrEqual(40)
  })

  it.each(PAIRS)('caractères changés (%s → %s) plus marqués que la ligne', (line, char) => {
    expect(distance(rgb(`diff-${line}`, theme), rgb(`diff-${char}`, theme))).toBeGreaterThanOrEqual(40)
  })
})
