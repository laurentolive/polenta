import MarkdownIt from 'markdown-it'
import { parseDrawioFencePayload } from '../tiptap/mediaAttrs'
import { alignByKey, type AlignedRow } from './align'

/**
 * GH178 — blocs média (diagramme draw.io, image) d'un richtext, dans l'ordre où
 * `StaticRichTextViewer` les rend (`.static-drawio` / `img[data-static-img-src]`) : l'index d'un bloc
 * est celui de son élément dans le rendu.
 */
export interface MediaBlock {
  kind: 'drawio' | 'image'
  path: string
  /** Page / cellule ciblée (drawio). */
  nodeId: string | null
  /** Payload normalisé : deux blocs de même payload ont la même référence (taille, rognage…). */
  payload: string
}

let md: MarkdownIt | null = null

export function mediaBlocks(markdown: string): MediaBlock[] {
  if (!markdown) return []
  md ??= new MarkdownIt({ html: false })
  const out: MediaBlock[] = []
  for (const token of md.parse(markdown, {})) {
    if (token.type !== 'fence') continue
    const info = token.info.trim()
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(token.content.trim()) as Record<string, unknown>
    } catch {
      continue // not rendered by the static viewer either
    }
    if (!parsed || typeof parsed !== 'object') continue
    if (info === 'image') {
      out.push({ kind: 'image', path: typeof parsed.src === 'string' ? parsed.src : '', nodeId: null, payload: stable(parsed) })
    } else if (info === 'drawio') {
      const p = parseDrawioFencePayload(token.content)
      if (!p.path) continue // badge only, no `.static-drawio` placeholder
      out.push({ kind: 'drawio', path: p.path, nodeId: p.nodeId, payload: stable(p) })
    }
  }
  return out
}

/** Blocks of both sides, aligned by kind + path (a moved or resized block stays paired). */
export function alignMedia(before: MediaBlock[], after: MediaBlock[]): AlignedRow[] {
  const key = (b: MediaBlock) => `${b.kind}\u0000${b.path}`
  return alignByKey(before.map(key), after.map(key), true)
}

/**
 * Indexes of blocks to frame on each side. `content(side, block)` : contenu référencé à la version
 * du côté (XML de la page ciblée, base64 de l'image), `undefined` tant qu'il n'est pas lu — un bloc
 * n'est alors marqué que sur sa référence. `null` = fichier introuvable à cette version.
 */
export function changedMedia(
  before: MediaBlock[],
  after: MediaBlock[],
  content: (side: 'before' | 'after', block: MediaBlock) => string | null | undefined,
): { before: Set<number>; after: Set<number> } {
  const out = { before: new Set<number>(), after: new Set<number>() }
  for (const [i, j] of alignMedia(before, after)) {
    let changed = i === null || j === null
    if (!changed) {
      const a = before[i!]
      const b = after[j!]
      if (a.kind !== b.kind || a.path !== b.path || a.payload !== b.payload) changed = true
      else {
        const ca = content('before', a)
        const cb = content('after', b)
        changed = ca !== undefined && cb !== undefined && ca !== cb
      }
    }
    if (!changed) continue
    if (i !== null) out.before.add(i)
    if (j !== null) out.after.add(j)
  }
  return out
}

function stable(o: object): string {
  return JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))))
}
