import { renderRegion } from './markers'
import { mergedOrder } from './merge-tree'
import { mergeText } from './text'
import type { FileMerge, MarkerLabels, MergeBlock } from './types'

/**
 * GH222 — fichiers `.drawio` : un `<mxfile>` et ses pages `<diagram id name>…</diagram>`.
 *
 * - Diff : pages appariées par `id` (à défaut `name`), ajoutées / retirées / modifiées.
 * - Merge : une page modifiée d'un seul côté est reprise ; modifiée des deux côtés, elle est d'abord
 *   fusionnée ligne à ligne comme git l'aurait fait (pas de conflit si les changements sont
 *   disjoints), sinon c'est un bloc `page:<id>` : une région de marqueurs autour de l'élément
 *   `<diagram>` entier, qui laisse un XML valide quand on la retire.
 */

export interface DrawioPage {
  id: string
  name: string
  /** Text of the whole `<diagram …>…</diagram>` element. */
  xml: string
}

export interface DrawioFile {
  head: string
  pages: DrawioPage[]
  tail: string
}

// Self-closing (empty page) first: `[^>]*` would otherwise take its `/` and run on to the next page.
const DIAGRAM = /<diagram\b[^>]*\/>|<diagram\b(?:[^>]*[^/>])?>[\s\S]*?<\/diagram>/g

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return m?.[1]
}

/** Pages of a `.drawio` text, `null` when it is not an `<mxfile>` with pages. */
export function parseDrawio(text: string): DrawioFile | null {
  if (!/<mxfile[\s>]/.test(text)) return null
  const pages: DrawioPage[] = []
  let head = ''
  let last = 0
  for (const m of text.matchAll(DIAGRAM)) {
    if (pages.length === 0) head = text.slice(0, m.index)
    const open = /^<diagram\b[^>]*>/.exec(m[0])![0]
    const id = attr(open, 'id') ?? attr(open, 'name') ?? `#${pages.length}`
    pages.push({ id, name: attr(open, 'name') ?? id, xml: m[0] })
    last = m.index! + m[0].length
  }
  if (pages.length === 0) return null
  // Duplicate ids (copied pages): fall back to positions, which stay unique.
  if (new Set(pages.map(p => p.id)).size !== pages.length) pages.forEach((p, i) => { p.id = `#${i}` })
  return { head, pages, tail: text.slice(last) }
}

const norm = (xml: string | undefined) => xml?.replace(/[ \t]+$/gm, '')

export function mergeDrawio(base: string | null, left: string, right: string, labels: MarkerLabels): FileMerge | null {
  const [b, l, r] = [base === null ? null : parseDrawio(base), parseDrawio(left), parseDrawio(right)]
  if (!l || !r || (base !== null && !b)) return null
  const byId = (f: DrawioFile | null) => new Map((f?.pages ?? []).map(p => [p.id, p.xml]))
  const [bm, lm, rm] = [byId(b), byId(l), byId(r)]
  let order = mergedOrder([...bm.keys()], [...lm.keys()], [...rm.keys()], 'after')
  if (order === 'conflict') order = [...rm.keys(), ...[...lm.keys()].filter(id => !rm.has(id))]

  const auto: FileMerge['auto'] = []
  const blocks: MergeBlock[] = []
  const parts: string[] = []
  for (const id of order) {
    const [bx, lx, rx] = [bm.get(id), lm.get(id), rm.get(id)]
    const key = `page:${id}`
    // `undefined` = page removed; `null` = no decision, a block.
    let xml: string | undefined | null = null
    if (norm(lx) === norm(rx)) xml = rx
    else if (norm(lx) === norm(bx)) { xml = rx; auto.push({ key, from: 'right' }) }
    else if (norm(rx) === norm(bx)) { xml = lx; auto.push({ key, from: 'left' }) }
    else if (lx !== undefined && rx !== undefined) {
      const text = mergeText(bx === undefined ? null : `${bx}\n`, `${lx}\n`, `${rx}\n`, labels)
      if (text.blocks.length === 0) { xml = text.output.replace(/\n$/, ''); auto.push({ key, from: 'both' }) }
    }
    if (xml === undefined) continue
    if (xml !== null) { parts.push(`${xml}\n`); continue }
    const block: MergeBlock = {
      key, left: lx === undefined ? undefined : `${lx}\n`, right: rx === undefined ? undefined : `${rx}\n`, base: bx === undefined ? '' : `${bx}\n`,
    }
    blocks.push(block)
    parts.push(renderRegion(key, block.left, block.right, labels))
  }
  // Head and tail (the `<mxfile …>` element and its end): the destination's, unless only the
  // other side changed them.
  const pick = (bv: string | undefined, lv: string, rv: string) => (bv !== undefined && rv === bv ? lv : rv)
  const head = pick(b?.head, l.head, r.head).replace(/\s*$/, '\n')
  const tail = pick(b?.tail, l.tail, r.tail).replace(/^\s*/, '')
  return { kind: 'drawio', output: head + parts.join('') + tail, blocks, auto }
}
