import { findRegions, renderRegion, resolveRegion, resolveRegionBoth, type MarkerLabels } from '@polenta/merge-core'

/**
 * GH222 — où est un bloc de conflit dans un texte :
 * - dans un panneau du haut (mes modifications / destination) : la ligne de son fragment, pour y
 *   poser « Prendre gauche / droite » ;
 * - dans la sortie, une fois résolu : le texte retenu (gauche, droite ou les deux), pour le
 *   marquer « résolu » et pouvoir le réinitialiser (rétablir la région de marqueurs).
 */

export interface BlockFragments {
  key: string
  left?: string
  right?: string
}

export type Taken = 'left' | 'right' | 'both'

export interface ResolvedBlock {
  key: string
  taken: Taken
  /** Lignes (0-based, bornes incluses) du texte retenu dans la sortie. */
  from: number
  to: number
  /** Texte retenu, tel qu'il figure dans la sortie. */
  text: string
}

const lines = (s: string) => s.replace(/\n$/, '').split('\n')

/** First occurrence of `fragment` as whole lines of `text`, at or after line `fromLine`, outside
 *  the `skip` line ranges. */
export function findLines(text: string, fragment: string, fromLine = 0, skip: [number, number][] = []): { from: number; to: number } | null {
  if (fragment.trim() === '') return null
  const hay = text.split('\n')
  const needle = lines(fragment)
  outer: for (let i = fromLine; i + needle.length <= hay.length; i++) {
    for (const [a, b] of skip) if (i <= b && i + needle.length - 1 >= a) continue outer
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return { from: i, to: i + needle.length - 1 }
  }
  return null
}

/** Every occurrence of `fragment` as whole lines of `text`, outside the `skip` line ranges. */
export function findAllLines(text: string, fragment: string, skip: [number, number][] = []): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  let from = 0
  for (;;) {
    const found = findLines(text, fragment, from, skip)
    if (!found) return out
    out.push(found)
    from = found.from + 1
  }
}

/** The occurrence closest to `hint` (a fragment as short as `status: draft` may appear elsewhere
 *  in the file: the right one is where the block is expected), the first one without a hint. */
function nearest(found: { from: number; to: number }[], hint: number | undefined) {
  if (found.length === 0) return null
  if (hint === undefined) return found[0]
  return found.reduce((best, f) => (Math.abs(f.from - hint) < Math.abs(best.from - hint) ? f : best))
}

/** Line of each still-open block's fragment in a side pane (`side` = which fragment). `open`
 *  gives the line of each open region in the output: the side and the output share their layout,
 *  so the fragment closest to that line is the block's. */
export function sideAnchors(sideText: string, blocks: BlockFragments[], open: Map<string, number>, side: 'left' | 'right'): { key: string; line: number }[] {
  const out: { key: string; line: number }[] = []
  for (const b of blocks) {
    if (!open.has(b.key)) continue
    const found = nearest(findAllLines(sideText, (side === 'left' ? b.left : b.right) ?? ''), open.get(b.key))
    if (found) out.push({ key: b.key, line: found.from })
  }
  return out
}

/** The three texts a block can be resolved to (`both` only when « Prendre les deux » applies). */
export function takenTexts(block: BlockFragments, labels: MarkerLabels): { taken: Taken; text: string }[] {
  const region = renderRegion(block.key, block.left, block.right, labels)
  const both = resolveRegionBoth(region, block.key)
  const out: { taken: Taken; text: string }[] = []
  if (both !== region) out.push({ taken: 'both', text: both })
  for (const side of ['left', 'right'] as const) out.push({ taken: side, text: resolveRegion(region, block.key, side) })
  return out.filter(x => x.text.trim() !== '')
}

/** Blocks no longer open whose chosen text is found in the output (an edited one is not), at the
 *  occurrence closest to `hints` (where the block's region was). */
export function resolvedBlocks(output: string, blocks: BlockFragments[], labels: MarkerLabels, hints: Map<string, number> = new Map()): ResolvedBlock[] {
  const { regions } = findRegions(output)
  const open = new Set(regions.map(r => r.key))
  const skip: [number, number][] = regions.map(r => [r.start, r.end])
  const out: ResolvedBlock[] = []
  for (const b of blocks) {
    if (open.has(b.key)) continue
    // Longest candidate first: « both » contains each side's text.
    for (const c of takenTexts(b, labels)) {
      const found = nearest(findAllLines(output, c.text, [...skip, ...out.map(r => [r.from, r.to] as [number, number])]), hints.get(b.key))
      if (found) {
        out.push({ key: b.key, taken: c.taken, from: found.from, to: found.to, text: c.text })
        break
      }
    }
  }
  return out
}

/** Puts the conflict region of `block` back in place of its chosen text (« Réinitialiser »). */
export function resetBlock(output: string, block: BlockFragments, resolved: ResolvedBlock, labels: MarkerLabels): string {
  const all = output.split('\n')
  const region = renderRegion(block.key, block.left, block.right, labels).replace(/\n$/, '').split('\n')
  all.splice(resolved.from, resolved.to - resolved.from + 1, ...region)
  return all.join('\n')
}
