import yaml from 'js-yaml'
import { findRegions, renderRegion, splitLines } from './markers'
import { isPlainObject, YAML_DUMP_OPTIONS } from './object'
import type { MarkerLabels, MergeBlock } from './types'

/**
 * GH222 — sortie YAML d'un merge, avec une région de marqueurs par bloc en conflit, à **toute
 * profondeur** (GH37 ne plaçait de régions qu'à la racine d'un objet et dans `fields`).
 *
 * Chaque bloc est d'abord une valeur de substitution dans l'arbre fusionné, puis la ligne qui la
 * porte, une fois l'arbre écrit, est remplacée par la région :
 *
 * - entrée de mapping   `<indent><clé>: __POLENTA_MERGE_n__`   → fragments `<clé>: <valeur>` ;
 * - élément(s) de liste `<indent>- __POLENTA_MERGE_n__`         → fragments `- <élément>` ;
 * - première clé d'un élément de liste `<indent>- <clé>: __POLENTA_MERGE_n__` → la ligne `-` seule,
 *   puis la région au retrait du mapping (`-` suivi d'un mapping à la ligne est du YAML valide).
 *
 * Retirer une région (fragment choisi ou vide) laisse toujours un YAML valide.
 */

export type Pending =
  | { key: string; form: 'entry'; name: string; left: unknown; right: unknown }
  | { key: string; form: 'items'; left: unknown[]; right: unknown[] }

export const placeholder = (i: number) => `__POLENTA_MERGE_${i}__`
const ITEM_LINE = /^( *)- __POLENTA_MERGE_(\d+)__$/
const ITEM_HEAD_LINE = /^( *)- (\S.*): __POLENTA_MERGE_(\d+)__$/
const ENTRY_LINE = /^( *)(\S.*): __POLENTA_MERGE_(\d+)__$/

function indented(text: string, indent: string): string {
  return text.split('\n').map(l => (l === '' ? l : indent + l)).join('\n')
}

function entryFragment(name: string, value: unknown, indent: string, opts: yaml.DumpOptions): string | undefined {
  return value === undefined ? undefined : indented(yaml.dump({ [name]: value }, opts), indent)
}

function itemsFragment(items: unknown[], indent: string, opts: yaml.DumpOptions): string | undefined {
  return items.length === 0 ? undefined : indented(yaml.dump(items, opts), indent)
}

/** Writes `value` (with placeholders) and replaces each placeholder line by its region. */
export function dumpWithRegions(
  value: unknown, pending: Pending[], labels: MarkerLabels, opts: yaml.DumpOptions = YAML_DUMP_OPTIONS,
): { output: string; blocks: MergeBlock[] } {
  const blocks: MergeBlock[] = []
  const region = (p: Pending, indent: string) => {
    const block: MergeBlock = p.form === 'entry'
      ? { key: p.key, left: entryFragment(p.name, p.left, indent, opts), right: entryFragment(p.name, p.right, indent, opts) }
      : { key: p.key, left: itemsFragment(p.left, indent, opts), right: itemsFragment(p.right, indent, opts) }
    blocks.push(block)
    // `renderRegion` ends with a line break, and this line is joined back with one: drop it.
    return renderRegion(block.key, block.left, block.right, labels).replace(/\n$/, '')
  }
  const output = tagRegionOnlyLists(yaml.dump(value, opts).split('\n'))
    .map(line => {
      let m = ITEM_LINE.exec(line)
      if (m) return region(pending[Number(m[2])], m[1])
      m = ITEM_HEAD_LINE.exec(line)
      if (m) return `${m[1]}-\n${region(pending[Number(m[3])], `${m[1]}  `)}`
      m = ENTRY_LINE.exec(line)
      if (m) return region(pending[Number(m[3])], m[1])
      return line
    })
    .join('\n')
  return { output, blocks }
}

const BLOCK_KEY_LINE = /^ *(?:- )?\S.*:$/
const indentOf = (line: string) => line.length - line.trimStart().length

/**
 * A list whose elements are all in regions would read as `null` once every region is resolved
 * empty (`children:` alone): its key is tagged `!!seq`, which js-yaml reads as an empty list and
 * which disappears when the output is written canonically (`canonicalOutput`).
 */
function tagRegionOnlyLists(lines: string[], itemLine: RegExp = ITEM_LINE): string[] {
  return lines.map((line, i) => {
    if (!BLOCK_KEY_LINE.test(line) || i + 1 >= lines.length) return line
    const first = lines[i + 1]
    const indent = indentOf(first)
    if (indent < indentOf(line) || !first.trimStart().startsWith('- ')) return line
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      if (l.trim() === '' || indentOf(l) < indent) break
      if (indentOf(l) === indent && !itemLine.test(l)) return line
      if (indentOf(l) > indent) return line
    }
    return `${line} !!seq`
  })
}

// ─── Édition d'une sortie qui a encore des régions ouvertes ─────────────────────────

/** A step of an output path: a mapping key, or the index of an element among the elements of the
 *  list that are **outside** any region (as `parseOutput` reads them). */
export type OutputPath = (string | number)[]

const REGION_KEY = (i: number) => `__polenta_region_${i}__`
const REGION_ITEM = /^ *- __polenta_region_(\d+)__$/
const REGION_ITEM_HEAD = /^( *)- __polenta_region_(\d+)__: null$/
const REGION_ENTRY = /^ *__polenta_region_(\d+)__: null$/
const IS_REGION_KEY = /^__polenta_region_\d+__$/

/** First non-blank line of the region's fragments: `- …` means list elements. */
function regionIndent(lines: string[], start: number, sep: number, end: number): { indent: string; items: boolean } {
  const body = [...lines.slice(start + 1, sep), ...lines.slice(sep + 1, end)]
  const first = body.find(l => l.trim() !== '') ?? ''
  return { indent: first.slice(0, first.length - first.trimStart().length), items: /^-( |$)/.test(first.trimStart()) }
}

/**
 * Sets (or removes, with `undefined`) the value at `path` of an output **without touching its
 * open regions** — the form edits of the "Rendu" mode. Each region is swapped for a placeholder
 * at its indentation (an element for a list region, a key otherwise), the YAML is loaded, changed
 * and written again, and the regions are put back verbatim. `null` when the text outside the
 * regions is not valid YAML or the path does not exist (the caller keeps the text as is).
 */
export function updateOutputAt(text: string, path: OutputPath, value: unknown, opts: yaml.DumpOptions = YAML_DUMP_OPTIONS): string | null {
  const { regions, error } = findRegions(text)
  if (error) return null
  const lines = splitLines(text)
  const regionText: string[] = []
  const out: string[] = []
  let r = 0
  for (let i = 0; i < lines.length; i++) {
    const region = regions[r]
    if (region && i === region.start) {
      const { indent, items } = regionIndent(lines, region.start, region.sep, region.end)
      out.push(items ? `${indent}- ${REGION_KEY(regionText.length)}` : `${indent}${REGION_KEY(regionText.length)}: null`)
      regionText.push(lines.slice(region.start, region.end + 1).join('\n'))
      i = region.end
      r++
      continue
    }
    out.push(lines[i])
  }

  let root: unknown
  try {
    root = yaml.load(out.join('\n'))
  } catch {
    return null
  }
  if (!setAt(root, path, value)) return null

  return tagRegionOnlyLists(yaml.dump(root, opts).split('\n'), REGION_ITEM)
    .map(line => {
      let m = REGION_ITEM.exec(line)
      if (m) return regionText[Number(m[1])]
      // A region that is the first key of a list element: the `-` goes on its own line again.
      const head = REGION_ITEM_HEAD.exec(line)
      if (head) return `${head[1]}-\n${regionText[Number(head[2])]}`
      m = REGION_ENTRY.exec(line)
      return m ? regionText[Number(m[1])] : line
    })
    .join('\n')
}

/** Elements of a list outside the regions (a region element is a placeholder string). */
function realIndexes(list: unknown[]): number[] {
  const idx: number[] = []
  list.forEach((x, i) => { if (!(typeof x === 'string' && IS_REGION_KEY.test(x))) idx.push(i) })
  return idx
}

function setAt(root: unknown, path: OutputPath, value: unknown): boolean {
  if (path.length === 0) return false
  let node: unknown = root
  for (let s = 0; s < path.length - 1; s++) {
    const step = path[s]
    const next = path[s + 1]
    if (typeof step === 'number') {
      if (!Array.isArray(node)) return false
      const real = realIndexes(node)[step]
      if (real === undefined) return false
      node = node[real]
    } else {
      if (!isPlainObject(node)) return false
      // Missing intermediate mappings are created (a `fields` added from the form).
      if (node[step] === undefined || node[step] === null) node[step] = typeof next === 'number' ? [] : {}
      node = node[step]
    }
  }
  const last = path[path.length - 1]
  if (typeof last === 'number') {
    if (!Array.isArray(node)) return false
    const idx = realIndexes(node)
    const real = idx[last]
    if (value === undefined) {
      if (real === undefined) return false
      node.splice(real, 1)
    } else if (real === undefined) {
      // Appending after the last element outside the regions.
      if (last !== idx.length) return false
      node.splice(idx.length === 0 ? node.length : idx[idx.length - 1] + 1, 0, value)
    } else {
      node[real] = value
    }
    return true
  }
  if (!isPlainObject(node)) return false
  if (value === undefined) delete node[last]
  else node[last] = value
  return true
}
